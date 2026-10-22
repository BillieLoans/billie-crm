/**
 * Unit tests for the deterministic checks on Claude-drafted report
 * definitions (BTB-508).
 */
import { describe, test, expect } from 'vitest'
import {
  validateResult,
  validateStatic,
  type DraftDefinition,
} from '@/server/reporting/ask/validate'

const BASE: DraftDefinition = {
  title: 'Decisions by day',
  description: 'Decisions per Sydney day.',
  sql: `SELECT decided_on, count(*) AS decided
          FROM decision WHERE decided_on >= $1::date AND NOT mock_origin
         GROUP BY 1 ORDER BY 1`,
  parameters: [{ name: 'from', label: 'From', type: 'date', default: 'today-30' }],
  chart: { type: 'line', x: 'decided_on', series: [{ column: 'decided' }] },
}

function codes(draft: Partial<DraftDefinition>) {
  return validateStatic({ ...BASE, ...draft }).issues.map((i) => `${i.level}:${i.code}`)
}

describe('validateStatic', () => {
  test('a sound definition passes with parsed parameters and chart', () => {
    const { valid, issues } = validateStatic(BASE)
    expect(issues).toEqual([])
    expect(valid?.parameters[0]).toMatchObject({ name: 'from', required: true })
    expect(valid?.chart).toMatchObject({ type: 'line' })
  })

  test('refuses more than one statement and non-SELECT SQL', () => {
    expect(codes({ sql: 'SELECT 1; DELETE FROM decision', parameters: [] })).toContain('error:SQL')
    expect(codes({ sql: 'UPDATE decision SET reason = 1', parameters: [] })).toContain('error:SQL')
  })

  test('refuses a relation outside the reporting schema', () => {
    expect(
      codes({ sql: 'SELECT count(*) AS n FROM public.users WHERE $1::date IS NOT NULL' }),
    ).toContain('error:SCHEMA')
    expect(
      codes({
        sql: 'SELECT count(*) AS n FROM reporting.decision d JOIN pg_catalog.pg_user u ON true WHERE $1::date IS NOT NULL AND NOT d.mock_origin',
      }),
    ).toContain('error:SCHEMA')
    // alias.column is not a schema-qualified relation.
    expect(
      codes({
        sql: 'SELECT d.decision FROM reporting.decision AS d WHERE d.decided_on >= $1::date AND NOT d.mock_origin',
      }),
    ).toEqual([])
  })

  test('parameters and placeholders must line up', () => {
    expect(codes({ sql: 'SELECT 1 AS n FROM decision WHERE NOT mock_origin' })).toContain(
      'error:PLACEHOLDERS',
    )
    expect(codes({ parameters: [{ name: 'From', label: 'x', type: 'date' }] })).toContain(
      'error:PARAMETERS',
    )
  })

  test('warns about date filters on instants, revision counts and missing mock exclusion', () => {
    expect(
      codes({
        sql: 'SELECT count(*) AS n FROM decision WHERE decided_at >= $1::date AND NOT mock_origin',
      }),
    ).toContain('warning:DATE_COLUMN')
    expect(
      codes({
        sql: "SELECT count(*) AS n FROM decision WHERE decided_at::date = DATE '2026-10-01' AND $1::date IS NOT NULL AND NOT mock_origin",
      }),
    ).toContain('warning:DATE_COLUMN')
    expect(
      codes({
        sql: 'SELECT count(*) AS n FROM decision_event WHERE decided_on >= $1::date AND NOT mock_origin',
      }),
    ).toContain('warning:DECISION_EVENT')
    expect(
      codes({ sql: 'SELECT count(*) AS n FROM decision WHERE decided_on >= $1::date' }),
    ).toContain('warning:MOCK')
  })

  test('warns when a required parameter has no default', () => {
    expect(codes({ parameters: [{ name: 'from', label: 'From', type: 'date' }] })).toContain(
      'warning:NO_DEFAULT',
    )
  })
})

describe('validateResult', () => {
  const cols = [
    { name: 'segment', kind: 'text' as const },
    { name: 'decided', kind: 'number' as const },
    { name: 'approval_rate', kind: 'number' as const },
    { name: 'decline_pct', kind: 'number' as const },
  ]

  test('rates must lie in [0, 1] and percentages in [0, 100]', () => {
    expect(
      validateResult(cols, [{ segment: 'a', decided: 3, approval_rate: 0.5, decline_pct: 50 }]),
    ).toEqual([])
    const issues = validateResult(cols, [
      { segment: 'a', decided: 3, approval_rate: 50, decline_pct: 120 },
    ])
    expect(issues.map((i) => i.code)).toEqual(['RATE_RANGE', 'RATE_RANGE'])
  })

  test('a total row must reconcile with the rows above it', () => {
    const ok = [
      { segment: 'paid', decided: 2, approval_rate: 0.5, decline_pct: 50 },
      { segment: 'organic', decided: 1, approval_rate: 0, decline_pct: 100 },
      { segment: 'All', decided: 3, approval_rate: 0.33, decline_pct: 66.7 },
    ]
    expect(validateResult(cols, ok)).toEqual([])
    const wrong = [...ok.slice(0, 2), { ...ok[2], decided: 4 }]
    expect(validateResult(cols, wrong)).toEqual([
      expect.objectContaining({
        level: 'warning',
        code: 'TOTAL',
        message: expect.stringMatching(/decided 4.*add up to 3/),
      }),
    ])
  })
})
