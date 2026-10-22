/**
 * Report definitions (BTB-506): parameter and chart schemas shared by the
 * `report-definitions` collection, the report runner and the Reports view.
 *
 * A report's SQL reads parameter N as `$N`, in the order the parameters are
 * listed. Values are always bound, never interpolated.
 */
import { z } from 'zod'
import { sydneyDateString } from '@/lib/disbursement-cutoff'

/** Roles a report can be shared with. Marketing stays behind the lending wall. */
export const REPORT_VIEWER_ROLES = ['admin', 'supervisor', 'operations', 'readonly'] as const
export type ReportViewerRole = (typeof REPORT_VIEWER_ROLES)[number]

/** Roles that author reports: create, edit, publish and run drafts. */
export const REPORT_AUTHOR_ROLES: readonly string[] = ['admin', 'supervisor']

/** Slugs the `/api/reports/*` routes already use. */
export const RESERVED_REPORT_SLUGS: readonly string[] = ['jobs']

export const REPORT_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A date default: `today`, `today-N` (N days before today) or a fixed
 * `YYYY-MM-DD`. Relative defaults are Sydney dates, resolved when the
 * report runs, so a scheduled report always covers the period it should.
 */
const DATE_DEFAULT_RE = /^(today(-\d{1,4})?|\d{4}-\d{2}-\d{2})$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const reportParameterSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lower case letters, digits and underscores'),
    label: z.string().trim().min(1).max(80),
    type: z.enum(['date', 'text', 'integer', 'number', 'select', 'boolean']),
    required: z.boolean().default(true),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    options: z
      .array(z.object({ value: z.string().min(1).max(100), label: z.string().min(1).max(100) }))
      .max(50)
      .optional(),
    help: z.string().max(200).optional(),
  })
  .superRefine((param, ctx) => {
    if (param.type === 'select' && !param.options?.length) {
      ctx.addIssue({ code: 'custom', message: `${param.name}: a select needs options` })
    }
    if (param.type === 'date' && param.default !== undefined) {
      if (typeof param.default !== 'string' || !DATE_DEFAULT_RE.test(param.default)) {
        ctx.addIssue({
          code: 'custom',
          message: `${param.name}: a date default is today, today-N or YYYY-MM-DD`,
        })
      }
    }
  })

export type ReportParameter = z.infer<typeof reportParameterSchema>

export const reportParametersSchema = z
  .array(reportParameterSchema)
  .max(10)
  .superRefine((params, ctx) => {
    const seen = new Set<string>()
    for (const p of params) {
      if (seen.has(p.name)) {
        ctx.addIssue({ code: 'custom', message: `Parameter ${p.name} is listed twice` })
      }
      seen.add(p.name)
    }
  })

export const chartSpecSchema = z.object({
  type: z.enum(['line', 'bar', 'area']),
  /** Result column on the horizontal axis. */
  x: z.string().min(1),
  series: z
    .array(z.object({ column: z.string().min(1), label: z.string().max(60).optional() }))
    .min(1)
    .max(8),
  stacked: z.boolean().optional(),
})

export type ChartSpec = z.infer<typeof chartSpecSchema>

/** A column of a report result, with the kind the view formats it as. */
export interface ReportColumn {
  name: string
  kind: 'number' | 'date' | 'datetime' | 'boolean' | 'text'
}

/** Resolve a date default to a Sydney `YYYY-MM-DD`. */
export function resolveDateDefault(value: string, now: Date = new Date()): string {
  if (DATE_RE.test(value)) return value
  const match = /^today(?:-(\d+))?$/.exec(value)
  if (!match) return value
  const days = Number(match[1] ?? 0)
  // Step back whole days from Sydney today at noon UTC, clear of DST edges.
  const today = sydneyDateString(now)
  const noon = new Date(`${today}T12:00:00Z`)
  noon.setUTCDate(noon.getUTCDate() - days)
  return noon.toISOString().slice(0, 10)
}

/** The value a parameter starts with in the form, or undefined. */
export function parameterDefault(param: ReportParameter, now: Date = new Date()): unknown {
  if (param.default === undefined) return undefined
  if (param.type === 'date' && typeof param.default === 'string') {
    return resolveDateDefault(param.default, now)
  }
  return param.default
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * Validate submitted values against a report's parameters and return them in
 * `$1..$n` order. Blank values take the parameter's default.
 *
 * @returns the bound values, or the first problem per parameter name.
 */
export function bindParameters(
  params: readonly ReportParameter[],
  submitted: Record<string, unknown>,
  now: Date = new Date(),
): { ok: true; values: unknown[] } | { ok: false; errors: Record<string, string> } {
  const values: unknown[] = []
  const errors: Record<string, string> = {}
  for (const param of params) {
    let raw = submitted[param.name]
    if (isBlank(raw)) raw = parameterDefault(param, now)
    if (isBlank(raw)) {
      if (param.required) errors[param.name] = `Enter ${param.label.toLowerCase()}`
      values.push(null)
      continue
    }
    const parsed = parseValue(param, raw)
    if (parsed.ok) values.push(parsed.value)
    else {
      errors[param.name] = parsed.error
      values.push(null)
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values }
}

function parseValue(
  param: ReportParameter,
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const label = param.label
  switch (param.type) {
    case 'date': {
      const text = String(raw)
      if (!DATE_RE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
        return { ok: false, error: `${label} must be a real date` }
      }
      return { ok: true, value: text }
    }
    case 'integer': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
      if (!Number.isSafeInteger(n)) return { ok: false, error: `${label} must be a whole number` }
      return { ok: true, value: n }
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
      if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number` }
      return { ok: true, value: n }
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      if (raw === 'true' || raw === 'false') return { ok: true, value: raw === 'true' }
      return { ok: false, error: `${label} must be yes or no` }
    }
    case 'select': {
      const text = String(raw)
      if (!param.options?.some((o) => o.value === text)) {
        return { ok: false, error: `Choose one of the listed options for ${label.toLowerCase()}` }
      }
      return { ok: true, value: text }
    }
    case 'text': {
      const text = String(raw)
      if (text.length > 200) return { ok: false, error: `${label} must be 200 characters or fewer` }
      return { ok: true, value: text }
    }
  }
}
