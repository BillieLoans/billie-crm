/**
 * Turns a report result into what a chart draws, so the drawing code stays
 * simple and the rules can be tested: totals out, categories sorted, missing
 * days filled, a rolling average over noisy daily lines, the previous period
 * lined up, and small samples marked. Pure functions only.
 */
import type { ChartSpec, ReportColumn } from '@/lib/schemas/reports'
import {
  asFraction,
  isGapLabel,
  isSmallSample,
  isTotalLabel,
  labelColumn,
  toNumber,
  type ColumnView,
} from './columns'

type Row = Record<string, unknown>

/** More points than this make an unreadable chart; the table keeps them all. */
export const CHART_POINT_LIMIT = 2_000

/** Lines with more points than this lose their dots. */
export const DOT_LIMIT = 14

/** Daily lines longer than this get a rolling average unless the spec says 0. */
export const AUTO_AVERAGE_AFTER = 21
export const DEFAULT_AVERAGE_DAYS = 7

export interface PreparedSeries {
  /** The column, or the derived key for an average or a previous value. */
  key: string
  column: string
  label: string
  /** Index into the categorical palette (`--series-N`, from 1). */
  colour: number
  role: 'value' | 'raw' | 'average' | 'previous'
}

export interface PreparedChart {
  data: Row[]
  series: PreparedSeries[]
  xFormat: 'date' | 'number' | 'text'
  /** The All/Total row's value of the first series, for a reference line. */
  reference?: { value: number; label: string }
  /** Daily or weekly spacing when the x-axis is a date and the dates were filled. */
  grain?: 'day' | 'week'
  truncated: boolean
  averageDays?: number
}

const DAY_MS = 86_400_000

function dayNumber(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null
  const t = Date.parse(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(t) ? null : Math.round(t / DAY_MS)
}

function isoDay(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10)
}

/** Names of measures that are levels or averages, never flows. */
const NOT_A_FLOW =
  /(avg|average|mean|median|score|balance|outstanding|rate|pct|percent|share|ratio)/i

/**
 * What a missing day holds: 0 for a count or a sum (no applications that
 * day), a gap for anything else (a rate, an average, a balance), which
 * would otherwise plot as a real-looking zero.
 */
export function fillValue(
  column: string,
  view: ColumnView | undefined,
  rows: readonly Row[],
): number | null {
  if (!view || NOT_A_FLOW.test(column)) return null
  if (view.format === 'integer') return 0
  if (view.format !== 'number' && view.format !== 'currency') return null
  const present = rows.map((r) => toNumber(r[column])).filter((v): v is number => v !== null)
  return present.length > 0 && present.every(Number.isInteger) ? 0 : null
}

/**
 * Sort by date and add the days (or weeks) the query left out, so time
 * reads true on the axis. Rows stay as they are, sorted, when a date
 * repeats (several rows per day), the spacing is irregular or monthly, or
 * the filled series would be too long.
 */
export function fillDates(
  rows: readonly Row[],
  x: string,
  seriesViews: readonly (ColumnView | undefined)[],
  seriesColumns: readonly string[],
): { rows: Row[]; grain?: 'day' | 'week' } {
  const dated = rows
    .map((row) => ({ row, day: dayNumber(row[x]) }))
    .filter((r): r is { row: Row; day: number } => r.day !== null)
    .sort((a, b) => a.day - b.day)
  if (dated.length !== rows.length) return { rows: [...rows] }
  const sorted = dated.map((d) => d.row)
  if (dated.length < 2) return { rows: sorted }
  const diffs = dated.slice(1).map((d, i) => d.day - dated[i].day)
  if (diffs.some((d) => d === 0)) return { rows: sorted }
  // Weekly when the rows are whole weeks apart, at least one exactly a week;
  // daily when some rows are a day or two apart; otherwise (months,
  // quarters) the dates stay as they are.
  const shortest = Math.min(...diffs)
  const step = shortest === 7 && diffs.every((d) => d % 7 === 0) ? 7 : shortest <= 2 ? 1 : 0
  if (step === 0) return { rows: sorted }
  const first = dated[0].day
  const last = dated[dated.length - 1].day
  if ((last - first) / step + 1 > CHART_POINT_LIMIT) return { rows: sorted }
  const byDay = new Map(dated.map((d) => [d.day, d.row]))
  const blanks = seriesColumns.map((column, i) => fillValue(column, seriesViews[i], rows))
  const filled: Row[] = []
  for (let day = first; day <= last; day += step) {
    const found = byDay.get(day)
    if (found) filled.push(found)
    else {
      const row: Row = { [x]: isoDay(day) }
      seriesColumns.forEach((column, i) => {
        row[column] = blanks[i]
      })
      filled.push(row)
    }
  }
  return { rows: filled, grain: step === 1 ? 'day' : 'week' }
}

/** A trailing mean over `days` points, once at least half the window has values. */
export function rollingAverage(
  values: readonly (number | null)[],
  days: number,
): (number | null)[] {
  return values.map((_, i) => {
    const window = values
      .slice(Math.max(0, i - days + 1), i + 1)
      .filter((v): v is number => v !== null)
    if (window.length < Math.ceil(days / 2)) return null
    return window.reduce((a, b) => a + b, 0) / window.length
  })
}

export function prepareChart(
  spec: ChartSpec,
  columns: readonly ReportColumn[],
  views: readonly ColumnView[],
  rows: readonly Row[],
  previousRows?: readonly Row[],
): PreparedChart {
  const viewOf = (name: string) => views.find((v) => v.name === name)
  const xKind = columns.find((c) => c.name === spec.x)?.kind ?? 'text'
  const xFormat: PreparedChart['xFormat'] =
    xKind === 'date' || xKind === 'datetime' ? 'date' : xKind === 'number' ? 'number' : 'text'
  const label = labelColumn(columns)
  const seriesColumns = spec.series.map((s) => s.column)
  const seriesViews = seriesColumns.map(viewOf)
  const first = seriesColumns[0]

  // Totals come out of the chart; the first series' total becomes a
  // reference line on single-series bar charts.
  const isTotal = (row: Row) => label !== undefined && label === spec.x && isTotalLabel(row[label])
  let body = rows.filter((row) => !isTotal(row))
  const totalRow = rows.find(isTotal)
  let reference: PreparedChart['reference']
  if (
    totalRow &&
    spec.series.length === 1 &&
    (spec.type === 'bar' || spec.type === 'bar-horizontal')
  ) {
    const value = toNumber(totalRow[first])
    if (value !== null) reference = { value, label: String(totalRow[spec.x]) }
  }

  let grain: PreparedChart['grain']
  if (xKind === 'date') {
    const filled = fillDates(body, spec.x, seriesViews, seriesColumns)
    body = filled.rows
    grain = filled.grain
  } else if (xKind === 'datetime') {
    body = [...body].sort((a, b) => String(a[spec.x]).localeCompare(String(b[spec.x])))
  } else if (
    xFormat === 'text' &&
    spec.sort !== 'none' &&
    (spec.type === 'bar' || spec.type === 'bar-horizontal' || spec.type === 'stacked-100')
  ) {
    const value = (row: Row): number | null => {
      if (spec.type !== 'stacked-100') return toNumber(row[first])
      return seriesColumns.reduce((sum, c) => sum + (toNumber(row[c]) ?? 0), 0)
    }
    // Largest first; gaps ("not recorded") and empty values last.
    body = [...body].sort((a, b) => {
      const gap = Number(isGapLabel(a[spec.x])) - Number(isGapLabel(b[spec.x]))
      if (gap !== 0) return gap
      const va = value(a)
      const vb = value(b)
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1
      return vb - va
    })
  }

  const truncated = body.length > CHART_POINT_LIMIT
  if (truncated) body = body.slice(0, CHART_POINT_LIMIT)

  // Copy rows so derived keys never leak into the table's data.
  const data: Row[] = body.map((row) => {
    const copy: Row = { [spec.x]: row[spec.x] }
    seriesColumns.forEach((c, i) => {
      copy[c] = toNumber(row[c])
      const view = seriesViews[i]
      if (view?.base) {
        copy[view.base] = row[view.base]
        copy[`${c}__small`] = isSmallSample(row, view)
      }
    })
    return copy
  })

  const series: PreparedSeries[] = []
  // Never on stacked areas: a stack of averages would not add up to the
  // stack of days, and drawing both would hide which is which.
  const averageDays =
    (spec.type === 'line' || spec.type === 'area') && grain === 'day' && !spec.stacked
      ? (spec.rollingAverage ?? (data.length > AUTO_AVERAGE_AFTER ? DEFAULT_AVERAGE_DAYS : 0))
      : 0

  spec.series.forEach((s, i) => {
    const seriesLabel = s.label ?? viewOf(s.column)?.label ?? s.column
    if (averageDays > 1) {
      const averaged = rollingAverage(
        data.map((row) => row[s.column] as number | null),
        averageDays,
      )
      data.forEach((row, r) => {
        row[`${s.column}__avg`] = averaged[r]
      })
      series.push({
        key: s.column,
        column: s.column,
        label: `${seriesLabel} (daily)`,
        colour: i + 1,
        role: 'raw',
      })
      series.push({
        key: `${s.column}__avg`,
        column: s.column,
        label: `${seriesLabel} (${averageDays}-day average)`,
        colour: i + 1,
        role: 'average',
      })
    } else {
      series.push({
        key: s.column,
        column: s.column,
        label: seriesLabel,
        colour: i + 1,
        role: 'value',
      })
    }
  })

  // The previous period: by position on a date axis (day 1 against day 1),
  // by label otherwise. Not drawn on 100% stacks, where it would double the bars.
  if (previousRows && previousRows.length > 0 && spec.type !== 'stacked-100') {
    let previous = previousRows.filter((row) => !isTotal(row))
    if (xKind === 'date') previous = fillDates(previous, spec.x, seriesViews, seriesColumns).rows
    else if (xFormat === 'date')
      previous = [...previous].sort((a, b) => String(a[spec.x]).localeCompare(String(b[spec.x])))
    const byLabel = new Map(previous.map((row) => [String(row[spec.x]), row]))
    data.forEach((row, r) => {
      const match = xFormat === 'date' ? previous[r] : byLabel.get(String(row[spec.x]))
      if (!match) return
      for (const c of seriesColumns) {
        const values = averageDays > 1 ? null : toNumber(match[c])
        row[`${c}__prev`] = values
      }
    })
    if (averageDays > 1) {
      // Compare like with like: the previous period's average.
      for (const c of seriesColumns) {
        const prevValues = data.map((_, r) => {
          const match = previous[r]
          return match ? toNumber(match[c]) : null
        })
        const averaged = rollingAverage(prevValues, averageDays)
        data.forEach((row, r) => {
          row[`${c}__prev`] = averaged[r]
        })
      }
    }
    spec.series.forEach((s, i) => {
      const base = series.find((p) => p.column === s.column && p.role !== 'raw')
      series.push({
        key: `${s.column}__prev`,
        column: s.column,
        label: `${base?.label ?? s.column}, previous period`,
        colour: i + 1,
        role: 'previous',
      })
    })
  }

  return {
    data,
    series,
    xFormat,
    reference,
    grain,
    truncated,
    averageDays: averageDays || undefined,
  }
}

/** A share of a row's total, for 100% stacked charts' tooltips. */
export function shareOfRow(row: Row, columns: readonly string[], column: string): number | null {
  const total = columns.reduce((sum, c) => sum + (toNumber(row[c]) ?? 0), 0)
  const value = toNumber(row[column])
  return total > 0 && value !== null ? value / total : null
}

/** A rate column's value as a fraction, for intervals. */
export function rateFraction(value: unknown, view: ColumnView | undefined): number | null {
  const n = toNumber(value)
  if (n === null || !view) return null
  if (view.format !== 'percent' && view.format !== 'percent100') return null
  return asFraction(n, view.format)
}

/**
 * Where a chart's drill-down goes for one row: the target report with the
 * row's category as the named parameter, plus the carried values (the
 * period). Undefined when the row has no category.
 */
export function drillHref(
  spec: ChartSpec,
  row: Row,
  carryParameters?: Record<string, string>,
): string | undefined {
  if (!spec.drill) return undefined
  const value = row[spec.x]
  if (value === null || value === undefined || value === '') return undefined
  const query = new URLSearchParams(carryParameters ?? {})
  query.set(spec.drill.parameter, String(value))
  return `/admin/reports/${spec.drill.report}?${query.toString()}`
}

/** Why a chart spec cannot be drawn from this result, or null if it can. */
export function chartProblem(spec: ChartSpec, columns: readonly ReportColumn[]): string | null {
  const names = new Set(columns.map((c) => c.name))
  const missing = [spec.x, ...spec.series.map((s) => s.column)].filter((n) => !names.has(n))
  if (missing.length) {
    return `The chart needs column${missing.length === 1 ? '' : 's'} ${missing.join(', ')}, which the results do not have.`
  }
  const nonNumeric = spec.series.filter(
    (s) => columns.find((c) => c.name === s.column)?.kind !== 'number',
  )
  if (nonNumeric.length) {
    return `Chart series must be numbers: ${nonNumeric.map((s) => s.column).join(', ')} is not.`
  }
  return null
}
