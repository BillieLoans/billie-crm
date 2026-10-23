'use client'

import React, { useId, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartSpec, ReportColumn } from '@/lib/schemas/reports'
import { formatNumber } from '@/lib/formatters'
import {
  formatAxisValue,
  formatValue,
  resolveColumns,
  toNumber,
  wilsonInterval,
  type ColumnView,
} from '@/lib/reports/columns'
import {
  CHART_POINT_LIMIT,
  DOT_LIMIT,
  prepareChart,
  rateFraction,
  shareOfRow,
  type PreparedSeries,
} from '@/lib/reports/chart-data'
import { copySvgAsPng } from './chart-image'
import styles from './styles.module.css'

export { CHART_POINT_LIMIT }

type Row = Record<string, unknown>

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia?.(REDUCED_MOTION)
  query?.addEventListener?.('change', onChange)
  return () => query?.removeEventListener?.('change', onChange)
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia?.(REDUCED_MOTION).matches ?? false,
    () => false,
  )
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

export interface ReportChartProps {
  title: string
  spec: ChartSpec
  columns: ReportColumn[]
  /** Resolved column settings; derived from `columns` when absent. */
  columnViews?: ColumnView[]
  rows: Row[]
  /** The same report on the previous period, drawn faintly behind. */
  previousRows?: Row[]
  /** Parameter values carried into a drill-down link (dates, mostly). */
  carryParameters?: Record<string, string>
  height?: number
}

const TYPE_NAMES: Record<ChartSpec['type'], string> = {
  line: 'Line chart',
  area: 'Area chart',
  bar: 'Bar chart',
  'bar-horizontal': 'Bar chart',
  'stacked-100': 'Bar chart of shares',
}

/** Recharts' tooltip payload entry, as far as this chart reads it. */
interface TooltipEntry {
  dataKey?: string | number
  payload?: Row
}

/**
 * A report chart. One y-axis only; categorical colours in fixed order
 * (`--series-N` in styles.module.css, validated light and dark); a legend
 * whenever more than one thing is drawn; small samples hatched; the table
 * is the accessible equivalent, and also carries any drill-down links.
 */
export function ReportChart({
  title,
  spec,
  columns,
  columnViews,
  rows,
  previousRows,
  carryParameters,
  height,
}: ReportChartProps) {
  const reducedMotion = usePrefersReducedMotion()
  const router = useRouter()
  const uid = useId().replace(/:/g, '')
  const plotRef = useRef<HTMLDivElement>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const problem = chartProblem(spec, columns)
  if (problem) {
    return (
      <p className={styles.note} data-testid="report-chart-problem">
        {problem} The table has the results.
      </p>
    )
  }

  const views = columnViews ?? resolveColumns(columns)
  const viewOf = (name: string) => views.find((v) => v.name === name)
  const prepared = prepareChart(spec, columns, views, rows, previousRows)
  const { data, series, xFormat, reference } = prepared
  const yView = viewOf(spec.series[0].column)
  const yFormat = spec.type === 'stacked-100' ? 'percent' : (yView?.format ?? 'number')
  const horizontal = spec.type === 'bar-horizontal'
  const isBar = spec.type === 'bar' || horizontal || spec.type === 'stacked-100'
  const stackId = spec.stacked || spec.type === 'stacked-100' ? 'stack' : undefined
  const animate = !reducedMotion
  const anySmall = data.some((row) => spec.series.some((s) => row[`${s.column}__small`] === true))
  const smallView = spec.series.map((s) => viewOf(s.column)).find((v) => v?.base)
  const showLegend = series.length > 1
  const xLabel = (v: unknown) =>
    xFormat === 'date'
      ? formatAxisValue(v, 'date')
      : formatValue(v, xFormat === 'number' ? 'number' : 'text')

  // Tick spacing: every category up to 12, else about ten labels. Horizontal
  // bars grow with their categories, so every bar keeps its name.
  const interval = horizontal || data.length <= 12 ? 0 : Math.ceil(data.length / 10) - 1
  const chartHeight = height ?? (horizontal ? Math.max(160, data.length * 30 + 48) : 320)
  const negative = data.some((row) => series.some((s) => (toNumber(row[s.key]) ?? 0) < 0))

  const onBarClick = (row: Row | undefined) => {
    if (!spec.drill || !row) return
    const value = row[spec.x]
    if (value === null || value === undefined) return
    const query = new URLSearchParams(carryParameters ?? {})
    query.set(spec.drill.parameter, String(value))
    router.push(`/admin/reports/${spec.drill.report}?${query.toString()}`)
  }

  const colourOf = (s: PreparedSeries) => `var(--series-${s.colour})`

  const renderTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean
    payload?: TooltipEntry[]
    label?: unknown
  }) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload ?? {}
    return (
      <div className={styles.chartTooltip}>
        <p className={styles.chartTooltipTitle}>{xLabel(row[spec.x] ?? label)}</p>
        <ul>
          {series.map((s) => {
            const view = viewOf(s.column)
            const value = row[s.key]
            if (value === null || value === undefined) return null
            const share =
              spec.type === 'stacked-100'
                ? shareOfRow(
                    row,
                    spec.series.map((x) => x.column),
                    s.column,
                  )
                : null
            const base = view?.base ? toNumber(row[view.base]) : null
            const p = s.role === 'value' || s.role === 'raw' ? rateFraction(value, view) : null
            const ci = p !== null && base ? wilsonInterval(p, base) : null
            return (
              <li key={s.key}>
                <span className={styles.chartSwatch} style={{ background: colourOf(s) }} />
                {s.label}: <strong>{formatValue(value, view?.format ?? 'number')}</strong>
                {share !== null && ` (${formatValue(share, 'percent')})`}
                {base !== null && s.role !== 'previous' && ` · n = ${formatNumber(base)}`}
                {ci &&
                  ` · 95% range ${formatValue(ci[0], 'percent')}–${formatValue(ci[1], 'percent')}`}
              </li>
            )
          })}
        </ul>
        {spec.drill && <p className={styles.chartTooltipHint}>Click to open the detail</p>}
      </div>
    )
  }

  const valueAxis = {
    tickFormatter: (v: unknown) => formatAxisValue(v, yFormat),
    stroke: 'var(--chart-axis)',
    tick: { fill: 'var(--chart-text)', fontSize: 12 },
    domain: negative ? (['auto', 'auto'] as const) : ([0, 'auto'] as const),
  }
  const categoryAxis = {
    dataKey: spec.x,
    tickFormatter: (v: unknown) => xLabel(v),
    stroke: 'var(--chart-axis)',
    tick: { fill: 'var(--chart-text)', fontSize: 12 },
    interval,
  }

  const copyChart = async () => {
    const svg = plotRef.current?.querySelector('svg.recharts-surface')
    if (!svg) return
    setCopyStatus(await copySvgAsPng(svg as SVGSVGElement, title))
  }

  return (
    <figure className={styles.chartFigure} data-testid="report-chart" data-type={spec.type}>
      <figcaption className={styles.visuallyHidden}>
        {title}: {TYPE_NAMES[spec.type].toLowerCase()} of{' '}
        {spec.series.map((s) => s.label ?? viewOf(s.column)?.label ?? s.column).join(', ')} by{' '}
        {viewOf(spec.x)?.label ?? spec.x}. The same figures are in the table.
      </figcaption>
      {prepared.truncated && (
        <p className={styles.note}>
          The chart shows the first {formatNumber(CHART_POINT_LIMIT)} points. The table and CSV have
          all {formatNumber(rows.length)} rows.
        </p>
      )}
      <div className={styles.chart} aria-hidden="true" ref={plotRef} data-chart-surface>
        <ComposedChart
          responsive
          // The table is the accessible equivalent; Recharts' own keyboard
          // layer would put a focus stop inside this aria-hidden block.
          accessibilityLayer={false}
          data={data}
          layout={horizontal ? 'vertical' : 'horizontal'}
          stackOffset={spec.type === 'stacked-100' ? 'expand' : undefined}
          style={{ width: '100%', height: chartHeight }}
          margin={{ top: 8, right: horizontal ? 96 : 16, bottom: 8, left: 8 }}
          barGap={2}
          barCategoryGap={horizontal ? '24%' : '18%'}
        >
          <defs>
            {spec.series.map((s, i) => (
              <pattern
                key={s.column}
                id={`${uid}-hatch-${i + 1}`}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="6" height="6" fill="var(--chart-surface)" />
                <rect width="3" height="6" fill={`var(--series-${i + 1})`} />
              </pattern>
            ))}
          </defs>
          <CartesianGrid
            vertical={horizontal}
            horizontal={!horizontal}
            stroke="var(--chart-grid)"
          />
          {horizontal ? (
            <>
              <XAxis type="number" {...valueAxis} />
              <YAxis type="category" {...categoryAxis} width={128} />
            </>
          ) : (
            <>
              <XAxis {...categoryAxis} />
              <YAxis {...valueAxis} width={64} />
            </>
          )}
          <Tooltip
            content={renderTooltip as never}
            cursor={{ stroke: 'var(--chart-axis)', fill: 'var(--chart-cursor)' }}
          />
          {showLegend && (
            <Legend
              formatter={(value: unknown) => (
                // Text keeps the text colour; the swatch carries the series identity.
                <span style={{ color: 'var(--chart-text-strong)' }}>
                  {series.find((s) => s.key === value)?.label ?? String(value)}
                </span>
              )}
            />
          )}
          {reference && (
            <ReferenceLine
              {...(horizontal ? { x: reference.value } : { y: reference.value })}
              stroke="var(--chart-text)"
              strokeDasharray="4 4"
              label={{
                value: `${reference.label} ${formatValue(reference.value, yView?.format ?? 'number')}`,
                position: horizontal ? 'top' : 'right',
                fill: 'var(--chart-text)',
                fontSize: 12,
              }}
            />
          )}
          {series.map((s) => {
            const colour = colourOf(s)
            const common = { dataKey: s.key, name: s.key, isAnimationActive: animate }
            if (isBar) {
              const previous = s.role === 'previous'
              return (
                <Bar
                  {...common}
                  key={s.key}
                  fill={colour}
                  fillOpacity={previous ? 0.3 : 1}
                  stackId={previous ? undefined : stackId}
                  stroke="var(--chart-surface)"
                  strokeWidth={stackId ? 2 : 0}
                  radius={stackId ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                  cursor={spec.drill ? 'pointer' : undefined}
                  onClick={(entry: { payload?: Row }) => onBarClick(entry?.payload)}
                >
                  {!previous &&
                    data.map((row, i) => (
                      <Cell
                        key={i}
                        fill={
                          row[`${s.column}__small`] === true
                            ? `url(#${uid}-hatch-${s.colour})`
                            : colour
                        }
                      />
                    ))}
                  {horizontal && !previous && spec.series.length === 1 && (
                    <LabelList
                      dataKey={s.key}
                      position="right"
                      fill="var(--chart-text)"
                      fontSize={12}
                      formatter={(v: unknown) => formatValue(v, yView?.format ?? 'number')}
                    />
                  )}
                </Bar>
              )
            }
            if (spec.type === 'area' && s.role !== 'previous') {
              return (
                <Area
                  {...common}
                  key={s.key}
                  type="linear"
                  stroke={colour}
                  strokeWidth={2}
                  strokeOpacity={s.role === 'raw' ? 0.35 : 1}
                  fill={colour}
                  fillOpacity={s.role === 'raw' ? 0.05 : 0.15}
                  stackId={s.role === 'value' ? stackId : undefined}
                  dot={false}
                  connectNulls={false}
                />
              )
            }
            return (
              <Line
                {...common}
                key={s.key}
                type="linear"
                stroke={colour}
                strokeWidth={s.role === 'raw' ? 1.5 : 2}
                strokeOpacity={s.role === 'raw' || s.role === 'previous' ? 0.4 : 1}
                strokeDasharray={s.role === 'previous' ? '5 4' : undefined}
                connectNulls={false}
                dot={
                  s.role === 'value' && data.length <= DOT_LIMIT
                    ? { r: 4, strokeWidth: 2, stroke: 'var(--chart-surface)' }
                    : false
                }
                activeDot={
                  s.role === 'previous'
                    ? false
                    : { r: 5, strokeWidth: 2, stroke: 'var(--chart-surface)' }
                }
              />
            )
          })}
        </ComposedChart>
      </div>
      <div className={styles.chartFooter}>
        {anySmall && smallView && (
          <span className={styles.footnote}>
            Hatched: fewer than {formatNumber(smallView.minBase)}{' '}
            {(viewOf(smallView.base as string)?.label ?? 'cases').toLowerCase()}.
          </span>
        )}
        {prepared.averageDays && (
          <span className={styles.footnote}>
            Faint line: each day. Solid line: {prepared.averageDays}-day average.
          </span>
        )}
        <button type="button" className={styles.linkButton} onClick={copyChart}>
          Copy chart as image
        </button>
        <span className={styles.hint} aria-live="polite">
          {copyStatus}
        </span>
      </div>
    </figure>
  )
}
