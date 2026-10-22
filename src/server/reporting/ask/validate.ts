/**
 * Deterministic checks on a report definition drafted by Claude (BTB-508).
 *
 * Run on every generated or edited definition, before an author sees or
 * saves it. Errors block saving; warnings are shown to the author. They do
 * not replace the runner's controls (read-only `reporting_reader`, timeout,
 * row cap), which apply to every run anyway.
 *
 * Static checks read the SQL; result checks read the rows the runner
 * returned. Neither sends anything to Claude.
 */
import {
  chartSpecSchema,
  reportParametersSchema,
  type ChartSpec,
  type ReportColumn,
  type ReportParameter,
} from '@/lib/schemas/reports'
import { checkPlaceholders, checkReportSql, stripLiterals } from '../sql-guard'

export interface DraftDefinition {
  title: string
  description: string
  sql: string
  parameters: unknown
  chart: unknown
}

export interface ValidDraft {
  title: string
  description: string
  sql: string
  parameters: ReportParameter[]
  chart: ChartSpec | null
}

export interface ValidationIssue {
  level: 'error' | 'warning'
  code: string
  message: string
}

const TOTAL_LABELS = new Set(['all', 'all sources', 'total'])
const NOT_ADDITIVE = /(rate|pct|percent|median|avg|average|mean|hours|days|share)/i

/**
 * Check the definition without running it.
 *
 * @returns the definition with parsed parameters and chart when there are
 *   no errors, and every issue found.
 */
export function validateStatic(draft: DraftDefinition): {
  valid: ValidDraft | null
  issues: ValidationIssue[]
} {
  const issues: ValidationIssue[] = []
  const error = (code: string, message: string) => issues.push({ level: 'error', code, message })
  const warn = (code: string, message: string) => issues.push({ level: 'warning', code, message })

  if (!draft.title?.trim()) error('TITLE', 'The report needs a title')
  else if (draft.title.length > 120) error('TITLE', 'The title must be 120 characters or fewer')
  if ((draft.description ?? '').length > 1000) {
    error('DESCRIPTION', 'The description must be 1,000 characters or fewer')
  }

  const params = reportParametersSchema.safeParse(draft.parameters ?? [])
  if (!params.success) error('PARAMETERS', `Parameters: ${params.error.issues[0]?.message}`)
  const chart =
    draft.chart === null || draft.chart === undefined
      ? { success: true as const, data: null }
      : chartSpecSchema.safeParse(draft.chart)
  if (!chart.success) error('CHART', `Chart: ${chart.error.issues[0]?.message}`)

  const sql = checkReportSql(draft.sql)
  if (!sql.ok) {
    error('SQL', sql.error)
  } else {
    if (params.success) {
      const placeholderProblem = checkPlaceholders(sql.placeholders, params.data.length)
      if (placeholderProblem) error('PLACEHOLDERS', placeholderProblem)
      const noDefault = params.data.filter((p) => p.required && p.default === undefined)
      if (noDefault.length) {
        warn(
          'NO_DEFAULT',
          `Give ${noDefault.map((p) => p.name).join(', ')} a default so the report can be previewed and scheduled`,
        )
      }
    }
    const code = stripLiterals(draft.sql) ?? ''

    // reporting.* only: a schema-qualified relation after FROM or JOIN must
    // be in reporting. (The runner's role enforces this anyway.)
    for (const m of code.matchAll(/\b(?:FROM|JOIN)\s+"?([A-Za-z_][\w$]*)"?\s*\.\s*"?[A-Za-z_]/gi)) {
      if (m[1].toLowerCase() !== 'reporting') {
        error('SCHEMA', `Reports read only the reporting schema, not ${m[1]}`)
      }
    }

    // Dates: filter and group on Sydney-day columns, not on instants.
    if (
      /\b\w+_at\b\s*(?:::\s*date\b)?\s*(?:>=|<=|<|>|=|BETWEEN)\s*(?:\$\d+|DATE\b|'|CURRENT_DATE|now\s*\()/i.test(
        code,
      ) ||
      /\b\w+_at\s*::\s*date\b/i.test(code) ||
      /\b(?:date|date_trunc)\s*\(\s*(?:'[^']*'\s*,\s*)?\w+_at\b/i.test(code) ||
      /\bCAST\s*\(\s*\w+_at\s+AS\s+date\b/i.test(code)
    ) {
      warn(
        'DATE_COLUMN',
        'Filter and group dates with the Sydney-day *_on columns; a *_at column gives the UTC day',
      )
    }
    if (/\bdecision_event\b/i.test(code)) {
      warn(
        'DECISION_EVENT',
        'decision_event counts every revision of a decision; use decision for counts and rates',
      )
    }
    if (/\b(?:decision|application|loan)\b/i.test(code) && !/\bmock_origin\b/i.test(code)) {
      warn(
        'MOCK',
        'Mock decisions are not excluded; join decision and keep mock_origin IS NOT TRUE',
      )
    }
  }

  const ok = !issues.some((i) => i.level === 'error')
  return {
    valid:
      ok && params.success && chart.success && sql.ok
        ? {
            title: draft.title.trim(),
            description: (draft.description ?? '').trim(),
            sql: sql.sql,
            parameters: params.data,
            chart: chart.data,
          }
        : null,
    issues,
  }
}

/** Check the rows a definition returned. */
export function validateResult(
  columns: readonly ReportColumn[],
  rows: ReadonlyArray<Record<string, unknown>>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

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
      issues.push({
        level: 'error',
        code: 'RATE_RANGE',
        message: `${col.name} must be between 0 and ${max}; got ${String(bad[col.name])}`,
      })
    }
  }

  // A total row must equal the sum of the other rows for additive columns.
  const label = columns.find((c) => c.kind === 'text')
  if (label) {
    const totals = rows.filter((r) => TOTAL_LABELS.has(String(r[label.name] ?? '').toLowerCase()))
    const parts = rows.filter((r) => !totals.includes(r))
    if (totals.length === 1 && parts.length > 0) {
      for (const col of columns) {
        if (col.kind !== 'number' || NOT_ADDITIVE.test(col.name)) continue
        const values = parts.map((r) => r[col.name])
        if (!values.every((v) => typeof v === 'number' && Number.isInteger(v))) continue
        const sum = (values as number[]).reduce((a, b) => a + b, 0)
        const total = totals[0][col.name]
        if (typeof total === 'number' && total !== sum) {
          issues.push({
            level: 'warning',
            code: 'TOTAL',
            message: `The ${String(totals[0][label.name])} row has ${col.name} ${total}, but the other rows add up to ${sum}`,
          })
        }
      }
    }
  }
  return issues
}
