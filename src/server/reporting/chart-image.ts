/**
 * A report's first chart as a still image, for emails: drawn as SVG from
 * the same prepared data as the page's chart (`prepareChart`), then
 * rasterised to PNG with sharp. Simpler than the page's chart (no hover, no
 * table view), so the email also carries the numbers as text and the CSV.
 */
import sharp from 'sharp'
import { formatCalendarDate } from '@/lib/formatters'
import { formatAxisValue, toNumber, type ColumnView } from '@/lib/reports/columns'
import { prepareChart, type PreparedChart } from '@/lib/reports/chart-data'
import type { ChartSpec, ReportColumn } from '@/lib/schemas/reports'
import { escapeHtml } from './scheduled'

type Row = Record<string, unknown>

/** The page's light-mode categorical palette, in order (validated for CVD). */
const PALETTE = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
]
const INK = '#1f2937'
const MUTED = '#6b7280'
const GRID = '#e5e7eb'
// DejaVu Sans is what the alpine image installs; the others are for local runs.
const FONT = "Helvetica, Arial, 'DejaVu Sans', sans-serif"

export const CHART_WIDTH = 640
export const CHART_HEIGHT = 300
const MAX_BARS = 15

function colour(index: number): string {
  return PALETTE[(index - 1) % PALETTE.length]
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Round tick values covering [min, max]. */
function ticks(min: number, max: number, count = 4): number[] {
  if (min === max) max = min + 1
  const raw = (max - min) / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw
  const start = Math.floor(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step / 2; v += step) out.push(Number(v.toPrecision(12)))
  return out
}

function xLabel(value: unknown, chart: PreparedChart): string {
  if (chart.xFormat === 'date' && typeof value === 'string') {
    return formatCalendarDate(value.slice(0, 10), 'axis')
  }
  return truncate(String(value ?? ''), 18)
}

const LEGEND_ROW = 18

/**
 * The legend, wrapped to the width: one entry per drawn series (the faint
 * daily lines under an average are not listed), and one "previous period"
 * entry for all the dashed lines. Empty for a single series.
 */
function legend(chart: PreparedChart): { svg: string; height: number } {
  const entries = chart.series
    .filter((s) => s.role === 'value' || s.role === 'average')
    .map((s) => ({ label: s.label, fill: colour(s.colour), dashed: false }))
  if (chart.series.some((s) => s.role === 'previous')) {
    entries.push({ label: 'Previous period', fill: MUTED, dashed: true })
  }
  if (entries.length < 2) return { svg: '', height: 0 }
  const left = 16
  const right = CHART_WIDTH - 16
  let x = left
  let row = 0
  const parts = entries.map((e) => {
    const label = truncate(e.label, 48)
    const width = 22 + label.length * 6.2
    if (x + width > right && x > left) {
      row++
      x = left
    }
    const y = 14 + row * LEGEND_ROW
    const mark = e.dashed
      ? `<line x1="${x}" x2="${x + 14}" y1="${y - 4}" y2="${y - 4}" stroke="${e.fill}" stroke-width="2" stroke-dasharray="4 3"/>`
      : `<rect x="${x}" y="${y - 9}" width="12" height="10" rx="2" fill="${e.fill}"/>`
    const item = `<g>${mark}<text x="${x + 18}" y="${y}" font-size="11" fill="${INK}">${escapeHtml(label)}</text></g>`
    x += width + 14
    return item
  })
  return { svg: parts.join(''), height: (row + 1) * LEGEND_ROW + 6 }
}

function yFormat(chart: PreparedChart, views: readonly ColumnView[]) {
  const first = chart.series[0]
  return views.find((v) => v.name === first?.column)?.format ?? 'number'
}

function lineChart(
  chart: PreparedChart,
  spec: ChartSpec,
  views: readonly ColumnView[],
  stacked: boolean,
): string {
  const key = legend(chart)
  const left = 64
  const right = CHART_WIDTH - 16
  const top = key.height + 12
  const bottom = CHART_HEIGHT - 36
  const n = chart.data.length
  const drawn = chart.series
  const values: number[] = []
  for (const row of chart.data) {
    let sum = 0
    for (const s of drawn) {
      const v = toNumber(row[s.key])
      if (v === null) continue
      if (stacked && s.role === 'value') sum += v
      else values.push(v)
    }
    if (stacked) values.push(sum)
  }
  if (values.length === 0) return ''
  const yTicks = ticks(Math.min(0, ...values), Math.max(...values))
  const yMin = yTicks[0]
  const yMax = yTicks[yTicks.length - 1]
  const xAt = (i: number) => (n <= 1 ? (left + right) / 2 : left + ((right - left) * i) / (n - 1))
  const yAt = (v: number) => bottom - ((v - yMin) / (yMax - yMin || 1)) * (bottom - top)
  const format = yFormat(chart, views)
  const parts: string[] = []
  for (const t of yTicks) {
    parts.push(
      `<line x1="${left}" x2="${right}" y1="${yAt(t)}" y2="${yAt(t)}" stroke="${GRID}"/>`,
      `<text x="${left - 6}" y="${yAt(t) + 4}" font-size="11" text-anchor="end" fill="${MUTED}">${escapeHtml(formatAxisValue(t, format))}</text>`,
    )
  }
  const labelAt = [...new Set([0, Math.floor((n - 1) / 2), n - 1])].filter((i) => i >= 0)
  for (const i of labelAt) {
    parts.push(
      `<text x="${xAt(i)}" y="${bottom + 18}" font-size="11" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" fill="${MUTED}">${escapeHtml(xLabel(chart.data[i][spec.x], chart))}</text>`,
    )
  }
  const base = new Array<number>(n).fill(0)
  for (const s of drawn) {
    let segment: string[] = []
    const paths: string[] = []
    chart.data.forEach((row, i) => {
      const v = toNumber(row[s.key])
      if (v === null) {
        if (segment.length) paths.push(segment.join(' '))
        segment = []
        return
      }
      const y = stacked && s.role === 'value' ? (base[i] += v) : v
      segment.push(`${segment.length ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(y).toFixed(1)}`)
    })
    if (segment.length) paths.push(segment.join(' '))
    const style =
      s.role === 'raw'
        ? `stroke-width="1" opacity="0.35"`
        : s.role === 'previous'
          ? `stroke-width="1.5" stroke-dasharray="4 3" opacity="0.6"`
          : `stroke-width="2"`
    for (const d of paths) {
      parts.push(
        `<path d="${d}" fill="none" stroke="${colour(s.colour)}" ${style} stroke-linejoin="round" stroke-linecap="round"/>`,
      )
    }
  }
  if (chart.reference) {
    const y = yAt(chart.reference.value)
    parts.push(
      `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="${MUTED}" stroke-dasharray="3 3"/>`,
    )
  }
  return parts.join('') + key.svg
}

function verticalBars(chart: PreparedChart, spec: ChartSpec, views: readonly ColumnView[]): string {
  const rows = chart.data.slice(0, MAX_BARS * 2)
  const series = chart.series.filter((s) => s.role === 'value' || s.role === 'average')
  const key = legend({ ...chart, series })
  const left = 64
  const right = CHART_WIDTH - 16
  const top = key.height + 12
  const bottom = CHART_HEIGHT - 44
  const stacked = spec.stacked === true
  const totals = rows.map((row) =>
    stacked
      ? series.reduce((sum, s) => sum + Math.max(0, toNumber(row[s.key]) ?? 0), 0)
      : Math.max(...series.map((s) => toNumber(row[s.key]) ?? 0)),
  )
  const mins = rows.flatMap((row) => series.map((s) => toNumber(row[s.key]) ?? 0))
  const yTicks = ticks(Math.min(0, ...mins), Math.max(...totals, chart.reference?.value ?? 0))
  const yMin = yTicks[0]
  const yMax = yTicks[yTicks.length - 1]
  const yAt = (v: number) => bottom - ((v - yMin) / (yMax - yMin || 1)) * (bottom - top)
  const band = (right - left) / Math.max(rows.length, 1)
  const groupWidth = band * 0.7
  const barWidth = stacked ? groupWidth : groupWidth / Math.max(series.length, 1)
  const format = yFormat(chart, views)
  const parts: string[] = []
  for (const t of yTicks) {
    parts.push(
      `<line x1="${left}" x2="${right}" y1="${yAt(t)}" y2="${yAt(t)}" stroke="${GRID}"/>`,
      `<text x="${left - 6}" y="${yAt(t) + 4}" font-size="11" text-anchor="end" fill="${MUTED}">${escapeHtml(formatAxisValue(t, format))}</text>`,
    )
  }
  const every = Math.ceil(rows.length / 10)
  rows.forEach((row, i) => {
    const x0 = left + band * i + (band - groupWidth) / 2
    let stack = 0
    series.forEach((s, k) => {
      const v = toNumber(row[s.key])
      if (v === null) return
      const from = stacked ? stack : 0
      const to = stacked ? (stack += Math.max(0, v)) : v
      const y = Math.min(yAt(from), yAt(to))
      const h = Math.max(1, Math.abs(yAt(to) - yAt(from)) - (stacked ? 1 : 0))
      const x = stacked ? x0 : x0 + barWidth * k
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, barWidth - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${colour(s.colour)}"/>`,
      )
    })
    if (i % every === 0) {
      parts.push(
        `<text x="${(x0 + groupWidth / 2).toFixed(1)}" y="${bottom + 16}" font-size="10" text-anchor="middle" fill="${MUTED}">${escapeHtml(truncate(xLabel(row[spec.x], chart), 12))}</text>`,
      )
    }
  })
  if (chart.reference) {
    const y = yAt(chart.reference.value)
    parts.push(
      `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="${MUTED}" stroke-dasharray="3 3"/>`,
      `<text x="${right}" y="${y - 4}" font-size="10" text-anchor="end" fill="${MUTED}">${escapeHtml(chart.reference.label)}</text>`,
    )
  }
  return parts.join('') + key.svg
}

const BAR_ROW = 26

function horizontalBars(
  chart: PreparedChart,
  spec: ChartSpec,
  views: readonly ColumnView[],
  shares: boolean,
): string {
  const rows = chart.data.slice(0, MAX_BARS)
  const series = chart.series.filter((s) => s.role === 'value')
  const left = 150
  const right = CHART_WIDTH - 70
  const key = legend({ ...chart, series })
  const top = key.height + 8
  const rowHeight = BAR_ROW
  const format = yFormat(chart, views)
  const max = shares
    ? 1
    : Math.max(...rows.map((row) => Math.max(0, toNumber(row[series[0]?.key]) ?? 0)), 1e-9)
  const parts: string[] = []
  rows.forEach((row, i) => {
    const y = top + rowHeight * i
    parts.push(
      `<text x="${left - 8}" y="${y + rowHeight * 0.65}" font-size="11" text-anchor="end" fill="${INK}">${escapeHtml(truncate(xLabel(row[spec.x], chart), 24))}</text>`,
    )
    if (shares) {
      const total = series.reduce((sum, s) => sum + Math.max(0, toNumber(row[s.key]) ?? 0), 0)
      let x = left
      for (const s of series) {
        const w = total > 0 ? (Math.max(0, toNumber(row[s.key]) ?? 0) / total) * (right - left) : 0
        if (w > 0) {
          parts.push(
            `<rect x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" width="${Math.max(0, w - 2).toFixed(1)}" height="${(rowHeight - 6).toFixed(1)}" fill="${colour(s.colour)}"/>`,
          )
        }
        x += w
      }
      return
    }
    const v = toNumber(row[series[0]?.key])
    if (v === null) return
    const w = (Math.max(0, v) / max) * (right - left)
    parts.push(
      `<rect x="${left}" y="${(y + 3).toFixed(1)}" width="${Math.max(1, w).toFixed(1)}" height="${(rowHeight - 6).toFixed(1)}" rx="2" fill="${colour(series[0].colour)}"/>`,
      `<text x="${(left + w + 6).toFixed(1)}" y="${y + rowHeight * 0.65}" font-size="11" fill="${INK}">${escapeHtml(formatAxisValue(v, format))}</text>`,
    )
  })
  return parts.join('') + key.svg
}

/** A ranked bar chart is as tall as its bars; the others are a fixed size. */
function chartHeight(spec: ChartSpec, chart: PreparedChart): number {
  if (spec.type !== 'bar-horizontal' && spec.type !== 'stacked-100') return CHART_HEIGHT
  const series = chart.series.filter((s) => s.role === 'value')
  return (
    legend({ ...chart, series }).height + 8 + Math.min(chart.data.length, MAX_BARS) * BAR_ROW + 8
  )
}

/** The chart as SVG markup, or null when the result has nothing to draw. */
export function chartSvg(
  spec: ChartSpec,
  columns: readonly ReportColumn[],
  views: readonly ColumnView[],
  rows: readonly Row[],
  previousRows?: readonly Row[] | null,
): string | null {
  if (!columns.some((c) => c.name === spec.x)) return null
  if (!spec.series.every((s) => columns.some((c) => c.name === s.column))) return null
  const chart = prepareChart(spec, columns, views, rows, previousRows ?? undefined)
  if (chart.data.length === 0) return null
  const body =
    spec.type === 'line' || spec.type === 'area'
      ? lineChart(chart, spec, views, spec.type === 'area' && spec.stacked === true)
      : spec.type === 'bar'
        ? verticalBars(chart, spec, views)
        : horizontalBars(chart, spec, views, spec.type === 'stacked-100')
  if (!body) return null
  const height = chartHeight(spec, chart)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${height}" viewBox="0 0 ${CHART_WIDTH} ${height}" font-family="${FONT}"><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`
}

/** The chart as a PNG at twice the size, for sharp rendering on high-density screens. */
export async function chartPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 144 }).png().toBuffer()
}
