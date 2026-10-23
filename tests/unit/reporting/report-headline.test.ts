/**
 * Unit tests for report periods (lib/reports/periods.ts) and the headline
 * numbers and sentence (lib/reports/headline.ts).
 */
import { describe, expect, it } from 'vitest'
import { resolveColumns } from '@/lib/reports/columns'
import { buildNarrative, computeHeadline, headlineValue } from '@/lib/reports/headline'
import {
  RANGE_PRESETS,
  addDays,
  dateRangeParameters,
  describeDataAsAt,
  presetFor,
  previousPeriod,
  previousPeriodLabel,
} from '@/lib/reports/periods'
import { headlineSpecSchema, type ReportColumn, type ReportParameter } from '@/lib/schemas/reports'

const date = (name: string): ReportParameter => ({
  name,
  label: name,
  type: 'date',
  required: true,
})

describe('periods', () => {
  it('finds a report period only in dates named as a pair', () => {
    expect(dateRangeParameters([date('from'), date('to')])?.from.name).toBe('from')
    expect(dateRangeParameters([date('a'), date('from'), date('to')])?.to.name).toBe('to')
    expect(dateRangeParameters([date('until'), date('since')])?.from.name).toBe('since')
    expect(dateRangeParameters([date('opened_from'), date('opened_to')])?.to.name).toBe('opened_to')
    // An "as at" date and a cut-off are not a period.
    expect(dateRangeParameters([date('as_at'), date('opened_after')])).toBeNull()
    expect(dateRangeParameters([date('from')])).toBeNull()
  })

  it('gives the period of the same length just before', () => {
    expect(previousPeriod('2026-10-01', '2026-10-30')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    })
    expect(previousPeriod('2026-03-01', '2026-03-01')).toEqual({
      from: '2026-02-28',
      to: '2026-02-28',
    })
    expect(previousPeriodLabel('2026-10-01', '2026-10-30')).toBe('the previous 30 days')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('sets a whole month against the month before, not the same number of days', () => {
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
    expect(previousPeriod('2026-02-01', '2026-02-28')).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    })
    // Two whole months, across a year.
    expect(previousPeriod('2026-01-01', '2026-02-28')).toEqual({
      from: '2025-11-01',
      to: '2025-12-31',
    })
    expect(previousPeriodLabel('2026-02-01', '2026-02-28')).toBe('the previous month')
    expect(previousPeriodLabel('2025-11-01', '2025-12-31')).toBe('the previous 2 months')
  })

  it('has presets that end on complete days or today, and recognises them', () => {
    const today = '2026-10-23'
    const ranges = Object.fromEntries(RANGE_PRESETS.map((p) => [p.key, p.range(today)]))
    expect(ranges['last-7']).toEqual({ from: '2026-10-16', to: '2026-10-22' })
    expect(ranges['this-month']).toEqual({ from: '2026-10-01', to: '2026-10-23' })
    expect(ranges['last-month']).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(ranges.quarter).toEqual({ from: '2026-10-01', to: '2026-10-23' })
    expect(presetFor('2026-09-23', '2026-10-22', today)?.label).toBe('Last 30 days')
    expect(presetFor('2026-09-24', '2026-10-22', today)).toBeUndefined()
  })

  it('says how fresh the data is in Sydney time', () => {
    const now = new Date('2026-10-23T03:00:00Z') // 2 pm Sydney
    expect(describeDataAsAt('2026-10-22T23:29:00Z', now)).toBe('10:29 am today')
    expect(describeDataAsAt('2026-10-22T05:02:00Z', now)).toBe('4:02 pm yesterday')
    expect(describeDataAsAt('2026-10-01T01:00:00Z', now)).toBe('01/10/26 11:00 am')
  })
})

const SEGMENTS: ReportColumn[] = [
  { name: 'segment', kind: 'text' },
  { name: 'decided', kind: 'number' },
  { name: 'declined', kind: 'number' },
  { name: 'decline_rate_pct', kind: 'number' },
]
const ROWS = [
  { segment: 'paid', decided: 40, declined: 14, decline_rate_pct: 35 },
  { segment: 'organic', decided: 30, declined: 15, decline_rate_pct: 50 },
  { segment: 'llm', decided: 4, declined: 4, decline_rate_pct: 100 },
  { segment: 'not recorded', decided: 26, declined: 3, decline_rate_pct: 11.5 },
  { segment: 'All', decided: 100, declined: 36, decline_rate_pct: 36 },
]
const PREVIOUS = [{ segment: 'All', decided: 80, declined: 24, decline_rate_pct: 30 }]

describe('headline', () => {
  const views = resolveColumns(SEGMENTS, [{ name: 'decline_rate_pct', better: 'lower' }])

  it('reads totals from the total row, and sums counts when there is none', () => {
    const total = headlineValue({ column: 'decline_rate_pct' }, views[3], SEGMENTS, ROWS)
    expect(total).toBe(36)
    const noTotal = ROWS.filter((r) => r.segment !== 'All')
    expect(headlineValue({ column: 'decided' }, views[1], SEGMENTS, noTotal)).toBe(100)
    // A rate without a total row has no honest total.
    expect(headlineValue({ column: 'decline_rate_pct' }, views[3], SEGMENTS, noTotal)).toBeNull()
    expect(headlineValue({ column: 'decided', value: 'max' }, views[1], SEGMENTS, noTotal)).toBe(40)
  })

  it('totals a rate across rows as a ratio of sums', () => {
    const weekly: ReportColumn[] = [
      { name: 'week', kind: 'date' },
      { name: 'decided', kind: 'number' },
      { name: 'approved', kind: 'number' },
      { name: 'approval_rate', kind: 'number' },
    ]
    const rows = [
      { week: '2026-10-05', decided: 10, approved: 9, approval_rate: 0.9 },
      { week: '2026-10-12', decided: 90, approved: 45, approval_rate: 0.5 },
    ]
    const spec = headlineSpecSchema.parse({
      column: 'approval_rate',
      value: 'ratio',
      numerator: 'approved',
      denominator: 'decided',
    })
    expect(headlineValue(spec, resolveColumns(weekly)[3], weekly, rows)).toBe(0.54)
    expect(headlineSpecSchema.safeParse({ column: 'x', value: 'ratio' }).success).toBe(false)
  })

  it('builds tiles with changes coloured by what is better', () => {
    const tiles = computeHeadline(
      [
        { column: 'decline_rate_pct', label: 'Decline rate' },
        { column: 'decided', label: 'Decisions' },
        { column: 'missing' },
      ],
      views,
      SEGMENTS,
      ROWS,
      PREVIOUS,
    )
    expect(tiles.map((t) => [t.label, t.text, t.change?.text, t.change?.tone])).toEqual([
      ['Decline rate', '36%', 'up 6 pts', 'bad'],
      ['Decisions', '100', 'up 25%', 'neutral'],
    ])
    expect(tiles[0].previousText).toBe('30%')
  })

  it('reads the headline aloud, leaving small samples and gaps out of highest and lowest', () => {
    const tiles = computeHeadline(
      [
        { column: 'decline_rate_pct', label: 'Decline rate' },
        { column: 'decided', label: 'Decisions' },
      ],
      views,
      SEGMENTS,
      ROWS,
      PREVIOUS,
    )
    expect(
      buildNarrative(tiles, views, SEGMENTS, ROWS, { previousLabel: 'the previous 30 days' }),
    ).toBe(
      'Decline rate was 36%, up 6 pts on the previous 30 days. Decisions 100 (up 25%). ' +
        'Organic was highest at 50% and paid lowest at 35%, leaving out 1 group with fewer than 20 decided.',
    )
  })

  it('says nothing without a value', () => {
    expect(buildNarrative([], views, SEGMENTS, ROWS)).toBe('')
  })
})
