/**
 * Date ranges: which of a report's parameters make its period, the range
 * presets staff pick from, and the previous period a report is compared
 * with. Dates are Sydney calendar dates (`YYYY-MM-DD`). Pure functions.
 */
import { sydneyDateString } from '@/lib/disbursement-cutoff'
import { formatCalendarDate } from '@/lib/formatters'
import type { ReportParameter } from '@/lib/schemas/reports'

const DAY_MS = 86_400_000

function toDay(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS)
}

function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

/** Shift a calendar date by whole days. */
export function addDays(date: string, days: number): string {
  return fromDay(toDay(date) + days)
}

/** Days in an inclusive range. */
export function daysInRange(from: string, to: string): number {
  return toDay(to) - toDay(from) + 1
}

/** Name pairs that make a period, start first. */
const RANGE_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['from', 'to'],
  ['start', 'end'],
  ['start_date', 'end_date'],
  ['date_from', 'date_to'],
  ['since', 'until'],
]

/**
 * The parameters that make a report's period: two date parameters named as
 * a pair (`from`/`to`, `start`/`end`, `since`/`until`, or any `x_from`/
 * `x_to`). Other dates (an "as at" date, a cut-off) are not a period, so
 * they keep their own fields and are never shifted for a comparison.
 */
export function dateRangeParameters(
  params: readonly ReportParameter[],
): { from: ReportParameter; to: ReportParameter } | null {
  const dates = params.filter((p) => p.type === 'date')
  const byName = new Map(dates.map((p) => [p.name, p]))
  for (const [start, end] of RANGE_NAMES) {
    const from = byName.get(start)
    const to = byName.get(end)
    if (from && to) return { from, to }
  }
  for (const p of dates) {
    const match = /^(.+)_from$/.exec(p.name)
    const to = match ? byName.get(`${match[1]}_to`) : undefined
    if (to) return { from: p, to }
  }
  return null
}

/** The period of the same length that ends the day before `from`. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const length = daysInRange(from, to)
  const prevTo = addDays(from, -1)
  return { from: addDays(prevTo, -(length - 1)), to: prevTo }
}

export interface RangePreset {
  key: string
  label: string
  range: (today: string) => { from: string; to: string }
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}

function quarterStart(date: string): string {
  const month = Number(date.slice(5, 7))
  const first = Math.floor((month - 1) / 3) * 3 + 1
  return `${date.slice(0, 4)}-${String(first).padStart(2, '0')}-01`
}

/**
 * The ranges staff reach for. "Last N days" ends yesterday, a complete day;
 * "this month" and "quarter to date" run to today.
 */
export const RANGE_PRESETS: readonly RangePreset[] = [
  {
    key: 'last-7',
    label: 'Last 7 days',
    range: (today) => ({ from: addDays(today, -7), to: addDays(today, -1) }),
  },
  {
    key: 'last-30',
    label: 'Last 30 days',
    range: (today) => ({ from: addDays(today, -30), to: addDays(today, -1) }),
  },
  {
    key: 'this-month',
    label: 'This month',
    range: (today) => ({ from: monthStart(today), to: today }),
  },
  {
    key: 'last-month',
    label: 'Last month',
    range: (today) => {
      const end = addDays(monthStart(today), -1)
      return { from: monthStart(end), to: end }
    },
  },
  {
    key: 'quarter',
    label: 'Quarter to date',
    range: (today) => ({ from: quarterStart(today), to: today }),
  },
]

/** The preset a range matches, if any. */
export function presetFor(from: string, to: string, today: string): RangePreset | undefined {
  return RANGE_PRESETS.find((p) => {
    const r = p.range(today)
    return r.from === from && r.to === to
  })
}

/** Sydney today, as `YYYY-MM-DD`. */
export function sydneyToday(now: Date = new Date()): string {
  return sydneyDateString(now)
}

/** "the previous 30 days" or "the previous day", for sentences. */
export function previousPeriodLabel(from: string, to: string): string {
  const days = daysInRange(from, to)
  return days === 1 ? 'the previous day' : `the previous ${days} days`
}

const sydneyTime = new Intl.DateTimeFormat('en-AU', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Australia/Sydney',
})

/**
 * When the data was last changed, for "Data to …": "10:29 am today",
 * "4:02 pm yesterday", or the Sydney date and time.
 */
export function describeDataAsAt(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const day = sydneyDateString(at)
  const today = sydneyDateString(now)
  const time = sydneyTime.format(at)
  if (day === today) return `${time} today`
  if (day === addDays(today, -1)) return `${time} yesterday`
  return `${formatCalendarDate(day)} ${time}`
}
