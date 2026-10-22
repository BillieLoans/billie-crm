/**
 * Scheduled report delivery (BTB-507).
 *
 * The weekly job runs every published report whose schedule matches and
 * emails the result to supervisors: a short summary, a link to the report
 * and the CSV attached. Each delivery is logged to `report-runs` with the
 * Sydney date it was for, so a second call on the same day sends nothing.
 *
 * Email goes through Payload's Resend adapter (`RESEND_API_KEY`). The
 * notification dispatcher cannot be used: it only emails customers, by
 * customer id, and sends no attachments.
 */
import type { Payload } from 'payload'
import { sydneyDateString } from '@/lib/disbursement-cutoff'
import { formatNumber } from '@/lib/formatters'
import { bindParameters, reportParametersSchema } from '@/lib/schemas/reports'
import { toCsv } from '@/components/ReportsView/csv'
import { logRun, loggedParameters, publishedVersionId, type ReportDoc } from './run-report'
import { ReportRunError, runReportSql, type RunOptions } from './runner'

export type ReportSchedule = 'weekly_monday'

/** Roles that receive scheduled reports. */
export const SCHEDULED_RECIPIENT_ROLES = ['supervisor'] as const

/** Above this the CSV is not attached; the email links to the report instead. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

export interface DeliveryResult {
  slug: string
  status: 'sent' | 'already_sent' | 'no_recipients' | 'failed'
  recipients: number
  rows?: number
  attached?: boolean
  error?: string
}

export interface DeliverySummary {
  scheduledFor: string
  reports: DeliveryResult[]
}

export interface DeliveryOptions {
  schedule: ReportSchedule
  now?: Date
  /** Base URL for links, e.g. https://crm.billie.loans. */
  appUrl: string
  runOptions?: RunOptions
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

async function recipients(payload: Payload): Promise<string[]> {
  const users = await payload.find({
    collection: 'users',
    where: { role: { in: [...SCHEDULED_RECIPIENT_ROLES] } },
    limit: 200,
    depth: 0,
    overrideAccess: true,
  })
  return [
    ...new Set(
      users.docs
        .map((u) => (u as { email?: string | null }).email?.trim())
        .filter((e): e is string => Boolean(e)),
    ),
  ]
}

async function alreadyDelivered(payload: Payload, slug: string, day: string): Promise<boolean> {
  const runs = await payload.find({
    collection: 'report-runs',
    where: {
      and: [
        { reportSlug: { equals: slug } },
        { trigger: { equals: 'schedule' } },
        { scheduledFor: { equals: day } },
        { outcome: { equals: 'ok' } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return runs.docs.length > 0
}

/**
 * Run and email every published report on the schedule.
 *
 * Never throws for one report's failure: each report's outcome is in the
 * summary and in the run log.
 */
export async function deliverScheduledReports(
  payload: Payload,
  { schedule, now = new Date(), appUrl, runOptions }: DeliveryOptions,
): Promise<DeliverySummary> {
  const day = sydneyDateString(now)
  const found = await payload.find({
    collection: 'report-definitions',
    where: {
      and: [{ _status: { equals: 'published' } }, { schedule: { equals: schedule } }],
    },
    sort: 'title',
    limit: 100,
    depth: 0,
    overrideAccess: true,
  })
  const to = await recipients(payload)
  const results: DeliveryResult[] = []

  for (const doc of found.docs as unknown as ReportDoc[]) {
    const base = { reportSlug: doc.slug, report: String(doc.id), trigger: 'schedule' as const }
    if (await alreadyDelivered(payload, doc.slug, day)) {
      results.push({ slug: doc.slug, status: 'already_sent', recipients: 0 })
      continue
    }
    const params = reportParametersSchema.safeParse(doc.parameters ?? [])
    const bound = params.success ? bindParameters(params.data, {}, now) : null
    if (!params.success || !bound?.ok) {
      // A scheduled report runs on its defaults, so every parameter needs one.
      await logRun(payload, null, { ...base, outcome: 'error', errorCode: 'NO_DEFAULTS' })
      results.push({
        slug: doc.slug,
        status: 'failed',
        recipients: 0,
        error: 'Every parameter of a scheduled report needs a default',
      })
      continue
    }
    const parameters = loggedParameters(params.data, bound.values)
    const version = await publishedVersionId(payload, String(doc.id))

    let result
    try {
      result = await runReportSql(doc.sql, bound.values, runOptions)
    } catch (error) {
      const code = error instanceof ReportRunError ? error.code : 'QUERY_FAILED'
      await logRun(payload, null, {
        ...base,
        version,
        parameters,
        outcome: code === 'TIMEOUT' ? 'timeout' : 'error',
        errorCode: code,
      })
      results.push({ slug: doc.slug, status: 'failed', recipients: 0, error: code })
      continue
    }

    if (to.length === 0) {
      await logRun(payload, null, {
        ...base,
        version,
        parameters,
        outcome: 'error',
        errorCode: 'NO_RECIPIENTS',
        durationMs: result.durationMs,
        rowCount: result.rowCount,
      })
      results.push({
        slug: doc.slug,
        status: 'no_recipients',
        recipients: 0,
        rows: result.rowCount,
      })
      continue
    }

    const csv = toCsv(result.columns, result.rows)
    const attach = result.rowCount > 0 && Buffer.byteLength(csv) <= MAX_ATTACHMENT_BYTES
    const link = `${appUrl.replace(/\/$/, '')}/admin/reports/${encodeURIComponent(doc.slug)}`
    const paramText = params.data
      .map((p, i) => `${escapeHtml(p.label)}: ${escapeHtml(String(bound.values[i] ?? '–'))}`)
      .join(', ')
    const rowsText = `${formatNumber(result.rowCount)} row${result.rowCount === 1 ? '' : 's'}${result.truncated ? ' (cut at the row limit)' : ''}`
    const html = [
      `<p>${escapeHtml(doc.title)}: ${rowsText}${paramText ? ` for ${paramText}` : ''}.</p>`,
      attach
        ? '<p>The results are attached as a CSV.</p>'
        : result.rowCount === 0
          ? '<p>No rows this week.</p>'
          : '<p>The results are too large to attach; open the report to see them.</p>',
      `<p><a href="${escapeHtml(link)}">Open the report in the CRM</a></p>`,
      '<p>Sent by the Billie CRM to supervisors every Monday morning.</p>',
    ].join('\n')

    try {
      for (const address of to) {
        await payload.sendEmail({
          to: address,
          subject: `Weekly report: ${doc.title} (${day})`,
          html,
          attachments: attach
            ? [
                {
                  filename: `${doc.slug}-${day}.csv`,
                  content: Buffer.from(`﻿${csv}`, 'utf8').toString('base64'),
                },
              ]
            : undefined,
        })
      }
    } catch (error) {
      console.error(`[reports] could not email ${doc.slug}:`, error)
      await logRun(payload, null, {
        ...base,
        version,
        parameters,
        outcome: 'error',
        errorCode: 'EMAIL_FAILED',
        durationMs: result.durationMs,
        rowCount: result.rowCount,
      })
      results.push({ slug: doc.slug, status: 'failed', recipients: 0, error: 'EMAIL_FAILED' })
      continue
    }

    await logRun(payload, null, {
      ...base,
      version,
      parameters,
      outcome: 'ok',
      durationMs: result.durationMs,
      rowCount: result.rowCount,
      truncated: result.truncated,
      scheduledFor: day,
    })
    results.push({
      slug: doc.slug,
      status: 'sent',
      recipients: to.length,
      rows: result.rowCount,
      attached: attach,
    })
  }
  return { scheduledFor: day, reports: results }
}

/** The hour of day in Sydney, 0-23. */
export function sydneyHour(now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  return Number(hour)
}
