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
  chartsSchema,
  columnSpecsSchema,
  headlineSpecsSchema,
  reportParametersSchema,
  REPORT_CATEGORY_VALUES,
  type ChartSpec,
  type ColumnSpec,
  type HeadlineSpec,
  type ReportCategory,
  type ReportColumn,
  type ReportParameter,
} from '@/lib/schemas/reports'
import { chartProblem } from '@/lib/reports/chart-data'
import { resultHints } from '@/lib/reports/quality'
import { checkPlaceholders, checkReportSql, stripLiterals } from '../sql-guard'

export interface DraftDefinition {
  title: string
  description: string
  sql: string
  parameters: unknown
  chart: unknown
  headline?: unknown
  columnSettings?: unknown
  category?: unknown
}

export interface ValidDraft {
  title: string
  description: string
  sql: string
  parameters: ReportParameter[]
  chart: ChartSpec | ChartSpec[] | null
  headline: HeadlineSpec[]
  columnSettings: ColumnSpec[]
  category: ReportCategory
}

export interface ValidationIssue {
  level: 'error' | 'warning'
  code: string
  message: string
}

/** Schemas other than `reporting` (and any `pg_*` one). */
const OTHER_SCHEMAS = new Set(['public', 'information_schema', 'portal'])

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
      : chartsSchema.safeParse(draft.chart)
  if (!chart.success) error('CHART', `Chart: ${chart.error.issues[0]?.message}`)
  const headline = headlineSpecsSchema.safeParse(draft.headline ?? [])
  if (!headline.success) error('HEADLINE', `Headline: ${headline.error.issues[0]?.message}`)
  const columnSettings = columnSpecsSchema.safeParse(draft.columnSettings ?? [])
  if (!columnSettings.success) {
    error('COLUMNS', `Column settings: ${columnSettings.error.issues[0]?.message}`)
  }
  const category = (REPORT_CATEGORY_VALUES as readonly unknown[]).includes(draft.category)
    ? (draft.category as ReportCategory)
    : 'other'

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

    // reporting.* only: flag a name qualified by another schema. Aliases
    // (`d.decided_at`, `extract(epoch FROM d.x)`) are not schemas, so only
    // the schemas a database has besides `reporting` count. Quoted names are
    // blanked in `code` but keep their place, so read them from the SQL.
    // (The runner's login role enforces this anyway.)
    const schemas = new Set<string>()
    for (const m of code.matchAll(/("[^"]*"|\b[A-Za-z_][\w$]*)\s*\.\s*(?=["A-Za-z_])/g)) {
      const raw = m[1].startsWith('"')
        ? draft.sql.slice(m.index + 1, m.index + m[1].length - 1)
        : m[1].toLowerCase()
      if (OTHER_SCHEMAS.has(raw) || raw.startsWith('pg_')) schemas.add(raw)
    }
    for (const schema of schemas) {
      error('SCHEMA', `Reports read only the reporting schema, not ${schema}`)
    }

    // Dates: filter and group on Sydney-day columns, not on instants.
    if (
      /\b\w+_at\b\s*(?:::\s*date\b)?\s*(?:>=|<=|<|>|=|BETWEEN)\s*(?:\$\d+|DATE\b|'|CURRENT_DATE|now\s*\()/i.test(
        code,
      ) ||
      /(?:\$\d+|'|CURRENT_DATE|now\s*\(\s*\))\s*(?:::\s*\w+\s*)?(?:>=|<=|<|>|=)\s*\w+_at\b/i.test(
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
      ok && params.success && chart.success && headline.success && columnSettings.success && sql.ok
        ? {
            title: draft.title.trim(),
            description: (draft.description ?? '').trim(),
            sql: sql.sql,
            parameters: params.data,
            chart: chart.data,
            headline: headline.data,
            columnSettings: columnSettings.data,
            category,
          }
        : null,
    issues,
  }
}

/**
 * Check the rows a definition returned (`lib/reports/quality.ts`), and,
 * given the definition, that its charts and headline read columns the
 * result has.
 */
export function validateResult(
  columns: readonly ReportColumn[],
  rows: ReadonlyArray<Record<string, unknown>>,
  presentation?: Pick<ValidDraft, 'chart' | 'headline' | 'columnSettings'>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = resultHints(columns, rows)
  if (!presentation) return issues
  const charts = presentation.chart === null ? [] : [presentation.chart].flat()
  for (const chart of charts) {
    const problem = chartProblem(chart, columns)
    if (problem) issues.push({ level: 'error', code: 'CHART', message: problem })
  }
  const names = new Set(columns.map((c) => c.name))
  for (const h of presentation.headline) {
    const missing = [h.column, h.numerator, h.denominator].filter(
      (c): c is string => c !== undefined && !names.has(c),
    )
    if (missing.length) {
      issues.push({
        level: 'error',
        code: 'HEADLINE',
        message: `The headline "${h.label ?? h.column}" reads ${missing.join(', ')}, which the results do not have`,
      })
    }
  }
  for (const c of presentation.columnSettings) {
    if (!names.has(c.name) || (c.base && !names.has(c.base))) {
      issues.push({
        level: 'warning',
        code: 'COLUMNS',
        message: `Column settings name ${!names.has(c.name) ? c.name : c.base}, which the results do not have`,
      })
    }
  }
  return issues
}
