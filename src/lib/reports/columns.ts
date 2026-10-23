/**
 * How report results are read: each column's format, its heading, which
 * rows are totals or data gaps, and which rates rest on too few cases.
 *
 * Shared by the Reports view, the scheduled emails and the headline
 * sentence, so a number reads the same everywhere. Pure functions only.
 *
 * Formats follow the column name unless the report's `columns` setting
 * says otherwise. The conventions are the ones Ask Claude's checks already
 * enforce: `*_rate` is a share from 0 to 1 and `*_pct` a share from 0 to 100.
 */
import type { ColumnFormat, ColumnSpec, ReportColumn } from '@/lib/schemas/reports'
import {
  formatCalendarDate,
  formatCompactNumber,
  formatCurrency,
  formatDateShort,
  formatNumber,
  formatOneDecimal,
  formatPercent,
  formatUsd,
} from '@/lib/formatters'

const MONEY_TOKENS = new Set([
  'aud',
  'amount',
  'outstanding',
  'balance',
  'fee',
  'fees',
  'payable',
  'principal',
  'receivable',
  'receivables',
  'revenue',
])
/** Money columns whose words would otherwise read as counts. */
const MONEY_NAMES = new Set(['total_paid', 'amount_paid', 'total_paid_at_closure'])

/** The format a column's name implies. */
export function conventionalFormat(name: string, kind: ReportColumn['kind']): ColumnFormat {
  if (kind === 'date' || kind === 'datetime') return 'date'
  if (kind !== 'number') return 'text'
  const lower = name.toLowerCase()
  const tokens = lower.split('_').filter(Boolean)
  const last = tokens[tokens.length - 1]
  if (last === 'pct' || last === 'percent' || last === 'percentage') return 'percent100'
  if (last === 'rate') return 'percent'
  if (last === 'usd') return 'usd'
  if (tokens.includes('count') || last === 'n') return 'integer'
  if (MONEY_NAMES.has(lower) || tokens.some((t) => MONEY_TOKENS.has(t))) return 'currency'
  if (tokens.includes('hours') || tokens.includes('hour')) return 'hours'
  if (tokens.includes('days')) return 'days'
  return 'number'
}

/** Everything the view needs to show one column. */
export interface ColumnView {
  name: string
  kind: ReportColumn['kind']
  label: string
  format: ColumnFormat
  description?: string
  /** The count a rate is a share of, when known. */
  base?: string
  minBase: number
  better?: 'higher' | 'lower'
}

export const DEFAULT_MIN_BASE = 20

/** Column names that are the count a rate is taken over. */
const BASE_NAMES = new Set([
  'n',
  'count',
  'decided',
  'decisions',
  'applications',
  'starts',
  'loans',
  'sample',
  'sample_size',
])

const isRate = (format: ColumnFormat) => format === 'percent' || format === 'percent100'

/**
 * Resolve every column's display settings.
 *
 * A rate's base comes from its setting, or, when the result has exactly one
 * column that is plainly a count of cases (`decided`, `applications`, …),
 * from that column. With two candidates the base is left unknown rather
 * than guessed.
 */
export function resolveColumns(
  columns: readonly ReportColumn[],
  specs: readonly ColumnSpec[] = [],
): ColumnView[] {
  const names = new Set(columns.map((c) => c.name))
  const candidates = columns.filter(
    (c) => c.kind === 'number' && BASE_NAMES.has(c.name.toLowerCase()),
  )
  const implicitBase = candidates.length === 1 ? candidates[0].name : undefined
  return columns.map((col) => {
    const spec = specs.find((s) => s.name === col.name)
    const format = spec?.format ?? conventionalFormat(col.name, col.kind)
    const base =
      spec?.base && names.has(spec.base)
        ? spec.base
        : isRate(format) && implicitBase !== col.name
          ? implicitBase
          : undefined
    return {
      name: col.name,
      kind: col.kind,
      label: spec?.label ?? columnLabel(col.name),
      format,
      description: spec?.description,
      base,
      minBase: spec?.minBase ?? DEFAULT_MIN_BASE,
      better: spec?.better,
    }
  })
}

const UNIT_SUFFIXES = ['pct', 'percent', 'percentage', 'aud']

/**
 * A readable heading from a column name: `approval_rate` → `Approval rate`,
 * `decline_rate_pct` → `Decline rate`, `cost_usd` → `Cost (USD)`. Unit
 * suffixes go, because the format already shows the unit.
 */
export function columnLabel(name: string): string {
  const tokens = name.split('_').filter(Boolean)
  let suffix = ''
  while (tokens.length > 1 && UNIT_SUFFIXES.includes(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop()
  }
  if (tokens.length > 1 && tokens[tokens.length - 1].toLowerCase() === 'usd') {
    tokens.pop()
    suffix = ' (USD)'
  }
  const spaced = tokens.join(' ').trim()
  if (!spaced) return name
  return spaced.charAt(0).toUpperCase() + spaced.slice(1) + suffix
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** A rate as a fraction of 1, whichever scale the column uses. */
export function asFraction(value: number, format: ColumnFormat): number {
  return format === 'percent100' ? value / 100 : value
}

/** Display text for one value, through the shared formatters. Empty for SQL NULL. */
export function formatValue(
  value: unknown,
  format: ColumnFormat,
  kind: ReportColumn['kind'] = 'number',
): string {
  if (value === null || value === undefined) return ''
  if (kind === 'boolean') return value ? 'Yes' : 'No'
  if (format === 'date' || kind === 'date' || kind === 'datetime') {
    if (typeof value !== 'string') return String(value)
    if (kind === 'datetime') {
      return Number.isNaN(new Date(value).getTime()) ? value : formatDateShort(value)
    }
    return formatCalendarDate(value)
  }
  if (format === 'text' || kind === 'text') {
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
  const n = toNumber(value)
  if (n === null) return String(value)
  switch (format) {
    case 'integer':
      return formatNumber(Math.round(n))
    case 'percent':
    case 'percent100':
      return formatPercent(asFraction(n, format))
    case 'currency':
      return formatCurrency(n, { fractionDigits: Number.isInteger(n) ? 0 : 2 })
    case 'usd':
      return formatUsd(n)
    case 'hours':
      return `${formatOneDecimal(n)} h`
    case 'days':
      return `${formatOneDecimal(n)} ${n === 1 ? 'day' : 'days'}`
    default:
      return formatNumber(n)
  }
}

/** A short axis label: `14 Sept` for dates, compact numbers and percentages. */
export function formatAxisValue(value: unknown, format: ColumnFormat): string {
  if (format === 'date' && typeof value === 'string') return formatCalendarDate(value, 'axis')
  const n = toNumber(value)
  if (n === null) return value === null || value === undefined ? '' : String(value)
  if (format === 'percent' || format === 'percent100') return formatPercent(asFraction(n, format))
  const compact = formatCompactNumber(n)
  return format === 'currency' ? `$${compact}` : format === 'usd' ? `US$${compact}` : compact
}

/** A change between two values: percentage points for rates, a percentage otherwise. */
export interface Change {
  delta: number
  /** `pts` for rates, `pct` for a relative change, `abs` when the previous value was 0. */
  unit: 'pts' | 'pct' | 'abs'
  direction: 'up' | 'down' | 'flat'
  /** Good, bad or neutral news, from the column's `better`. */
  tone: 'good' | 'bad' | 'neutral'
  text: string
}

export function computeChange(
  current: unknown,
  previous: unknown,
  format: ColumnFormat,
  better?: 'higher' | 'lower',
): Change | null {
  const cur = toNumber(current)
  const prev = toNumber(previous)
  if (cur === null || prev === null) return null
  let delta: number
  let unit: Change['unit']
  if (isRate(format)) {
    delta = (asFraction(cur, format) - asFraction(prev, format)) * 100
    unit = 'pts'
  } else if (prev === 0) {
    delta = cur
    unit = 'abs'
  } else {
    delta = ((cur - prev) / Math.abs(prev)) * 100
    unit = 'pct'
  }
  const rounded = Math.round(delta * 10) / 10
  const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat'
  const tone =
    direction === 'flat' || !better
      ? 'neutral'
      : (direction === 'up') === (better === 'higher')
        ? 'good'
        : 'bad'
  const size = formatOneDecimal(Math.abs(rounded))
  const text =
    direction === 'flat'
      ? 'no change'
      : unit === 'pts'
        ? `${direction} ${size} pts`
        : unit === 'pct'
          ? `${direction} ${size}%`
          : `${direction} ${formatValue(Math.abs(cur - prev), format)}`
  return { delta: rounded, unit, direction, tone, text }
}

/** Labels of total rows. A fixed list: "All other" is a category, not a total. */
const TOTAL_LABELS = new Set([
  'all',
  'total',
  'totals',
  'grand total',
  'overall',
  'all sources',
  'all channels',
  'all segments',
  'all categories',
  'all reasons',
  'all purposes',
  'all rulesets',
  'all products',
  'all states',
])
const GAP_LABEL = /^\(?(not recorded|unknown|not given|none|n\/a|unattributed|not set)\)?$/i

export function isTotalLabel(value: unknown): boolean {
  return typeof value === 'string' && TOTAL_LABELS.has(value.trim().toLowerCase())
}

/** A value that marks missing data rather than a real category. */
export function isGapLabel(value: unknown): boolean {
  return typeof value === 'string' && GAP_LABEL.test(value.trim())
}

/** The column that names each row: the first text column, if any. */
export function labelColumn(columns: readonly ReportColumn[]): string | undefined {
  return columns.find((c) => c.kind === 'text')?.name
}

type Row = Record<string, unknown>

/**
 * Split a result into ordinary rows and total rows. Rows that mark missing
 * data go after the others; the rest keep the query's order.
 */
export function splitRows(
  columns: readonly ReportColumn[],
  rows: readonly Row[],
): { body: Row[]; totals: Row[] } {
  const label = labelColumn(columns)
  if (!label) return { body: [...rows], totals: [] }
  const body: Row[] = []
  const gaps: Row[] = []
  const totals: Row[] = []
  for (const row of rows) {
    if (isTotalLabel(row[label])) totals.push(row)
    else if (isGapLabel(row[label])) gaps.push(row)
    else body.push(row)
  }
  return { body: [...body, ...gaps], totals }
}

const DAY_MS = 86_400_000

/**
 * How a row finds its counterpart in the previous period. Rows match on
 * every text column (segment, channel, …) and, when there is a calendar
 * date column, on the day's position in the period: day 1 against day 1.
 * Without either they match by position. Returns, for a set of rows, each
 * row's key.
 */
export function comparisonKey(
  columns: readonly ReportColumn[],
): (rows: readonly Row[]) => Map<Row, string> {
  const textColumns = columns.filter((c) => c.kind === 'text').map((c) => c.name)
  const dateColumn = columns.find((c) => c.kind === 'date')?.name
  return (rows) => {
    const keys = new Map<Row, string>()
    const days = dateColumn
      ? rows.map((r) => Date.parse(`${String(r[dateColumn]).slice(0, 10)}T00:00:00Z`))
      : []
    const start = days.length ? Math.min(...days.filter((d) => !Number.isNaN(d))) : 0
    rows.forEach((row, i) => {
      const parts = textColumns.map((c) => String(row[c] ?? ''))
      if (dateColumn) parts.unshift(String(Math.round((days[i] - start) / DAY_MS)))
      keys.set(row, parts.length ? JSON.stringify(parts) : String(i))
    })
    return keys
  }
}

/** True when a rate in this row rests on fewer cases than its column allows. */
export function isSmallSample(row: Row, column: ColumnView): boolean {
  if (!column.base) return false
  const n = toNumber(row[column.base])
  return n !== null && n < column.minBase
}

/** A 95% Wilson interval for a rate of `p` (0–1) over `n` cases. */
export function wilsonInterval(p: number, n: number): [number, number] | null {
  if (!(n > 0) || p < 0 || p > 1) return null
  const z = 1.96
  const z2 = z * z
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n)
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

/** Tab-separated text of a result as shown, for pasting into a sheet or a message. */
export function toTsv(columns: readonly ColumnView[], rows: readonly Row[]): string {
  const clean = (text: string) => text.replace(/[\t\r\n]+/g, ' ')
  const lines = [columns.map((c) => clean(c.label)).join('\t')]
  for (const row of rows) {
    lines.push(columns.map((c) => clean(formatValue(row[c.name], c.format, c.kind))).join('\t'))
  }
  return lines.join('\n')
}
