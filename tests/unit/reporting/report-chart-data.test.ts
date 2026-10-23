/**
 * Unit tests for chart preparation (lib/reports/chart-data.ts) and the
 * result checks (lib/reports/quality.ts).
 */
import { describe, expect, it } from 'vitest'
import { fillDates, prepareChart, rollingAverage, shareOfRow } from '@/lib/reports/chart-data'
import { resolveColumns } from '@/lib/reports/columns'
import { resultHints } from '@/lib/reports/quality'
import { chartsSchema, normaliseCharts } from '@/lib/schemas/reports'
import type { ChartSpec, ReportColumn } from '@/lib/schemas/reports'

const BY_SOURCE: ReportColumn[] = [
  { name: 'segment', kind: 'text' },
  { name: 'decided', kind: 'number' },
  { name: 'decline_rate_pct', kind: 'number' },
]
const SOURCE_ROWS = [
  { segment: 'paid', decided: 17, decline_rate_pct: 35.3 },
  { segment: 'not recorded', decided: 30, decline_rate_pct: 70 },
  { segment: 'direct', decided: 5, decline_rate_pct: 60 },
  { segment: 'All', decided: 52, decline_rate_pct: 40 },
]

describe('prepareChart: categories', () => {
  const spec: ChartSpec = {
    type: 'bar-horizontal',
    x: 'segment',
    series: [{ column: 'decline_rate_pct' }],
  }

  it('takes totals out, keeps one as a reference line, sorts by value with gaps last', () => {
    const views = resolveColumns(BY_SOURCE)
    const prepared = prepareChart(spec, BY_SOURCE, views, SOURCE_ROWS)
    expect(prepared.data.map((r) => r.segment)).toEqual(['direct', 'paid', 'not recorded'])
    expect(prepared.reference).toEqual({ value: 40, label: 'All' })
  })

  it('marks small samples per bar', () => {
    const prepared = prepareChart(spec, BY_SOURCE, resolveColumns(BY_SOURCE), SOURCE_ROWS)
    const direct = prepared.data.find((r) => r.segment === 'direct')
    const paid = prepared.data.find((r) => r.segment === 'paid')
    expect(direct?.decline_rate_pct__small).toBe(true)
    expect(paid?.decline_rate_pct__small).toBe(true)
    expect(prepared.data.find((r) => r.segment === 'not recorded')?.decline_rate_pct__small).toBe(
      false,
    )
  })

  it('keeps the query order when asked', () => {
    const prepared = prepareChart({ ...spec, sort: 'none' }, BY_SOURCE, [], SOURCE_ROWS)
    expect(prepared.data.map((r) => r.segment)).toEqual(['paid', 'not recorded', 'direct'])
  })

  it('lines the previous period up by label', () => {
    const prepared = prepareChart(spec, BY_SOURCE, [], SOURCE_ROWS, [
      { segment: 'paid', decided: 10, decline_rate_pct: 30 },
    ])
    expect(prepared.data.find((r) => r.segment === 'paid')?.decline_rate_pct__prev).toBe(30)
    expect(prepared.series.map((s) => s.role)).toEqual(['value', 'previous'])
  })
})

describe('prepareChart: dates', () => {
  const columns: ReportColumn[] = [
    { name: 'day', kind: 'date' },
    { name: 'applications', kind: 'number' },
    { name: 'approval_rate', kind: 'number' },
  ]

  it('fills missing days: 0 for counts, a gap for rates', () => {
    const views = resolveColumns(columns)
    const rows = [
      { day: '2026-10-03', applications: 4, approval_rate: 0.5 },
      { day: '2026-10-01', applications: 2, approval_rate: 0.4 },
    ]
    const filled = fillDates(rows, 'day', [views[1], views[2]], ['applications', 'approval_rate'])
    expect(filled.grain).toBe('day')
    expect(filled.rows).toEqual([
      rows[1],
      { day: '2026-10-02', applications: 0, approval_rate: null },
      rows[0],
    ])
  })

  it('fills weeks, and leaves irregular dates alone', () => {
    const weekly = fillDates(
      [{ day: '2026-10-05' }, { day: '2026-10-12' }, { day: '2026-10-26' }],
      'day',
      [undefined],
      ['n'],
    )
    expect(weekly.grain).toBe('week')
    expect(weekly.rows.map((r) => r.day)).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ])
    const monthly = fillDates([{ day: '2026-09-01' }, { day: '2026-10-01' }], 'day', [], [])
    expect(monthly.grain).toBeUndefined()
    expect(monthly.rows).toHaveLength(2)
  })

  it('adds a 7-day average to long daily lines, and not to short ones', () => {
    const views = resolveColumns(columns)
    const long = Array.from({ length: 30 }, (_, i) => ({
      day: `2026-09-${String(i + 1).padStart(2, '0')}`,
      applications: i,
      approval_rate: 0.5,
    }))
    const spec: ChartSpec = { type: 'line', x: 'day', series: [{ column: 'applications' }] }
    const prepared = prepareChart(spec, columns, views, long)
    expect(prepared.averageDays).toBe(7)
    expect(prepared.series.map((s) => s.role)).toEqual(['raw', 'average'])
    expect(prepared.data[29].applications__avg).toBe(26)
    const short = prepareChart(spec, columns, views, long.slice(0, 10))
    expect(short.averageDays).toBeUndefined()
    const off = prepareChart({ ...spec, rollingAverage: 0 }, columns, views, long)
    expect(off.averageDays).toBeUndefined()
  })

  it('lines the previous period up by position', () => {
    const spec: ChartSpec = { type: 'line', x: 'day', series: [{ column: 'applications' }] }
    const prepared = prepareChart(
      spec,
      columns,
      [],
      [
        { day: '2026-10-08', applications: 3 },
        { day: '2026-10-09', applications: 5 },
      ],
      [
        { day: '2026-10-06', applications: 1 },
        { day: '2026-10-07', applications: 2 },
      ],
    )
    expect(prepared.data.map((r) => r.applications__prev)).toEqual([1, 2])
  })
})

describe('rollingAverage and shareOfRow', () => {
  it('averages a trailing window once half of it has values', () => {
    expect(rollingAverage([2, 4, null, 6], 2)).toEqual([2, 3, 4, 6])
    expect(rollingAverage([1, null, null], 4)).toEqual([null, null, null])
  })

  it('gives a value as a share of its row', () => {
    expect(shareOfRow({ a: 1, b: 3 }, ['a', 'b'], 'b')).toBe(0.75)
    expect(shareOfRow({ a: 0, b: 0 }, ['a', 'b'], 'b')).toBeNull()
  })
})

describe('chart settings', () => {
  it('accepts one chart or a list of two, and nothing else', () => {
    const one = { type: 'bar', x: 'a', series: [{ column: 'b' }] }
    expect(normaliseCharts(one)).toHaveLength(1)
    expect(normaliseCharts([one, { ...one, type: 'stacked-100' }])).toHaveLength(2)
    expect(chartsSchema.safeParse([one, one, one]).success).toBe(false)
    expect(normaliseCharts({ type: 'pie', x: 'a', series: [] })).toEqual([])
    expect(normaliseCharts(null)).toEqual([])
  })
})

describe('resultHints', () => {
  it('flags a column that is zero or empty in every row', () => {
    const columns: ReportColumn[] = [
      { name: 'week', kind: 'date' },
      { name: 'approval_rate', kind: 'number' },
      { name: 'note', kind: 'text' },
    ]
    const rows = [
      { week: '2026-10-05', approval_rate: 0, note: null },
      { week: '2026-10-12', approval_rate: 0, note: null },
    ]
    expect(resultHints(columns, rows).map((h) => h.code)).toEqual(['ALL_ZERO', 'ALL_NULL'])
  })

  it('flags a mostly empty column, a rate out of range and a total that does not add up', () => {
    const columns: ReportColumn[] = [
      { name: 'source', kind: 'text' },
      { name: 'n', kind: 'number' },
      { name: 'approval_rate', kind: 'number' },
    ]
    const rows = [
      { source: 'a', n: 1, approval_rate: null },
      { source: 'b', n: 2, approval_rate: null },
      { source: 'c', n: 3, approval_rate: 1.4 },
      { source: 'All', n: 7, approval_rate: null },
    ]
    expect(resultHints(columns, rows).map((h) => h.code)).toEqual([
      'RATE_RANGE',
      'TOTAL',
      'MOSTLY_NULL',
    ])
  })
})

describe('review fixes', () => {
  const views = (columns: ReportColumn[]) => resolveColumns(columns)

  it('never fills or thins a timestamp axis, or dates that repeat', () => {
    const columns: ReportColumn[] = [
      { name: 'hour', kind: 'datetime' },
      { name: 'n', kind: 'number' },
    ]
    const rows = [
      { hour: '2026-10-02T01:00:00.000Z', n: 2 },
      { hour: '2026-10-01T01:00:00.000Z', n: 1 },
      { hour: '2026-10-01T02:00:00.000Z', n: 3 },
    ]
    const spec: ChartSpec = { type: 'line', x: 'hour', series: [{ column: 'n' }] }
    const prepared = prepareChart(spec, columns, views(columns), rows)
    expect(prepared.data).toHaveLength(3)
    expect(prepared.data[0].hour).toBe('2026-10-01T01:00:00.000Z')
    const repeated = fillDates(
      [{ day: '2026-10-01' }, { day: '2026-10-01' }, { day: '2026-10-03' }],
      'day',
      [],
      [],
    )
    expect(repeated.rows).toHaveLength(3)
    expect(repeated.grain).toBeUndefined()
  })

  it('does not treat a 28-day month gap as weeks', () => {
    const monthly = fillDates([{ day: '2027-02-01' }, { day: '2027-03-01' }], 'day', [], [])
    expect(monthly.rows).toHaveLength(2)
    expect(monthly.grain).toBeUndefined()
  })

  it('leaves averages and balances as gaps on missing days', () => {
    const columns: ReportColumn[] = [
      { name: 'day', kind: 'date' },
      { name: 'avg_amount', kind: 'number' },
      { name: 'amount_funded', kind: 'number' },
    ]
    const v = views(columns)
    const rows = [
      { day: '2026-10-01', avg_amount: 210.5, amount_funded: 400 },
      { day: '2026-10-03', avg_amount: 199.25, amount_funded: 600 },
    ]
    const filled = fillDates(rows, 'day', [v[1], v[2]], ['avg_amount', 'amount_funded'])
    expect(filled.rows[1]).toEqual({ day: '2026-10-02', avg_amount: null, amount_funded: 0 })
  })

  it('never averages a stacked area', () => {
    const columns: ReportColumn[] = [
      { name: 'day', kind: 'date' },
      { name: 'a', kind: 'number' },
      { name: 'b', kind: 'number' },
    ]
    const rows = Array.from({ length: 30 }, (_, i) => ({
      day: `2026-09-${String(i + 1).padStart(2, '0')}`,
      a: 1,
      b: 2,
    }))
    const spec: ChartSpec = {
      type: 'area',
      stacked: true,
      x: 'day',
      series: [{ column: 'a' }, { column: 'b' }],
    }
    const prepared = prepareChart(spec, columns, views(columns), rows)
    expect(prepared.averageDays).toBeUndefined()
    expect(prepared.series.map((s) => s.role)).toEqual(['value', 'value'])
  })

  it('sorts empty values last without breaking the order', () => {
    const columns: ReportColumn[] = [
      { name: 'purpose', kind: 'text' },
      { name: 'n', kind: 'number' },
    ]
    const rows = [
      { purpose: 'a', n: null },
      { purpose: 'b', n: 5 },
      { purpose: 'c', n: null },
      { purpose: 'd', n: 9 },
    ]
    const spec: ChartSpec = { type: 'bar', x: 'purpose', series: [{ column: 'n' }] }
    const prepared = prepareChart(spec, columns, views(columns), rows)
    expect(prepared.data.map((r) => r.purpose)).toEqual(['d', 'b', 'a', 'c'])
  })
})
