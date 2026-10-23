/**
 * Report subscriptions, delivered: each morning the job runs every
 * subscription that is due (daily, Monday for weekly, the 1st for monthly;
 * alerts every day) as its subscriber, so a person who has lost access to a
 * report stops receiving it, and sends it by email or to Slack.
 *
 * A digest carries the headline numbers with their change on the previous
 * period, the sentence that reads them, the first chart as an image and the
 * CSV. An alert sends only when its condition starts to hold (it was not met
 * at the last check), so a number that stays high does not email every day.
 *
 * At most once per delivery: each first claims `<subscription>:<key>` in
 * report-deliveries (unique), so a repeated or concurrent call sends
 * nothing; a failed run or send releases the claim so a later call retries.
 * Emails also carry a Resend idempotency key.
 */
import type { Payload } from 'payload'
import { sydneyDateString } from '@/lib/disbursement-cutoff'
import { resolveColumns, formatValue, type ColumnView } from '@/lib/reports/columns'
import { buildNarrative, computeHeadline, type HeadlineTile } from '@/lib/reports/headline'
import { dateRangeParameters, previousPeriodLabel } from '@/lib/reports/periods'
import {
  FREQUENCY_PHRASES,
  alertMet,
  alertSpecSchema,
  alertValue,
  deliveryParameters,
  describeAlert,
  dueKey,
  rangeLabel,
  type AlertSpec,
  type SubscriptionFrequency,
} from '@/lib/reports/subscriptions'
import { toCsv } from '@/components/ReportsView/csv'
import { StaffEmailError, sendStaffEmail } from '@/server/email/staff-email'
import { chartPng, chartSvg } from './chart-image'
import {
  canRunReport,
  isReportAuthor,
  runReport,
  specOf,
  type ReportDoc,
  type ReportRunResponse,
} from './run-report'
import type { RunOptions } from './runner'
import { MAX_ATTACHMENT_BYTES, escapeHtml, sydneyClock } from './scheduled'
import { postToSlack, slackConfigured, slackEscape } from './slack'

export interface SubscriptionDoc {
  id: string | number
  user?: string | number | null
  report?: string | number | null
  kind: 'digest' | 'alert'
  frequency?: SubscriptionFrequency | null
  range?: string | null
  parameters?: unknown
  channel?: 'email' | 'slack' | null
  alert?: {
    column?: string | null
    row?: string | null
    value?: string | null
    operator?: 'above' | 'below' | null
    threshold?: number | null
    active?: boolean | null
    lastValue?: number | null
  } | null
  paused?: boolean | null
}

export interface SubscriptionResult {
  id: string
  status: 'sent' | 'checked' | 'already_done' | 'skipped' | 'failed'
  detail?: string
}

export interface SubscriptionSummary {
  day: string
  due: number
  results: SubscriptionResult[]
}

export interface SubscriptionOptions {
  now?: Date
  appUrl: string
  runOptions?: RunOptions
}

/** The alert as stored, or null when it is incomplete. */
export function storedAlert(sub: SubscriptionDoc): AlertSpec | null {
  const a = sub.alert
  if (!a) return null
  const parsed = alertSpecSchema.safeParse({
    column: a.column ?? undefined,
    row: a.row ?? undefined,
    value: a.value ?? undefined,
    operator: a.operator ?? undefined,
    threshold: a.threshold ?? undefined,
  })
  return parsed.success ? parsed.data : null
}

/** The report's link with the delivery's parameters, so it opens on what was sent. */
export function reportLink(
  appUrl: string,
  slug: string,
  parameters: Record<string, unknown>,
  compare: boolean,
): string {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && value !== '') query.set(name, String(value))
  }
  if (compare) query.set('_compare', '1')
  const q = query.toString()
  return `${appUrl.replace(/\/$/, '')}/admin/reports/${encodeURIComponent(slug)}${q ? `?${q}` : ''}`
}

const EMAIL_DATE = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "19 Oct 2026": unambiguous wherever the email is read. */
function emailDate(day: string): string {
  const date = new Date(`${day.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? day : EMAIL_DATE.format(date)
}

/** "Last 7 days: 19 Oct 2026 to 25 Oct 2026", for a report with a date range. */
export function periodLine(
  params: Parameters<typeof dateRangeParameters>[0],
  parameters: Record<string, unknown>,
  rangeKey: string | null | undefined,
): string | null {
  const range = dateRangeParameters(params)
  if (!range) return null
  const from = parameters[range.from.name]
  const to = parameters[range.to.name]
  const name = rangeLabel(rangeKey)
  if (typeof from !== 'string' || typeof to !== 'string') return name
  const dates = `${emailDate(from)} to ${emailDate(to)}`
  return name ? `${name}: ${dates}` : dates
}

const TONE_COLOUR = { good: '#047857', bad: '#b91c1c', neutral: '#4b5563' } as const

function tilesHtml(tiles: readonly HeadlineTile[], previousLabel?: string): string {
  const shown = tiles.filter((t) => t.value !== null)
  if (shown.length === 0) return ''
  const cells = shown
    .map(
      (t) =>
        `<td style="padding:8px 16px 8px 0;vertical-align:top"><div style="font-size:12px;color:#4b5563">${escapeHtml(t.label)}</div><div style="font-size:22px;font-weight:600;color:#111827">${escapeHtml(t.text)}</div>${
          t.change
            ? `<div style="font-size:12px;color:${TONE_COLOUR[t.change.tone]}">${escapeHtml(t.change.text)}${previousLabel ? ` on ${escapeHtml(previousLabel)}` : ''}</div>`
            : ''
        }</td>`,
    )
    .join('')
  return `<table role="presentation" style="border-collapse:collapse"><tr>${cells}</tr></table>`
}

function tilesSlack(tiles: readonly HeadlineTile[], previousLabel?: string): string[] {
  return tiles
    .filter((t) => t.value !== null)
    .map(
      (t) =>
        `*${slackEscape(t.label)}:* ${slackEscape(t.text)}${t.change ? ` (${slackEscape(t.change.text)}${previousLabel ? ` on ${slackEscape(previousLabel)}` : ''})` : ''}`,
    )
}

/**
 * A claim still `sending` after this long was left by a call that died
 * (a restart or deploy mid-run), not one at work: a call ends within the
 * workflow's five-minute limit. Taken over, so the week's or month's
 * delivery is not lost.
 */
export const STALE_CLAIM_MS = 15 * 60_000

async function createClaim(payload: Payload, subId: string, claimKey: string): Promise<string> {
  const doc = await payload.create({
    collection: 'report-deliveries',
    data: { subscription: subId, claimKey, status: 'sending' } as never,
    overrideAccess: true,
  })
  return String(doc.id)
}

/** Claim a delivery. Null when another call holds or has done it. */
async function claim(
  payload: Payload,
  subId: string,
  key: string,
  now: Date,
): Promise<string | null> {
  const claimKey = `${subId}:${key}`
  try {
    return await createClaim(payload, subId, claimKey)
  } catch (error) {
    const existing = await payload.find({
      collection: 'report-deliveries',
      where: { claimKey: { equals: claimKey } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const held = existing.docs[0] as { id: string; status?: string; createdAt?: string } | undefined
    if (!held) throw error
    const age = now.getTime() - Date.parse(held.createdAt ?? '')
    if (held.status !== 'sending' || !(age > STALE_CLAIM_MS)) return null
    // Two calls may both find it stale: only one delete and one create succeed.
    try {
      await payload.delete({ collection: 'report-deliveries', id: held.id, overrideAccess: true })
      return await createClaim(payload, subId, claimKey)
    } catch {
      return null
    }
  }
}

async function settle(
  payload: Payload,
  claimId: string,
  outcome: { status: 'sent' | 'checked' | 'skipped'; detail?: string } | 'release',
): Promise<void> {
  try {
    if (outcome === 'release') {
      await payload.delete({ collection: 'report-deliveries', id: claimId, overrideAccess: true })
    } else {
      await payload.update({
        collection: 'report-deliveries',
        id: claimId,
        data: outcome as never,
        overrideAccess: true,
      })
    }
  } catch (error) {
    // A claim left `sending` is taken over after STALE_CLAIM_MS; nothing is sent twice.
    console.error('[reports] could not settle a subscription delivery:', error)
  }
}

async function recordOnSubscription(
  payload: Payload,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await payload.update({
      collection: 'report-subscriptions',
      id,
      data: data as never,
      overrideAccess: true,
    })
  } catch (error) {
    console.error('[reports] could not update a subscription:', error)
  }
}

interface Delivered {
  subject: string
  html: string
  slack: { text: string; title: string; lines: string[] }
  attachments: NonNullable<Parameters<typeof sendStaffEmail>[0]['attachments']>
}

/** The report's first chart as a base64 PNG, or null when there is none to draw. */
async function chartImage(
  doc: ReportDoc,
  body: ReportRunResponse,
  views: readonly ColumnView[],
): Promise<string | null> {
  const chart = specOf(doc).charts[0]
  if (!chart || body.rowCount === 0) return null
  try {
    const svg = chartSvg(chart, body.columns, views, body.rows, body.previous?.rows ?? null)
    return svg ? (await chartPng(svg)).toString('base64') : null
  } catch (error) {
    // The email is still worth sending without its chart.
    console.error(`[reports] could not draw the chart for ${doc.slug}:`, error)
    return null
  }
}

/** The digest: headline, the sentence, the chart, the CSV and the links. */
function digest(
  doc: ReportDoc,
  sub: SubscriptionDoc,
  body: ReportRunResponse,
  views: readonly ColumnView[],
  chart: string | null,
  link: string,
  manageLink: string,
  day: string,
  period: string | null,
): Delivered {
  const spec = specOf(doc)
  const previousRows = body.previous?.rows ?? null
  const previousLabel = body.previous
    ? previousPeriodLabel(body.previous.from, body.previous.to)
    : undefined
  const tiles = computeHeadline(spec.headline, views, body.columns, body.rows, previousRows)
  const narrative = buildNarrative(tiles, views, body.columns, body.rows, { previousLabel })
  const label = process.env.REPORTS_EMAIL_LABEL?.trim()
  const attachments: Delivered['attachments'] = []

  let chartHtml = ''
  if (chart) {
    attachments.push({
      filename: 'chart.png',
      contentBase64: chart,
      contentType: 'image/png',
      contentId: 'report-chart',
    })
    chartHtml = `<p><img src="cid:report-chart" width="640" alt="${escapeHtml(`Chart: ${spec.title}`)}" style="max-width:100%;height:auto;border:1px solid #e5e7eb"/></p>`
  }
  const csv = toCsv(body.columns, body.rows)
  const attachCsv = body.rowCount > 0 && Buffer.byteLength(csv) <= MAX_ATTACHMENT_BYTES
  if (attachCsv) {
    attachments.push({
      filename: `${doc.slug}-${day}.csv`,
      contentBase64: Buffer.from(`﻿${csv}`, 'utf8').toString('base64'),
    })
  }
  const when = FREQUENCY_PHRASES[sub.frequency ?? 'weekly']
  const html = [
    label ? `<p><strong>${escapeHtml(label)}</strong> environment, not production data.</p>` : '',
    `<h2 style="font-size:18px;margin:0 0 8px">${escapeHtml(spec.title)}</h2>`,
    period ? `<p style="color:#4b5563;margin:0 0 12px">${escapeHtml(period)}</p>` : '',
    body.rowCount === 0 ? '<p>No rows for this period.</p>' : tilesHtml(tiles, previousLabel),
    narrative ? `<p>${escapeHtml(narrative)}</p>` : '',
    chartHtml,
    attachCsv ? '<p>The data is attached as a CSV.</p>' : '',
    `<p><a href="${escapeHtml(link)}">Open the report in the CRM</a></p>`,
    `<p style="color:#6b7280;font-size:12px">You asked for this report ${escapeHtml(when)}. <a href="${escapeHtml(manageLink)}">Change or stop your report emails</a>.</p>`,
  ]
    .filter(Boolean)
    .join('\n')
  return {
    subject: `${label ? `[${label}] ` : ''}${spec.title}${tiles[0]?.value !== null && tiles[0] ? `: ${tiles[0].label} ${tiles[0].text}` : ''} (${day})`,
    html,
    slack: {
      text: `${spec.title}${narrative ? `: ${narrative}` : ''}`,
      title: spec.title,
      lines: [
        ...(period ? [`_${slackEscape(period)}_`] : []),
        ...tilesSlack(tiles, previousLabel),
        ...(narrative ? [slackEscape(narrative)] : []),
      ],
    },
    attachments,
  }
}

function alertMessage(
  doc: ReportDoc,
  alert: AlertSpec,
  value: number,
  views: readonly ColumnView[],
  link: string,
  manageLink: string,
): Delivered {
  const spec = specOf(doc)
  const view = views.find((v) => v.name === alert.column)
  const format = view?.format ?? 'number'
  const what = describeAlert(alert, views)
  const sentence = `${view?.label ?? alert.column}${alert.row !== undefined ? ` (${alert.row})` : ''} is ${formatValue(value, format)}, ${alert.operator} your threshold of ${formatValue(alert.threshold, format)}.`
  const label = process.env.REPORTS_EMAIL_LABEL?.trim()
  return {
    subject: `${label ? `[${label}] ` : ''}Alert: ${what} (${spec.title})`,
    html: [
      label ? `<p><strong>${escapeHtml(label)}</strong> environment, not production data.</p>` : '',
      `<h2 style="font-size:18px;margin:0 0 8px">${escapeHtml(spec.title)}</h2>`,
      `<p>${escapeHtml(sentence)}</p>`,
      `<p><a href="${escapeHtml(link)}">Open the report in the CRM</a></p>`,
      `<p style="color:#6b7280;font-size:12px">You will hear again only if it goes back and crosses the threshold again. <a href="${escapeHtml(manageLink)}">Change or stop your alerts</a>.</p>`,
    ]
      .filter(Boolean)
      .join('\n'),
    slack: {
      text: `Alert: ${what} (${spec.title})`,
      title: `Alert: ${spec.title}`,
      lines: [slackEscape(sentence)],
    },
    attachments: [],
  }
}

/**
 * Deliver every subscription due on the Sydney day. Never throws for one
 * subscription's failure: each outcome is in the summary.
 */
export async function deliverSubscriptions(
  payload: Payload,
  { now = new Date(), appUrl, runOptions }: SubscriptionOptions,
): Promise<SubscriptionSummary> {
  const day = sydneyDateString(now)
  const { weekday } = sydneyClock(now)
  const found = await payload.find({
    collection: 'report-subscriptions',
    where: { paused: { not_equals: true } },
    limit: 5000,
    depth: 0,
    overrideAccess: true,
  })
  const manageLink = `${appUrl.replace(/\/$/, '')}/admin/reports/subscriptions`
  const results: SubscriptionResult[] = []
  let due = 0
  // Subscribers to the same report and settings share one run and one chart;
  // each one's access is still checked.
  const runs = new Map<string, ReportRunResponse>()
  const charts = new Map<string, Promise<string | null>>()

  for (const sub of found.docs as unknown as SubscriptionDoc[]) {
    const id = String(sub.id)
    const key = dueKey(sub.kind, sub.frequency, day, weekday)
    if (key === null) continue
    due++
    if (!sub.user || !sub.report) {
      results.push({ id, status: 'skipped', detail: 'NO_USER_OR_REPORT' })
      continue
    }
    let claimId: string | null
    try {
      claimId = await claim(payload, id, key, now)
    } catch (error) {
      // The next call (or tomorrow's) tries again; the others go ahead.
      console.error(`[reports] could not claim subscription ${id}:`, error)
      results.push({ id, status: 'failed', detail: 'CLAIM_FAILED' })
      continue
    }
    if (claimId === null) {
      results.push({ id, status: 'already_done' })
      continue
    }
    const held = claimId
    const skip = async (detail: string, message: string) => {
      await settle(payload, held, { status: 'skipped', detail })
      await recordOnSubscription(payload, id, {
        lastError: message,
        lastCheckedAt: now.toISOString(),
      })
      results.push({ id, status: 'skipped', detail })
    }
    const fail = async (detail: string) => {
      await settle(payload, held, 'release')
      await recordOnSubscription(payload, id, { lastError: detail })
      results.push({ id, status: 'failed', detail })
    }

    try {
      const user = await payload
        .findByID({ collection: 'users', id: sub.user, depth: 0, overrideAccess: true })
        .catch(() => null)
      const email = (user as { email?: string | null } | null)?.email?.trim()
      if (!user) {
        await skip('NO_USER', 'The subscriber no longer exists.')
        continue
      }
      const doc = (await payload
        .findByID({
          collection: 'report-definitions',
          id: sub.report,
          depth: 0,
          overrideAccess: true,
        })
        .catch(() => null)) as unknown as ReportDoc | null
      if (!doc || doc._status !== 'published') {
        await skip('NOT_PUBLISHED', 'The report is no longer published.')
        continue
      }
      const alert = sub.kind === 'alert' ? storedAlert(sub) : null
      if (sub.kind === 'alert' && !alert) {
        await skip('BAD_ALERT', 'The alert is incomplete.')
        continue
      }
      const spec = specOf(doc)
      const range = dateRangeParameters(spec.parameters)
      const saved =
        sub.parameters && typeof sub.parameters === 'object' && !Array.isArray(sub.parameters)
          ? (sub.parameters as Record<string, unknown>)
          : {}
      const parameters = deliveryParameters(spec.parameters, saved, sub.range, day)
      const compare = sub.kind === 'digest' && range !== null
      const runKey = JSON.stringify([String(doc.id), parameters, compare])
      let body = runs.get(runKey)
      if (body && !canRunReport(user, doc.roles)) {
        await skip('NO_ACCESS', 'You can no longer run this report.')
        continue
      }
      if (!body) {
        const outcome = await runReport(
          payload,
          user,
          doc.slug,
          { parameters, compare, trigger: sub.kind === 'alert' ? 'alert' : 'subscription' },
          runOptions,
        )
        if (outcome.status === 403 || outcome.status === 404) {
          await skip('NO_ACCESS', 'You can no longer run this report.')
          continue
        }
        if (outcome.status === 400) {
          await skip('INVALID_PARAMETERS', 'The saved settings no longer suit the report.')
          continue
        }
        if (outcome.status !== 200) {
          await fail('RUN_FAILED')
          continue
        }
        body = outcome.body as ReportRunResponse
        runs.set(runKey, body)
      }
      const views = resolveColumns(body.columns, spec.columns)
      const link = reportLink(appUrl, doc.slug, parameters, compare)

      let message: Delivered | null
      let alertUpdate: Record<string, unknown> | undefined
      if (alert) {
        const value = alertValue(alert, views, body.columns, body.rows)
        const met = alertMet(alert, value)
        // No value (an empty period) says nothing about the condition: keep
        // the last state, so a number that never fell does not alert again.
        const active = value === null ? sub.alert?.active === true : met
        alertUpdate = { ...(sub.alert ?? {}), active, lastValue: value }
        // Send on the change to "met" only.
        message =
          met && sub.alert?.active !== true && value !== null
            ? alertMessage(doc, alert, value, views, link, manageLink)
            : null
      } else {
        let chart = charts.get(runKey)
        if (!chart) {
          chart = chartImage(doc, body, views)
          charts.set(runKey, chart)
        }
        message = digest(
          doc,
          sub,
          body,
          views,
          await chart,
          link,
          manageLink,
          day,
          periodLine(spec.parameters, parameters, sub.range),
        )
      }

      if (!message) {
        await settle(payload, held, { status: 'checked' })
        await recordOnSubscription(payload, id, {
          ...(alertUpdate ? { alert: alertUpdate } : {}),
          lastCheckedAt: now.toISOString(),
          lastError: null,
        })
        results.push({ id, status: 'checked' })
        continue
      }

      // Slack is for authors (a shared channel); anyone else is emailed.
      const toSlack = sub.channel === 'slack' && isReportAuthor(user) && slackConfigured()
      try {
        if (toSlack) {
          await postToSlack({ ...message.slack, link: { url: link, label: 'Open the report' } })
        } else {
          if (!email) {
            await skip('NO_EMAIL', 'Your account has no email address.')
            continue
          }
          await sendStaffEmail(
            {
              to: [email],
              subject: message.subject,
              html: message.html,
              attachments: message.attachments,
            },
            `report-sub-${id}-${key}`,
          )
        }
      } catch (error) {
        // 409: Resend already has a send under this key (an earlier call
        // timed out after Resend took it), so the email went.
        const alreadySent = error instanceof StaffEmailError && error.status === 409
        if (!alreadySent) {
          console.error(`[reports] could not deliver subscription ${id}:`, error)
          await fail(toSlack ? 'SLACK_FAILED' : 'EMAIL_FAILED')
          continue
        }
      }
      await settle(payload, held, { status: 'sent', detail: toSlack ? 'slack' : 'email' })
      await recordOnSubscription(payload, id, {
        ...(alertUpdate ? { alert: alertUpdate } : {}),
        lastCheckedAt: now.toISOString(),
        lastSentAt: now.toISOString(),
        lastError: null,
      })
      results.push({ id, status: 'sent' })
    } catch (error) {
      console.error(`[reports] subscription ${id} failed:`, error)
      await fail('FAILED')
    }
  }
  return { day, due, results }
}
