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

/** Slugs the `/api/reports/*` routes and `/admin/reports/*` pages already use. */
export const RESERVED_REPORT_SLUGS: readonly string[] = [
  'jobs',
  'ask',
  'home',
  'new',
  'boards',
  'usage',
  'connections',
  'subscriptions',
  'preferences',
  'preview',
  'events',
  'alerts',
]

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

export const CHART_TYPES = ['line', 'bar', 'area', 'bar-horizontal', 'stacked-100'] as const

export const chartSpecSchema = z.object({
  /**
   * `bar-horizontal` reads best for categories with long names or a ranking;
   * `stacked-100` shows each row's mix as shares of 100%, so mixes compare
   * whatever the volume.
   */
  type: z.enum(CHART_TYPES),
  /** Result column on the category / horizontal axis. */
  x: z.string().min(1),
  series: z
    .array(z.object({ column: z.string().min(1), label: z.string().max(60).optional() }))
    .min(1)
    .max(8),
  stacked: z.boolean().optional(),
  /**
   * Category bars are sorted by their first series, largest first, unless
   * `none`. Dates and numbers on the axis always keep their order.
   */
  sort: z.enum(['value', 'none']).optional(),
  /**
   * Days in a rolling average drawn over a daily line, the raw line faded
   * behind it. Daily lines longer than three weeks get a 7-day average
   * unless this is 0.
   */
  rollingAverage: z.number().int().min(0).max(90).optional(),
  /** Clicking a category opens this report with the category as this parameter. */
  drill: z
    .object({
      report: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      parameter: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    })
    .optional(),
})

export type ChartSpec = z.infer<typeof chartSpecSchema>

/** A report shows up to two charts: one chart spec, or a list of one or two. */
export const chartsSchema = z.union([chartSpecSchema, z.array(chartSpecSchema).min(1).max(2)])

/** A stored chart value as a list (empty when there is none or it is invalid). */
export function normaliseCharts(value: unknown): ChartSpec[] {
  if (value === null || value === undefined) return []
  const parsed = chartsSchema.safeParse(value)
  if (!parsed.success) return []
  return Array.isArray(parsed.data) ? parsed.data : [parsed.data]
}

/** How a result column is shown. Unset, the column name decides (see `lib/reports/columns.ts`). */
export const COLUMN_FORMATS = [
  'number',
  'integer',
  'percent',
  'percent100',
  'currency',
  'usd',
  'hours',
  'days',
  'date',
  'text',
] as const
export type ColumnFormat = (typeof COLUMN_FORMATS)[number]

/** Optional per-column display settings. */
export const columnSpecSchema = z.object({
  name: z.string().min(1).max(63),
  label: z.string().trim().min(1).max(60).optional(),
  format: z.enum(COLUMN_FORMATS).optional(),
  /** What the column means, shown under "About this report". */
  description: z.string().max(300).optional(),
  /** For a rate: the count it is a share of. Rates on small bases are flagged. */
  base: z.string().min(1).max(63).optional(),
  /** Below this base a rate is flagged as a small sample (default 20). */
  minBase: z.number().int().min(1).max(100_000).optional(),
  /** Whether a rise is good news. Colours the change against the previous period. */
  better: z.enum(['higher', 'lower']).optional(),
})
export type ColumnSpec = z.infer<typeof columnSpecSchema>
export const columnSpecsSchema = z.array(columnSpecSchema).max(50)

/** How a headline tile reduces a column to one number. */
export const HEADLINE_VALUES = [
  'total',
  'sum',
  'last',
  'first',
  'average',
  'max',
  'min',
  'ratio',
] as const

export const headlineSpecSchema = z
  .object({
    column: z.string().min(1).max(63),
    label: z.string().trim().min(1).max(60).optional(),
    /**
     * `total` (the default) reads the All/Total row, or sums a count column
     * when there is none. `ratio` is the sum of `numerator` over the sum of
     * `denominator`: the right way to total a rate across weeks. Other
     * values reduce the rows that are not totals.
     */
    value: z.enum(HEADLINE_VALUES).optional(),
    numerator: z.string().min(1).max(63).optional(),
    denominator: z.string().min(1).max(63).optional(),
    better: z.enum(['higher', 'lower']).optional(),
  })
  .refine((h) => h.value !== 'ratio' || (h.numerator && h.denominator), {
    message: 'A ratio headline needs a numerator and a denominator column',
  })
export type HeadlineSpec = z.infer<typeof headlineSpecSchema>
export const headlineSpecsSchema = z.array(headlineSpecSchema).max(4)

/** Where a report sits in the catalogue. */
export const REPORT_CATEGORIES = [
  { value: 'acquisition', label: 'Acquisition' },
  { value: 'credit', label: 'Credit decisions' },
  { value: 'loan_book', label: 'Loan book' },
  { value: 'arrears', label: 'Arrears & collections' },
  { value: 'operations', label: 'Operations' },
  { value: 'finance', label: 'Finance' },
  { value: 'other', label: 'Other' },
] as const
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]['value']
export const REPORT_CATEGORY_VALUES = REPORT_CATEGORIES.map((c) => c.value) as [
  ReportCategory,
  ...ReportCategory[],
]

export function categoryLabel(value: string | null | undefined): string {
  return REPORT_CATEGORIES.find((c) => c.value === value)?.label ?? 'Other'
}

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
  return value === undefined || value === null || (typeof value === 'string' && !value.trim())
}

/** A real calendar date as `YYYY-MM-DD` (rejects 2026-02-30, which Date rolls over). */
function isRealDate(text: string): boolean {
  if (!DATE_RE.test(text)) return false
  const parsed = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
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
    // Own properties only: a parameter named `constructor` must not read
    // Object.prototype.
    let raw = Object.hasOwn(submitted, param.name) ? submitted[param.name] : undefined
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
      const text = String(raw).trim()
      if (!isRealDate(text)) {
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
