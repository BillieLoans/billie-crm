import type {
  Access,
  CollectionBeforeChangeHook,
  CollectionBeforeOperationHook,
  CollectionConfig,
  FieldHook,
  Validate,
} from 'payload'
import { Forbidden, ValidationError } from 'payload'
import { hasApprovalAuthority, isAdmin } from '@/lib/access'
import {
  REPORT_SLUG_RE,
  REPORT_VIEWER_ROLES,
  REPORT_CATEGORIES,
  RESERVED_REPORT_SLUGS,
  chartsSchema,
  columnSpecsSchema,
  headlineSpecsSchema,
  reportParametersSchema,
} from '@/lib/schemas/reports'
import { checkPlaceholders, checkReportSql } from '@/server/reporting/sql-guard'
import { checkAndPreview } from '@/server/reporting/ask/preview'

/** Admins and supervisors author reports. */
const canAuthor: Access = ({ req }) => hasApprovalAuthority(req.user)

function firstIssue(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid value'
  const where = issue.path.length ? `${issue.path.join('.')}: ` : ''
  return `${where}${issue.message}`
}

const validateSlug: Validate = (value) => {
  if (typeof value !== 'string' || !REPORT_SLUG_RE.test(value)) {
    return 'Use lower case letters, digits and single hyphens, for example "weekly-approvals"'
  }
  if (RESERVED_REPORT_SLUGS.includes(value)) return `"${value}" is reserved`
  return true
}

/**
 * The slug rule, for drafts too: Payload skips field validation on a draft
 * save, and a draft at a reserved link (`new`, `ask`, ...) could never be
 * opened from Reports. The unique index still applies to drafts.
 */
const slugEvenForDrafts: CollectionBeforeChangeHook = ({ data, collection }) => {
  if (data.slug === undefined) return data
  const result = validateSlug(data.slug, {} as never)
  if (result !== true) {
    throw new ValidationError({
      collection: collection.slug,
      errors: [{ path: 'slug', message: String(result) }],
    })
  }
  return data
}

/**
 * A publish over the API (the report editor, the Payload admin) runs the
 * same checks as an Ask Claude draft, the run on its defaults included,
 * and is refused on any error: nothing that fails them goes live, whatever
 * the browser did. The Local API (seed migrations, server code that has
 * checked already) is not re-run here; MCP writes are always drafts.
 */
export const checksBeforePublish: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
  collection,
}) => {
  const api = req.payloadAPI as string
  if (api !== 'REST' && api !== 'GraphQL') return data
  // A change to a published report that names no status (and is not saved
  // as a draft) is published too.
  const draftSave = String((req.query as { draft?: unknown } | undefined)?.draft) === 'true'
  const status = data._status ?? (draftSave ? 'draft' : originalDoc?._status)
  if (status !== 'published') return data
  const doc = { ...(originalDoc ?? {}), ...data } as Record<string, unknown>
  const { issues } = await checkAndPreview({
    title: String(doc.title ?? ''),
    description: typeof doc.description === 'string' ? doc.description : '',
    sql: String(doc.sql ?? ''),
    parameters: doc.parameters ?? [],
    chart: doc.chart ?? null,
    headline: doc.headline ?? [],
    columnSettings: doc.columnSettings ?? [],
    category: typeof doc.category === 'string' ? doc.category : 'other',
  })
  const errors = issues.filter((i) => i.level === 'error')
  if (errors.length > 0) {
    throw new ValidationError({
      collection: collection.slug,
      errors: errors.map((i) => ({ path: 'sql', message: `Not published: ${i.message}` })),
    })
  }
  return data
}

/** JSON edited as text: Payload's JSON editor loads from a CDN the admin's CSP blocks. */
const JSON_TEXTAREA = '@/components/fields/JsonTextareaField#JsonTextareaField'

const validateParameters: Validate = (value) => {
  const parsed = reportParametersSchema.safeParse(value ?? [])
  return parsed.success ? true : firstIssue(parsed.error)
}

const validateChart: Validate = (value) => {
  if (value === null || value === undefined) return true
  const parsed = chartsSchema.safeParse(value)
  return parsed.success ? true : firstIssue(parsed.error)
}

const validateColumns: Validate = (value) => {
  const parsed = columnSpecsSchema.safeParse(value ?? [])
  return parsed.success ? true : firstIssue(parsed.error)
}

const validateHeadline: Validate = (value) => {
  const parsed = headlineSpecsSchema.safeParse(value ?? [])
  return parsed.success ? true : firstIssue(parsed.error)
}

const validateSql: Validate = (value, { siblingData }) => {
  const check = checkReportSql(value)
  if (!check.ok) return check.error
  const params = reportParametersSchema.safeParse(
    (siblingData as { parameters?: unknown } | undefined)?.parameters ?? [],
  )
  // A bad parameter list is reported on its own field.
  if (!params.success) return true
  return checkPlaceholders(check.placeholders, params.data.length) ?? true
}

/** Store the parameter list with its defaults filled in. */
const normaliseParameters: FieldHook = ({ value }) => {
  const parsed = reportParametersSchema.safeParse(value ?? [])
  return parsed.success ? parsed.data : value
}

/**
 * Where a report came from, set once on create from the request context
 * (`reportOrigin`: `ask` from the Ask Claude save, `mcp` from the MCP
 * connector), never from the data.
 */
const setOrigin: CollectionBeforeChangeHook = ({ data, operation, context }) => {
  if (operation !== 'create') return data
  const origin = context.reportOrigin
  return {
    ...data,
    origin: origin === 'ask' || origin === 'mcp' ? origin : (data.origin ?? 'manual'),
  }
}

/**
 * Over the MCP connector (BTB-509) every write is a draft, so nothing Claude
 * saves is published without a person: creates and single updates are forced
 * to drafts (an update writes a new draft version and leaves the published
 * one alone) and never override another editor's lock; bulk updates and
 * deletes are refused. Every read has depth 0, so the author's user record
 * never reaches Claude.
 */
export const mcpDraftsOnly: CollectionBeforeOperationHook = ({ args, context, operation, req }) => {
  if ((req.payloadAPI as string) !== 'MCP') return args
  // Payload names both a single and a bulk update 'update' here; only a
  // single one carries an id.
  if (operation === 'create' || (operation === 'update' && 'id' in args && !!args.id)) {
    if (operation === 'create') context.reportOrigin = 'mcp'
    return {
      ...args,
      data: { ...(args.data ?? {}), _status: 'draft' },
      draft: true,
      depth: 0,
      ...(operation === 'update' ? { overrideLock: false } : {}),
    }
  }
  if (operation === 'update' || operation === 'delete') throw new Forbidden(req.t)
  return { ...args, depth: 0 }
}

/**
 * Report definitions (BTB-506).
 *
 * A report is data, not code: SQL over the `reporting` schema, its
 * parameters, an optional chart and the roles that may run it. Publishing a
 * new version changes the report with no deploy. Drafts let an author test
 * a change before viewers see it; every published version is kept.
 *
 * This collection is CRM-owned configuration, one of the exceptions to the
 * read-only projection rule in CLAUDE.md. The SQL itself is only ever run
 * by `src/server/reporting/runner.ts`.
 */
export const ReportDefinitions: CollectionConfig = {
  slug: 'report-definitions',
  labels: { singular: 'Report', plural: 'Reports' },
  admin: {
    useAsTitle: 'title',
    group: 'Reporting',
    defaultColumns: ['title', 'slug', 'roles', '_status', 'updatedAt'],
    description: 'Report definitions. Staff run published reports from Reports in the sidebar.',
    hidden: ({ user }) => !hasApprovalAuthority(user),
  },
  access: {
    read: canAuthor,
    create: canAuthor,
    update: canAuthor,
    delete: ({ req }) => isAdmin(req.user),
    // Without this, Payload lets any signed-in user read every version
    // (SQL and unpublished drafts) through /api/report-definitions/versions.
    readVersions: canAuthor,
  },
  versions: {
    drafts: true,
    // Payload prunes the oldest versions past this, published ones included;
    // high enough that drafting (by hand or over MCP) does not lose history.
    maxPerDoc: 500,
  },
  hooks: {
    beforeOperation: [mcpDraftsOnly],
    beforeChange: [slugEvenForDrafts, checksBeforePublish, setOrigin],
  },
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 120 },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      validate: validateSlug,
      admin: { description: 'Used in the report link: /admin/reports/<slug>' },
    },
    { name: 'description', type: 'textarea', maxLength: 1000 },
    {
      name: 'category',
      type: 'select',
      defaultValue: 'other',
      options: REPORT_CATEGORIES.map((c) => ({ label: c.label, value: c.value })),
      admin: { position: 'sidebar', description: 'Where the report sits in the catalogue.' },
    },
    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'Show its headline numbers on the Reports home.',
      },
    },
    {
      name: 'sql',
      label: 'SQL',
      // A plain textarea, not `code`: Payload's code editor loads from a CDN
      // the admin's Content-Security-Policy blocks. Same column either way.
      type: 'textarea',
      required: true,
      validate: validateSql,
      admin: {
        rows: 12,
        className: 'mono-textarea',
        description:
          'One SELECT or WITH statement over the reporting schema (docs/reporting.md). ' +
          'Read parameter 1 as $1, parameter 2 as $2, and so on.',
      },
    },
    {
      name: 'parameters',
      type: 'json',
      defaultValue: [],
      validate: validateParameters,
      hooks: { beforeChange: [normaliseParameters] },
      admin: {
        components: { Field: JSON_TEXTAREA },
        description:
          'A list of {name, label, type, required, default, options, help}. Types: date, text, ' +
          'integer, number, select, boolean. Date defaults: today, today-N or YYYY-MM-DD.',
      },
    },
    {
      name: 'chart',
      type: 'json',
      validate: validateChart,
      admin: {
        components: { Field: JSON_TEXTAREA },
        description:
          'Optional: one chart or a list of two. {type: line | bar | area | bar-horizontal | ' +
          'stacked-100, x: column, series: [{column, label}], stacked, sort: value | none, ' +
          'rollingAverage: days, drill: {report, parameter}}.',
      },
    },
    {
      name: 'headline',
      type: 'json',
      defaultValue: [],
      validate: validateHeadline,
      admin: {
        components: { Field: JSON_TEXTAREA },
        description:
          'Up to four headline numbers above the chart: [{column, label, value: total | sum | ' +
          'last | first | average | max | min, better: higher | lower}].',
      },
    },
    {
      name: 'columnSettings',
      label: 'Columns',
      type: 'json',
      defaultValue: [],
      validate: validateColumns,
      admin: {
        components: { Field: JSON_TEXTAREA },
        description:
          'Optional per-column settings: [{name, label, format, description, base, minBase, ' +
          'better}]. Formats otherwise follow the name: *_rate and *_pct are percentages, ' +
          'amounts and balances are dollars.',
      },
    },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      required: true,
      defaultValue: ['admin', 'supervisor'],
      options: REPORT_VIEWER_ROLES.map((role) => ({
        label: role.charAt(0).toUpperCase() + role.slice(1),
        value: role,
      })),
      admin: { description: 'Who can run the published report. Authors can always run it.' },
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      admin: { position: 'sidebar', readOnly: true },
      // Not writable through the API: set by the hook below.
      access: { create: () => false, update: () => false },
      hooks: {
        // Set once, from whoever creates the report.
        beforeChange: [
          ({ value, operation, req }) =>
            operation === 'create' && !value && req.user ? req.user.id : value,
        ],
      },
    },
    {
      name: 'origin',
      type: 'select',
      defaultValue: 'manual',
      options: [
        { label: 'Written by hand', value: 'manual' },
        { label: 'Drafted with Claude', value: 'ask' },
        { label: 'Saved over MCP', value: 'mcp' },
      ],
      admin: { position: 'sidebar', readOnly: true },
      // Not writable through the API: set by `setOrigin` from the caller.
      access: { create: () => false, update: () => false },
    },
    {
      name: 'schedule',
      type: 'select',
      defaultValue: 'none',
      options: [
        { label: 'Not scheduled', value: 'none' },
        { label: 'Weekly, Monday morning', value: 'weekly_monday' },
      ],
      admin: { position: 'sidebar' },
    },
  ],
}
