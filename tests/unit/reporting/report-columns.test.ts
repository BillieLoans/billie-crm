/**
 * Unit tests for how report results are read (lib/reports/columns.ts):
 * formats from column names, headings, values, changes, totals, data gaps
 * and small samples.
 */
import { describe, expect, it } from 'vitest'
import {
  columnLabel,
  comparisonKey,
  computeChange,
  conventionalFormat,
  formatAxisValue,
  formatValue,
  isGapLabel,
  isSmallSample,
  isTotalLabel,
  resolveColumns,
  splitRows,
  toTsv,
  wilsonInterval,
} from '@/lib/reports/columns'

describe('conventionalFormat', () => {
  it.each([
    ['approval_rate', 'percent'],
    ['decline_rate_pct', 'percent100'],
    ['share_of_starts_pct', 'percent100'],
    ['cost_usd', 'usd'],
    ['loan_amount', 'currency'],
    ['total_outstanding', 'currency'],
    ['fees_receivable', 'currency'],
    ['total_paid', 'currency'],
    ['funded', 'number'],
    ['approved', 'number'],
    ['median_hours_to_money', 'hours'],
    ['days_overdue', 'days'],
    ['dpd', 'number'],
    ['fee_count', 'integer'],
  ] as const)('%s → %s', (name, format) => {
    expect(conventionalFormat(name, 'number')).toBe(format)
  })

  it('formats by kind for non-numbers', () => {
    expect(conventionalFormat('approval_rate', 'text')).toBe('text')
    expect(conventionalFormat('day', 'date')).toBe('date')
    expect(conventionalFormat('at', 'datetime')).toBe('date')
  })
})

describe('columnLabel', () => {
  it('drops unit suffixes the format already shows', () => {
    expect(columnLabel('decline_rate_pct')).toBe('Decline rate')
    expect(columnLabel('approval_rate')).toBe('Approval rate')
    expect(columnLabel('amount_aud')).toBe('Amount')
    expect(columnLabel('cost_usd')).toBe('Cost (USD)')
    expect(columnLabel('pct')).toBe('Pct')
  })
})

describe('formatValue', () => {
  it('formats rates, percentages, money and units', () => {
    expect(formatValue(0.5934, 'percent')).toBe('59.3%')
    expect(formatValue(35.3, 'percent100')).toBe('35.3%')
    expect(formatValue(8450, 'currency')).toBe('$8,450')
    expect(formatValue(12.5, 'currency')).toBe('$12.50')
    expect(formatValue(22.75, 'hours')).toBe('22.8 h')
    expect(formatValue(1, 'days')).toBe('1 day')
    expect(formatValue(1234.567, 'number')).toBe('1,234.57')
    expect(formatValue(null, 'percent')).toBe('')
  })

  it('shows calendar dates short, without shifting the day', () => {
    expect(formatValue('2026-10-20', 'date', 'date')).toBe('20/10/26')
    expect(formatAxisValue('2026-09-14', 'date')).toBe('14 Sept')
  })

  it('compacts large axis numbers', () => {
    expect(formatAxisValue(25_000, 'currency')).toBe('$25K')
    expect(formatAxisValue(0.4, 'percent')).toBe('40%')
  })
})

describe('computeChange', () => {
  it('measures rates in points and colours by what is better', () => {
    const change = computeChange(0.4, 0.34, 'percent', 'lower')
    expect(change).toMatchObject({ delta: 6, unit: 'pts', direction: 'up', tone: 'bad' })
    expect(change?.text).toBe('up 6 pts')
  })

  it('measures counts as a percentage change', () => {
    expect(computeChange(71, 78, 'number', 'higher')).toMatchObject({
      unit: 'pct',
      direction: 'down',
      tone: 'bad',
    })
  })

  it('is neutral without a direction, and handles a zero base and missing values', () => {
    expect(computeChange(5, 3, 'number')?.tone).toBe('neutral')
    expect(computeChange(5, 0, 'number')).toMatchObject({ unit: 'abs', text: 'up 5' })
    expect(computeChange(null, 3, 'number')).toBeNull()
    expect(computeChange(3, 3, 'number')?.text).toBe('no change')
  })
})

describe('totals and gaps', () => {
  it('recognises total and missing-data labels', () => {
    for (const t of ['All', 'all sources', 'Total', 'Grand total'])
      expect(isTotalLabel(t)).toBe(true)
    for (const t of ['paid', 'allocation', 'other']) expect(isTotalLabel(t)).toBe(false)
    for (const g of ['not recorded', '(not recorded)', 'Unknown', 'n/a']) {
      expect(isGapLabel(g)).toBe(true)
    }
    expect(isGapLabel('other')).toBe(false)
  })

  it('pins totals and puts gaps last, keeping the query order otherwise', () => {
    const columns = [
      { name: 'source', kind: 'text' as const },
      { name: 'n', kind: 'number' as const },
    ]
    const rows = [
      { source: 'not recorded', n: 9 },
      { source: 'paid', n: 5 },
      { source: 'All sources', n: 20 },
      { source: 'direct', n: 6 },
    ]
    const { body, totals } = splitRows(columns, rows)
    expect(body.map((r) => r.source)).toEqual(['paid', 'direct', 'not recorded'])
    expect(totals.map((r) => r.source)).toEqual(['All sources'])
  })
})

describe('resolveColumns and small samples', () => {
  const columns = [
    { name: 'source', kind: 'text' as const },
    { name: 'decided', kind: 'number' as const },
    { name: 'decline_rate_pct', kind: 'number' as const },
  ]

  it('takes the only plain count as a rate base, and settings override', () => {
    const [, decided, rate] = resolveColumns(columns)
    expect(decided.base).toBeUndefined()
    expect(rate).toMatchObject({ format: 'percent100', base: 'decided', minBase: 20 })
    const [, , custom] = resolveColumns(columns, [
      { name: 'decline_rate_pct', label: 'Declined', minBase: 5, better: 'lower' },
    ])
    expect(custom).toMatchObject({ label: 'Declined', minBase: 5, better: 'lower' })
  })

  it('does not guess a base when two counts could be it', () => {
    const [, , , rate] = resolveColumns([
      ...columns.slice(0, 2),
      { name: 'starts', kind: 'number' },
      { name: 'pass_rate', kind: 'number' },
    ])
    expect(rate.base).toBeUndefined()
  })

  it('flags rates on fewer cases than the minimum', () => {
    const [, , rate] = resolveColumns(columns)
    expect(isSmallSample({ decided: 6, decline_rate_pct: 66 }, rate)).toBe(true)
    expect(isSmallSample({ decided: 40, decline_rate_pct: 40 }, rate)).toBe(false)
  })
})

describe('wilsonInterval', () => {
  it('is wide on small samples and narrow on large ones', () => {
    const [lo1, hi1] = wilsonInterval(0.5, 6) as [number, number]
    const [lo2, hi2] = wilsonInterval(0.5, 600) as [number, number]
    expect(hi1 - lo1).toBeGreaterThan(0.6)
    expect(hi2 - lo2).toBeLessThan(0.1)
    expect(wilsonInterval(0.5, 0)).toBeNull()
  })
})

describe('toTsv', () => {
  it('writes the headings and values as shown, with no tabs or newlines inside cells', () => {
    const views = resolveColumns([
      { name: 'source', kind: 'text' },
      { name: 'approval_rate', kind: 'number' },
    ])
    expect(toTsv(views, [{ source: 'a\tb', approval_rate: 0.5 }])).toBe(
      'Source\tApproval rate\na b\t50%',
    )
  })
})

describe('review fixes', () => {
  it('keeps "All other" as a category, not a total', () => {
    expect(isTotalLabel('All other')).toBe(false)
    expect(isTotalLabel('All others')).toBe(false)
  })

  it('matches a row with its previous-period counterpart on every label and the day in the period', () => {
    const columns = [
      { name: 'day', kind: 'date' as const },
      { name: 'channel', kind: 'text' as const },
      { name: 'n', kind: 'number' as const },
    ]
    const keyOf = comparisonKey(columns)
    const current = [
      { day: '2026-10-08', channel: 'paid', n: 1 },
      { day: '2026-10-09', channel: 'paid', n: 2 },
      { day: '2026-10-09', channel: 'direct', n: 3 },
    ]
    const previous = [
      { day: '2026-10-01', channel: 'paid', n: 10 },
      { day: '2026-10-02', channel: 'direct', n: 30 },
      { day: '2026-10-02', channel: 'paid', n: 20 },
    ]
    const now = keyOf(current)
    const before = new Map([...keyOf(previous)].map(([row, key]) => [key, row]))
    expect(current.map((row) => before.get(now.get(row) as string)?.n)).toEqual([10, 20, 30])
  })

  it('counts days from the period start, so an empty first day does not shift the rest', () => {
    const columns = [
      { name: 'day', kind: 'date' as const },
      { name: 'n', kind: 'number' as const },
    ]
    const keyOf = comparisonKey(columns)
    const current = [{ day: '2026-10-09', n: 2 }] // the 8th had no rows
    const previous = [
      { day: '2026-10-01', n: 10 },
      { day: '2026-10-02', n: 20 },
    ]
    const now = keyOf(current, '2026-10-08')
    const before = new Map([...keyOf(previous, '2026-10-01')].map(([row, key]) => [key, row]))
    expect(before.get(now.get(current[0]) as string)?.n).toBe(20)
  })
})
