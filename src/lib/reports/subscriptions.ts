/**
 * Report subscriptions: a report emailed (or posted to Slack) on a
 * schedule, and alerts that fire when a number crosses a threshold. What a
 * subscription asks for, when it is due, which period it covers and what
 * an alert reads from the results. Pure functions only.
 */
import { z } from 'zod'
import type { ReportColumn, ReportParameter } from '@/lib/schemas/reports'
import { HEADLINE_VALUES } from '@/lib/schemas/reports'
import { formatValue, labelColumn, splitRows, toNumber, type ColumnView } from './columns'
import { headlineValue } from './headline'
import { RANGE_PRESETS, dateRangeParameters } from './periods'

type Row = Record<string, unknown>

export const SUBSCRIPTION_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const
export type SubscriptionFrequency = (typeof SUBSCRIPTION_FREQUENCIES)[number]
export const SUBSCRIPTION_CHANNELS = ['email', 'slack'] as const
export type SubscriptionChannel = (typeof SUBSCRIPTION_CHANNELS)[number]
export const ALERT_OPERATORS = ['above', 'below'] as const
export type AlertOperator = (typeof ALERT_OPERATORS)[number]

/** Each person's limit, across reports. */
export const MAX_SUBSCRIPTIONS_PER_USER = 20

export const FREQUENCY_LABELS: Record<SubscriptionFrequency, string> = {
  daily: 'Every morning',
  weekly: 'Monday mornings',
  monthly: 'On the 1st of each month',
}

/** The same, inside a sentence: "You get this report every morning." */
export const FREQUENCY_PHRASES: Record<SubscriptionFrequency, string> = {
  daily: 'every morning',
  weekly: 'on Monday mornings',
  monthly: 'on the 1st of each month',
}

/**
 * The periods a delivery can cover: complete days only. "This month" and
 * "quarter to date" run to today, which at 7am is barely begun (on the 1st,
 * a monthly email would cover one empty day).
 */
export const SUBSCRIPTION_RANGES = ['last-7', 'last-30', 'last-month'] as const

/** The period each email covers, by frequency, when the report has a date range. */
export const DEFAULT_RANGE: Record<SubscriptionFrequency, string> = {
  daily: 'last-7',
  weekly: 'last-7',
  monthly: 'last-month',
}

const parameterValue = z.union([z.string().max(200), z.number(), z.boolean()])

export const alertSpecSchema = z.object({
  column: z.string().min(1).max(63),
  /** A row's label (the first text column), or absent for the headline-style value. */
  row: z.string().max(200).optional(),
  /** How the column is read when no row is named (as a headline number). */
  value: z.enum(HEADLINE_VALUES).exclude(['ratio']).optional(),
  operator: z.enum(ALERT_OPERATORS),
  threshold: z.number().finite(),
})
export type AlertSpec = z.infer<typeof alertSpecSchema>

/** A request to subscribe, as sent by the report page. */
export const subscriptionRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('digest'),
    slug: z.string().min(1).max(50),
    frequency: z.enum(SUBSCRIPTION_FREQUENCIES),
    range: z.string().max(30).nullable().optional(),
    parameters: z.record(z.string(), parameterValue).default({}),
    channel: z.enum(SUBSCRIPTION_CHANNELS).default('email'),
  }),
  z.object({
    kind: z.literal('alert'),
    slug: z.string().min(1).max(50),
    range: z.string().max(30).nullable().optional(),
    parameters: z.record(z.string(), parameterValue).default({}),
    channel: z.enum(SUBSCRIPTION_CHANNELS).default('email'),
    alert: alertSpecSchema,
  }),
])
export type SubscriptionRequest = z.infer<typeof subscriptionRequestSchema>

/**
 * The delivery a subscription owes on a Sydney day, as a key that names it
 * (one delivery per key), or null when nothing is due. Weekly emails go on
 * Mondays, monthly ones on the 1st; alerts are checked every day.
 *
 * @param day Sydney date, YYYY-MM-DD
 * @param weekday 1 = Monday ... 7 = Sunday
 */
export function dueKey(
  kind: 'digest' | 'alert',
  frequency: SubscriptionFrequency | null | undefined,
  day: string,
  weekday: number,
): string | null {
  if (kind === 'alert') return `alert:${day}`
  switch (frequency ?? 'weekly') {
    case 'daily':
      return day
    case 'weekly':
      return weekday === 1 ? day : null
    case 'monthly':
      return day.endsWith('-01') ? day.slice(0, 7) : null
  }
}

/**
 * The parameter values a delivery runs with: the saved ones (declared
 * parameters only), with the date range set from the preset on the day.
 */
export function deliveryParameters(
  params: readonly ReportParameter[],
  saved: Record<string, unknown>,
  rangeKey: string | null | undefined,
  today: string,
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const p of params) {
    if (Object.hasOwn(saved, p.name)) values[p.name] = saved[p.name]
  }
  const range = dateRangeParameters(params)
  const preset = RANGE_PRESETS.find((r) => r.key === rangeKey)
  if (range && preset) {
    const period = preset.range(today)
    values[range.from.name] = period.from
    values[range.to.name] = period.to
  } else if (range) {
    // No preset: the report's own defaults for the period, never stale dates.
    delete values[range.from.name]
    delete values[range.to.name]
  }
  return values
}

/** The value an alert watches, from a result. Null when the result cannot give it. */
export function alertValue(
  alert: AlertSpec,
  views: readonly ColumnView[],
  columns: readonly ReportColumn[],
  rows: readonly Row[],
): number | null {
  if (!columns.some((c) => c.name === alert.column)) return null
  if (alert.row !== undefined) {
    const label = labelColumn(columns)
    if (!label) return null
    const row = rows.find((r) => String(r[label] ?? '') === alert.row)
    return row ? toNumber(row[alert.column]) : null
  }
  const view = views.find((v) => v.name === alert.column)
  // A time series reads its latest point; anything else its total.
  const fallback = columns.some((c) => c.kind === 'date') ? 'last' : 'total'
  return headlineValue(
    { column: alert.column, value: alert.value ?? fallback },
    view,
    columns,
    rows,
  )
}

export function alertMet(alert: AlertSpec, value: number | null): boolean {
  if (value === null) return false
  return alert.operator === 'above' ? value > alert.threshold : value < alert.threshold
}

/** "Decline rate (Paid) above 30.0%". */
export function describeAlert(alert: AlertSpec, views: readonly ColumnView[]): string {
  const view = views.find((v) => v.name === alert.column)
  const name = `${view?.label ?? alert.column}${alert.row !== undefined ? ` (${alert.row})` : ''}`
  return `${name} ${alert.operator} ${formatValue(alert.threshold, view?.format ?? 'number')}`
}

/** The labels an alert can name a row by: the body rows' and the total's. */
export function alertRows(columns: readonly ReportColumn[], rows: readonly Row[]): string[] {
  const label = labelColumn(columns)
  if (!label) return []
  const { body, totals } = splitRows(columns, rows)
  return [...new Set([...totals, ...body].map((r) => String(r[label] ?? '')).filter(Boolean))]
}

/** "Last 7 days" for a preset key. */
export function rangeLabel(key: string | null | undefined): string | null {
  return RANGE_PRESETS.find((r) => r.key === key)?.label ?? null
}
