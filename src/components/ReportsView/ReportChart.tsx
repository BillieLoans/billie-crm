'use client'

import React, { useSyncExternalStore } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartSpec, ReportColumn } from '@/lib/schemas/reports'
import { formatNumber } from '@/lib/formatters'
import { columnLabel, formatCell } from './format'
import styles from './styles.module.css'

/** More points than this make an unreadable chart; the table keeps them all. */
export const CHART_POINT_LIMIT = 2_000

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
  rows: Array<Record<string, unknown>>
}

/**
 * The report's chart. One y-axis only; categorical colours in fixed order
 * (`--series-N` in styles.module.css, validated light and dark); a legend
 * whenever there is more than one series; the table below is the
 * accessible equivalent.
 */
export function ReportChart({ title, spec, columns, rows }: ReportChartProps) {
  const reducedMotion = usePrefersReducedMotion()
  const problem = chartProblem(spec, columns)
  if (problem) {
    return (
      <p className={styles.note} data-testid="report-chart-problem">
        {problem} The table below has the results.
      </p>
    )
  }

  const xKind = columns.find((c) => c.name === spec.x)?.kind ?? 'text'
  const data = rows.length > CHART_POINT_LIMIT ? rows.slice(0, CHART_POINT_LIMIT) : rows
  const stackId = spec.stacked ? 'stack' : undefined
  const animate = !reducedMotion
  const seriesLabel = (column: string) =>
    spec.series.find((s) => s.column === column)?.label ?? columnLabel(column)

  return (
    <figure className={styles.chartFigure} data-testid="report-chart">
      <figcaption className={styles.visuallyHidden}>
        {title}: chart of {spec.series.map((s) => seriesLabel(s.column)).join(', ')} by{' '}
        {columnLabel(spec.x)}. The same figures are in the table below.
      </figcaption>
      {rows.length > CHART_POINT_LIMIT && (
        <p className={styles.note}>
          The chart shows the first {formatNumber(CHART_POINT_LIMIT)} rows. The table and CSV have
          all {formatNumber(rows.length)}.
        </p>
      )}
      <div className={styles.chart} aria-hidden="true">
        <ComposedChart
          responsive
          // The table is the accessible equivalent; Recharts' own keyboard
          // layer would put a focus stop inside this aria-hidden block.
          accessibilityLayer={false}
          data={data}
          style={{ width: '100%', height: 320 }}
          margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
          barGap={2}
        >
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey={spec.x}
            tickFormatter={(v: unknown) => formatCell(v, xKind)}
            stroke="var(--chart-axis)"
            tick={{ fill: 'var(--chart-text)', fontSize: 12 }}
            minTickGap={16}
          />
          <YAxis
            tickFormatter={(v: unknown) => formatNumber(v as number)}
            stroke="var(--chart-axis)"
            tick={{ fill: 'var(--chart-text)', fontSize: 12 }}
            width={64}
          />
          <Tooltip
            labelFormatter={(v: unknown) => formatCell(v, xKind)}
            formatter={(value: unknown, name: unknown) => [
              formatNumber(value as number),
              seriesLabel(String(name)),
            ]}
            contentStyle={{
              background: 'var(--chart-surface)',
              border: '1px solid var(--chart-axis)',
              color: 'var(--chart-text-strong)',
            }}
            cursor={{ stroke: 'var(--chart-axis)', fill: 'var(--chart-cursor)' }}
          />
          {spec.series.length > 1 && (
            <Legend
              formatter={(value: unknown) => (
                // Text keeps the text colour; the swatch carries the series identity.
                <span style={{ color: 'var(--chart-text-strong)' }}>
                  {seriesLabel(String(value))}
                </span>
              )}
            />
          )}
          {spec.series.map((s, i) => {
            const color = `var(--series-${i + 1})`
            const common = {
              dataKey: s.column,
              name: s.column,
              isAnimationActive: animate,
            }
            if (spec.type === 'bar') {
              return (
                <Bar
                  {...common}
                  key={s.column}
                  fill={color}
                  stackId={stackId}
                  stroke="var(--chart-surface)"
                  strokeWidth={stackId ? 2 : 0}
                  radius={stackId && i < spec.series.length - 1 ? 0 : [4, 4, 0, 0]}
                />
              )
            }
            if (spec.type === 'area') {
              return (
                <Area
                  {...common}
                  key={s.column}
                  type="monotone"
                  stroke={color}
                  strokeWidth={2}
                  fill={color}
                  fillOpacity={0.15}
                  stackId={stackId}
                  dot={false}
                />
              )
            }
            return (
              <Line
                {...common}
                key={s.column}
                type="monotone"
                stroke={color}
                strokeWidth={2}
                dot={
                  data.length <= 60
                    ? { r: 4, strokeWidth: 2, stroke: 'var(--chart-surface)' }
                    : false
                }
                activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--chart-surface)' }}
              />
            )
          })}
        </ComposedChart>
      </div>
    </figure>
  )
}
