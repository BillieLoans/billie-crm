/**
 * Checks on the rows a report returned that catch query mistakes: a rate
 * outside its range, a total that does not add up, and a column that is
 * zero or empty everywhere (usually a filter that matches nothing, such as
 * `decision = 'approved'` when the values are upper case).
 *
 * Ask Claude runs them on every draft (errors block saving), and the
 * Reports view shows them to authors after each run. Pure functions only.
 */
import type { ReportColumn } from '@/lib/schemas/reports'
import { isTotalLabel } from './columns'

export interface QualityHint {
  level: 'error' | 'warning'
  code: string
  message: string
}

type Row = Record<string, unknown>

/** Columns that do not add up across rows, so a total row is not their sum. */
const NOT_ADDITIVE = /(rate|pct|percent|median|avg|average|mean|hours|days|share)/i

export function resultHints(columns: readonly ReportColumn[], rows: readonly Row[]): QualityHint[] {
  const hints: QualityHint[] = []

  // Rates within [0, 1]; percentages within [0, 100].
  for (const col of columns) {
    if (col.kind !== 'number') continue
    const isRate = /(^|_)rate$/i.test(col.name)
    const isPct = /(_pct|_percent)$/i.test(col.name)
    if (!isRate && !isPct) continue
    const max = isRate ? 1 : 100
    const bad = rows.find((r) => {
      const v = r[col.name]
      return typeof v === 'number' && (v < 0 || v > max)
    })
    if (bad) {
      hints.push({
        level: 'error',
        code: 'RATE_RANGE',
        message: `${col.name} must be between 0 and ${max}; got ${String(bad[col.name])}`,
      })
    }
  }

  // A total row must equal the sum of the other rows for additive columns.
  const label = columns.find((c) => c.kind === 'text')
  if (label) {
    const totals = rows.filter((r) => isTotalLabel(r[label.name]))
    const parts = rows.filter((r) => !totals.includes(r))
    if (totals.length === 1 && parts.length > 0) {
      for (const col of columns) {
        if (col.kind !== 'number' || NOT_ADDITIVE.test(col.name)) continue
        const values = parts.map((r) => r[col.name])
        if (!values.every((v) => typeof v === 'number' && Number.isInteger(v))) continue
        const sum = (values as number[]).reduce((a, b) => a + b, 0)
        const total = totals[0][col.name]
        if (typeof total === 'number' && total !== sum) {
          hints.push({
            level: 'warning',
            code: 'TOTAL',
            message: `The ${String(totals[0][label.name])} row has ${col.name} ${total}, but the other rows add up to ${sum}`,
          })
        }
      }
    }
  }

  // Zero or empty everywhere: almost always a filter that matched nothing.
  if (rows.length >= 2) {
    for (const col of columns) {
      const values = rows.map((r) => r[col.name])
      if (values.every((v) => v === null || v === undefined)) {
        hints.push({
          level: 'warning',
          code: 'ALL_NULL',
          message: `${col.name} is empty in every row. Check the join or the column it reads.`,
        })
      } else if (col.kind === 'number' && values.every((v) => v === 0)) {
        hints.push({
          level: 'warning',
          code: 'ALL_ZERO',
          message: `${col.name} is 0 in every row. Check the values it filters on (decision values are upper case, for example 'APPROVED').`,
        })
      } else if (
        rows.length >= 4 &&
        values.filter((v) => v === null || v === undefined).length > rows.length / 2
      ) {
        hints.push({
          level: 'warning',
          code: 'MOSTLY_NULL',
          message: `${col.name} is empty in more than half the rows.`,
        })
      }
    }
  }
  return hints
}
