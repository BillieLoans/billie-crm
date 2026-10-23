/**
 * The checks a report definition must pass, and its preview: the static
 * checks, then a run on its defaults as reporting_reader and the checks on
 * the result. Used by Ask Claude, the report editor's preview, and the
 * report-definitions collection before a publish. No Claude call.
 */
import { bindParameters, type ReportColumn } from '@/lib/schemas/reports'
import { ReportRunError, runReportSql, type RunOptions } from '../runner'
import {
  validateResult,
  validateStatic,
  type DraftDefinition,
  type ValidationIssue,
  type ValidDraft,
} from './validate'

export interface DraftPreview {
  columns: ReportColumn[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  truncated: boolean
  durationMs: number
}

/** Static checks, then a run on the defaults through the runner, then result checks. */
export async function checkAndPreview(
  definition: DraftDefinition,
  runOptions: RunOptions = {},
): Promise<{ valid: ValidDraft | null; issues: ValidationIssue[]; preview?: DraftPreview }> {
  const { valid, issues } = validateStatic(definition)
  if (!valid) return { valid, issues }
  const bound = bindParameters(valid.parameters, {})
  if (!bound.ok) return { valid, issues } // NO_DEFAULT already warns
  try {
    const result = await runReportSql(valid.sql, bound.values, runOptions)
    const all = [...issues, ...validateResult(result.columns, result.rows, valid)]
    return {
      valid: all.some((i) => i.level === 'error') ? null : valid,
      issues: all,
      preview: result,
    }
  } catch (error) {
    const message =
      error instanceof ReportRunError
        ? `${error.message}${error.detail ? ` (${error.detail})` : ''}`
        : 'The query could not be run.'
    return { valid: null, issues: [...issues, { level: 'error', code: 'RUN', message }] }
  }
}
