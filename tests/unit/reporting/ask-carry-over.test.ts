/**
 * Unit tests for keeping what Claude cannot express when it rewrites a
 * report: drill-downs, sorting, averages, formats and thresholds.
 */
import { describe, expect, it } from 'vitest'
import { carryOver } from '@/server/reporting/ask/draft'

const base = {
  title: 't',
  description: '',
  sql: 'SELECT 1',
  parameters: [],
}

describe('carryOver', () => {
  it("keeps a chart's drill-down, sort and average when the same chart is still there", () => {
    const previous = {
      ...base,
      chart: [
        {
          type: 'bar-horizontal',
          x: 'source',
          series: [{ column: 'n' }],
          drill: { report: 'daily-applications', parameter: 'source' },
          sort: 'none',
        },
      ],
    }
    const next = {
      ...base,
      chart: [
        { type: 'bar-horizontal', x: 'source', series: [{ column: 'n', label: 'N' }] },
        { type: 'line', x: 'week', series: [{ column: 'n' }] },
      ],
    }
    expect(carryOver(previous, next).chart).toEqual([
      {
        type: 'bar-horizontal',
        x: 'source',
        series: [{ column: 'n', label: 'N' }],
        drill: { report: 'daily-applications', parameter: 'source' },
        sort: 'none',
      },
      { type: 'line', x: 'week', series: [{ column: 'n' }] },
    ])
  })

  it('keeps column formats and thresholds, and settings for columns Claude left out', () => {
    const previous = {
      ...base,
      chart: null,
      columnSettings: [
        { name: 'amount', format: 'currency', minBase: 5 },
        { name: 'rate_pct', format: 'percent100', label: 'Rate' },
      ],
    }
    const next = {
      ...base,
      chart: null,
      columnSettings: [{ name: 'amount', description: 'Money lent' }],
    }
    expect(carryOver(previous, next).columnSettings).toEqual([
      { name: 'amount', description: 'Money lent', format: 'currency', minBase: 5 },
      { name: 'rate_pct', format: 'percent100', label: 'Rate' },
    ])
    expect(carryOver(previous, next).chart).toBeNull()
  })
})
