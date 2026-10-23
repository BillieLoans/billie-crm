/**
 * Unit tests for report parameter and chart schemas (BTB-506): definition
 * validation, Sydney date defaults and binding submitted values to $1..$n.
 */
import { describe, test, expect } from 'vitest'
import {
  bindParameters,
  chartSpecSchema,
  reportParametersSchema,
  resolveDateDefault,
  type ReportParameter,
} from '@/lib/schemas/reports'

// 2026-10-21 23:30 UTC is 22 October 10:30 in Sydney.
const NOW = new Date('2026-10-21T23:30:00Z')

function params(list: unknown[]): ReportParameter[] {
  return reportParametersSchema.parse(list)
}

describe('reportParametersSchema', () => {
  test('fills in required: true by default', () => {
    expect(params([{ name: 'from', label: 'From', type: 'date' }])[0].required).toBe(true)
  })

  test('rejects duplicate names, bad names, selects without options and bad date defaults', () => {
    const bad = [
      [
        { name: 'a', label: 'A', type: 'text' },
        { name: 'a', label: 'B', type: 'text' },
      ],
      [{ name: 'From', label: 'A', type: 'text' }],
      [{ name: 'a', label: 'A', type: 'select' }],
      [{ name: 'a', label: 'A', type: 'date', default: 'yesterday' }],
      [{ name: 'a', label: 'A', type: 'sql' }],
    ]
    for (const list of bad) expect(reportParametersSchema.safeParse(list).success).toBe(false)
  })
})

describe('resolveDateDefault', () => {
  test('uses the Sydney date, not the UTC one', () => {
    expect(resolveDateDefault('today', NOW)).toBe('2026-10-22')
    expect(resolveDateDefault('today-7', NOW)).toBe('2026-10-15')
    expect(resolveDateDefault('today-30', NOW)).toBe('2026-09-22')
    expect(resolveDateDefault('2026-01-31', NOW)).toBe('2026-01-31')
  })
})

describe('bindParameters', () => {
  const defs = params([
    { name: 'from', label: 'From', type: 'date', default: 'today-7' },
    { name: 'min', label: 'Minimum', type: 'integer', required: false },
    {
      name: 'outcome',
      label: 'Outcome',
      type: 'select',
      options: [{ value: 'APPROVED', label: 'Approved' }],
    },
    { name: 'mock', label: 'Include mock', type: 'boolean', default: false },
  ])

  test('returns values in $1..$n order, defaults included', () => {
    expect(bindParameters(defs, { outcome: 'APPROVED' }, NOW)).toEqual({
      ok: true,
      values: ['2026-10-15', null, 'APPROVED', false],
    })
  })

  test('coerces form strings to their types', () => {
    const bound = bindParameters(
      defs,
      { from: '2026-10-01', min: ' 12 ', outcome: 'APPROVED', mock: 'true' },
      NOW,
    )
    expect(bound).toEqual({ ok: true, values: ['2026-10-01', 12, 'APPROVED', true] })
  })

  test('reports a message per field', () => {
    const bound = bindParameters(defs, { from: '2026-02-30x', min: '1.5', outcome: 'DROP' }, NOW)
    expect(bound.ok).toBe(false)
    if (!bound.ok) {
      expect(bound.errors).toEqual({
        from: 'From must be a real date',
        min: 'Minimum must be a whole number',
        outcome: 'Choose one of the listed options for outcome',
      })
    }
  })

  test('a required parameter with no value and no default is reported', () => {
    const bound = bindParameters(defs, {}, NOW)
    expect(bound.ok).toBe(false)
    if (!bound.ok) expect(bound.errors).toEqual({ outcome: 'Enter outcome' })
  })

  test('impossible dates, blank numbers and prototype names are handled', () => {
    const dates = params([{ name: 'd', label: 'Day', type: 'date' }])
    expect(bindParameters(dates, { d: '2026-02-30' })).toEqual({
      ok: false,
      errors: { d: 'Day must be a real date' },
    })
    expect(bindParameters(dates, { d: '2028-02-29' })).toEqual({ ok: true, values: ['2028-02-29'] })

    const n = params([{ name: 'n', label: 'Count', type: 'integer', required: false }])
    expect(bindParameters(n, { n: '   ' })).toEqual({ ok: true, values: [null] })

    const proto = params([{ name: 'constructor', label: 'Code', type: 'text', required: false }])
    expect(bindParameters(proto, {})).toEqual({ ok: true, values: [null] })
  })

  test('text is passed as a value, never spliced into SQL', () => {
    const text = params([{ name: 'code', label: 'Code', type: 'text' }])
    expect(bindParameters(text, { code: "x'; DROP TABLE y; --" })).toEqual({
      ok: true,
      values: ["x'; DROP TABLE y; --"],
    })
  })
})

describe('chartSpecSchema', () => {
  test('accepts a line chart and refuses unknown types or no series', () => {
    expect(
      chartSpecSchema.safeParse({ type: 'line', x: 'day', series: [{ column: 'n' }] }).success,
    ).toBe(true)
    expect(
      chartSpecSchema.safeParse({ type: 'pie', x: 'day', series: [{ column: 'n' }] }).success,
    ).toBe(false)
    expect(chartSpecSchema.safeParse({ type: 'bar', x: 'day', series: [] }).success).toBe(false)
  })
})
