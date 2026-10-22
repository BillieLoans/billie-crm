/**
 * Scheduled report delivery (BTB-507).
 *
 * The weekly job runs every published report whose schedule matches and
 * emails the result to supervisors: a short summary, a link to the report
 * and the CSV attached.
 *
 * At most once per report per Sydney day: a delivery first claims its day
 * by inserting a `sending` run with `scheduledFor` (unique with the report
 * slug), so a concurrent or repeated call finds the claim and sends
 * nothing. A failed run or send releases the claim so a later call retries.
 * The single email to all recipients also carries a Resend idempotency key.
 *
 * Email goes through `src/server/email/staff-email.ts` (Resend). The
 * notification dispatcher cannot be used: it only emails customers, by
 * customer id, and sends no attachments.
 */
import type { Payload } from 'payload'
import { sydneyDateString } from '@/lib/disbursement-cutoff'
import { formatNumber } from '@/lib/formatters'
import { bindParameters, reportParametersSchema } from '@/lib/schemas/reports'
import { toCsv } from '@/components/ReportsView/csv'
import { sendStaffEmail } from '@/server/email/staff-email'
import {
  logRun,
  loggedParameters,
  publishedVersionId,
  type ReportDoc,
  type RunLogEntry,
} from './run-report'
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

/**
 * Claim a report's delivery for a Sydney day.
 *
 * @returns the claiming run's id, or null when the day is already claimed.
 */
async function claimDay(payload: Payload, entry: RunLogEntry, day: string): Promise<string | null> {
  try {
    const run = await payload.create({
      collection: 'report-runs',
      data: { ...entry, outcome: 'sending', scheduledFor: day } as never,
      overrideAccess: true,
    })
    return String(run.id)
  } catch (error) {
    // A unique-key conflict means another call holds the day.
    const existing = await payload.find({
      collection: 'report-runs',
      where: {
        and: [{ reportSlug: { equals: entry.reportSlug } }, { scheduledFor: { equals: day } }],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) return null
    throw error
  }
}

/** Finish a claimed run. Releasing (`scheduledFor: null`) lets a later call retry. */
async function finishClaim(
  payload: Payload,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await payload.update({ collection: 'report-runs', id, data, overrideAccess: true })
  } catch (error) {
    // The claim still holds the day, so nothing is sent twice; the run
    // just keeps its `sending` outcome. Logged for follow-up.
    console.error('[reports] could not finish a scheduled run record:', error)
  }
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
    const base: RunLogEntry = {
      reportSlug: doc.slug,
      report: String(doc.id),
      trigger: 'schedule',
      outcome: 'error',
    }
    const params = reportParametersSchema.safeParse(doc.parameters ?? [])
    const bound = params.success ? bindParameters(params.data, {}, now) : null
    if (!params.success || !bound?.ok) {
      // A scheduled report runs on its defaults, so every parameter needs one.
      await logRun(payload, null, { ...base, errorCode: 'NO_DEFAULTS' })
      results.push({
        slug: doc.slug,
        status: 'failed',
        recipients: 0,
        error: 'Every parameter of a scheduled report needs a default',
      })
      continue
    }
    if (to.length === 0) {
      await logRun(payload, null, { ...base, errorCode: 'NO_RECIPIENTS' })
      results.push({ slug: doc.slug, status: 'no_recipients', recipients: 0 })
      continue
    }
    const parameters = loggedParameters(params.data, bound.values)
    const version = await publishedVersionId(payload, String(doc.id))
    const claim = await claimDay(payload, { ...base, version, parameters }, day)
    if (claim === null) {
      results.push({ slug: doc.slug, status: 'already_sent', recipients: 0 })
      continue
    }

    let result
    try {
      result = await runReportSql(doc.sql, bound.values, runOptions)
    } catch (error) {
      const code = error instanceof ReportRunError ? error.code : 'QUERY_FAILED'
      await finishClaim(payload, claim, {
        outcome: code === 'TIMEOUT' ? 'timeout' : 'error',
        errorCode: code,
        scheduledFor: null,
      })
      results.push({ slug: doc.slug, status: 'failed', recipients: 0, error: code })
      continue
    }

    const csv = toCsv(result.columns, result.rows)
    const attach = result.rowCount > 0 && Buffer.byteLength(csv) <= MAX_ATTACHMENT_BYTES
    const link = `${appUrl.replace(/\/$/, '')}/admin/reports/${encodeURIComponent(doc.slug)}`
    const paramText = params.data
      .map((p, i) => `${escapeHtml(p.label)}: ${escapeHtml(String(bound.values[i] ?? '–'))}`)
      .join(', ')
    const rowsText = `${formatNumber(result.rowCount)} row${result.rowCount === 1 ? '' : 's'}${result.truncated ? ' (cut at the row limit)' : ''}`
    const label = process.env.REPORTS_EMAIL_LABEL?.trim()
    const html = [
      label ? `<p><strong>${escapeHtml(label)}</strong> environment, not production data.</p>` : '',
      `<p>${escapeHtml(doc.title)}: ${rowsText}${paramText ? ` for ${paramText}` : ''}.</p>`,
      attach
        ? '<p>The results are attached as a CSV.</p>'
        : result.rowCount === 0
          ? '<p>No rows this week.</p>'
          : '<p>The results are too large to attach; open the report to see them.</p>',
      `<p><a href="${escapeHtml(link)}">Open the report in the CRM</a></p>`,
      '<p>Sent by the Billie CRM to supervisors every Monday morning.</p>',
    ]
      .filter(Boolean)
      .join('\n')

    try {
      await sendStaffEmail(
        {
          to,
          subject: `${label ? `[${label}] ` : ''}Weekly report: ${doc.title} (${day})`,
          html,
          attachments: attach
            ? [
                {
                  filename: `${doc.slug}-${day}.csv`,
                  contentBase64: Buffer.from(`\ufeff${csv}`, 'utf8').toString('base64'),
                },
              ]
            : undefined,
        },
        `report-${doc.slug}-${day}`,
      )
    } catch (error) {
      console.error(`[reports] could not email ${doc.slug}:`, error)
      await finishClaim(payload, claim, {
        outcome: 'error',
        errorCode: 'EMAIL_FAILED',
        durationMs: result.durationMs,
        rowCount: result.rowCount,
        scheduledFor: null,
      })
      results.push({ slug: doc.slug, status: 'failed', recipients: 0, error: 'EMAIL_FAILED' })
      continue
    }

    await finishClaim(payload, claim, {
      outcome: 'ok',
      durationMs: result.durationMs,
      rowCount: result.rowCount,
      truncated: result.truncated,
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

/** The hour (0-23) and weekday (1 = Monday ... 7 = Sunday) in Sydney. */
export function sydneyClock(now: Date = new Date()): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  const day = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(day) + 1
  return { hour, weekday }
}
