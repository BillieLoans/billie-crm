/**
 * Unit tests for report subscriptions' pure logic: when a delivery is due,
 * the period it covers, what an alert reads and when it holds, the request
 * schema, and the email chart drawn as SVG.
 */
import { describe, expect, it } from 'vitest'
import { resolveColumns } from '@/lib/reports/columns'
import {
  alertMet,
  alertRows,
  alertValue,
  deliveryParameters,
  describeAlert,
  dueKey,
  subscriptionRequestSchema,
} from '@/lib/reports/subscriptions'
import type { ReportColumn, ReportParameter } from '@/lib/schemas/reports'
import { chartSvg } from '@/server/reporting/chart-image'
import { periodLine, reportLink } from '@/server/reporting/deliveries'

const PARAMS: ReportParameter[] = [
  { name: 'from', label: 'From', type: 'date', required: true, default: 'today-30' },
  { name: 'to', label: 'To', type: 'date', required: true, default: 'today-1' },
  { name: 'source', label: 'Source', type: 'text', required: false },
]

describe('dueKey', () => {
  it('daily every day, weekly on Mondays, monthly on the 1st, alerts every day', () => {
    expect(dueKey('digest', 'daily', '2026-10-27', 2)).toBe('2026-10-27')
    expect(dueKey('digest', 'weekly', '2026-10-27', 2)).toBeNull()
    expect(dueKey('digest', 'weekly', '2026-10-26', 1)).toBe('2026-10-26')
    expect(dueKey('digest', 'monthly', '2026-10-26', 1)).toBeNull()
    expect(dueKey('digest', 'monthly', '2026-11-01', 7)).toBe('2026-11')
    expect(dueKey('alert', null, '2026-10-27', 2)).toBe('alert:2026-10-27')
  })
})

describe('deliveryParameters', () => {
  it('sets the period from the preset on the day and keeps the declared settings', () => {
    expect(
      deliveryParameters(PARAMS, { source: 'paid', junk: 1 }, 'last-month', '2026-11-01'),
    ).toEqual({ source: 'paid', from: '2026-10-01', to: '2026-10-31' })
  })

  it('never keeps saved dates for the period: without a preset, the defaults apply', () => {
    expect(deliveryParameters(PARAMS, { from: '2020-01-01' }, null, '2026-11-01')).toEqual({})
  })
})

describe('alerts', () => {
  const columns: ReportColumn[] = [
    { name: 'segment', kind: 'text' },
    { name: 'decline_rate', kind: 'number' },
  ]
  const rows = [
    { segment: 'Paid', decline_rate: 0.42 },
    { segment: 'Organic', decline_rate: 0.2 },
    { segment: 'All', decline_rate: 0.35 },
  ]
  const views = resolveColumns(columns, [])

  it('reads a named row, or the total row', () => {
    const alert = { column: 'decline_rate', operator: 'above', threshold: 0.4 } as const
    expect(alertValue({ ...alert, row: 'Paid' }, views, columns, rows)).toBe(0.42)
    expect(alertValue(alert, views, columns, rows)).toBe(0.35)
    expect(alertValue({ ...alert, row: 'Gone' }, views, columns, rows)).toBeNull()
    expect(alertValue({ ...alert, column: 'missing' }, views, columns, rows)).toBeNull()
    expect(alertRows(columns, rows)).toEqual(['All', 'Paid', 'Organic'])
  })

  it('reads the latest point of a time series', () => {
    const series: ReportColumn[] = [
      { name: 'day', kind: 'date' },
      { name: 'applications', kind: 'number' },
    ]
    const points = [
      { day: '2026-10-01', applications: 5 },
      { day: '2026-10-02', applications: 9 },
    ]
    expect(
      alertValue(
        { column: 'applications', operator: 'below', threshold: 3 },
        resolveColumns(series, []),
        series,
        points,
      ),
    ).toBe(9)
  })

  it('holds strictly above or below, never on a missing value, and reads aloud', () => {
    const above = { column: 'decline_rate', operator: 'above', threshold: 0.4 } as const
    expect(alertMet(above, 0.42)).toBe(true)
    expect(alertMet(above, 0.4)).toBe(false)
    expect(alertMet({ ...above, operator: 'below' }, 0.2)).toBe(true)
    expect(alertMet(above, null)).toBe(false)
    expect(describeAlert({ ...above, row: 'Paid' }, views)).toBe('Decline rate (Paid) above 40%')
  })
})

describe('subscriptionRequestSchema', () => {
  it('needs a frequency for a digest and a threshold for an alert', () => {
    expect(subscriptionRequestSchema.safeParse({ kind: 'digest', slug: 'x' }).success).toBe(false)
    expect(
      subscriptionRequestSchema.safeParse({
        kind: 'alert',
        slug: 'x',
        alert: { column: 'c', operator: 'above', threshold: Number.NaN },
      }).success,
    ).toBe(false)
    const ok = subscriptionRequestSchema.parse({ kind: 'digest', slug: 'x', frequency: 'daily' })
    expect(ok).toMatchObject({ parameters: {}, channel: 'email' })
  })
})

describe('delivery text', () => {
  it('names the period and links to the report on it', () => {
    expect(periodLine(PARAMS, { from: '2026-10-19', to: '2026-10-25' }, 'last-7')).toBe(
      'Last 7 days: 19 Oct 2026 to 25 Oct 2026',
    )
    expect(periodLine([], {}, 'last-7')).toBeNull()
    expect(reportLink('https://crm.example/', 'daily', { from: '2026-10-19', x: '' }, true)).toBe(
      'https://crm.example/admin/reports/daily?from=2026-10-19&_compare=1',
    )
  })
})

describe('chartSvg', () => {
  const columns: ReportColumn[] = [
    { name: 'source', kind: 'text' },
    { name: 'decided', kind: 'number' },
  ]
  const rows = [
    { source: 'Paid', decided: 60 },
    { source: 'A & <B>', decided: 40 },
    { source: 'All', decided: 100 },
  ]
  const views = resolveColumns(columns, [])

  it('draws a bar per category, escapes labels, and leaves the total out', () => {
    const svg = chartSvg(
      { type: 'bar', x: 'source', series: [{ column: 'decided' }] },
      columns,
      views,
      rows,
    ) as string
    expect(svg.match(/<rect x=/g)).toHaveLength(2)
    expect(svg).toContain('A &amp; &lt;B&gt;')
    // The total is a reference line, not a bar.
    expect(svg).toContain('stroke-dasharray="3 3"')
  })

  it('sizes a ranked chart to its bars', () => {
    const svg = chartSvg(
      { type: 'bar-horizontal', x: 'source', series: [{ column: 'decided' }] },
      columns,
      views,
      rows,
    ) as string
    expect(svg).toMatch(/height="68"/)
  })

  it('draws nothing for columns the result does not have', () => {
    expect(
      chartSvg({ type: 'line', x: 'day', series: [{ column: 'decided' }] }, columns, views, rows),
    ).toBeNull()
  })
})
