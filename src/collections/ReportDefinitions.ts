import type {
  Access,
  CollectionBeforeChangeHook,
  CollectionBeforeOperationHook,
  CollectionConfig,
  FieldHook,
  Validate,
} from 'payload'
import { Forbidden } from 'payload'
import { hasApprovalAuthority, isAdmin } from '@/lib/access'
import {
  REPORT_SLUG_RE,
  REPORT_VIEWER_ROLES,
  RESERVED_REPORT_SLUGS,
  chartSpecSchema,
  reportParametersSchema,
} from '@/lib/schemas/reports'
import { checkPlaceholders, checkReportSql } from '@/server/reporting/sql-guard'

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

const validateParameters: Validate = (value) => {
  const parsed = reportParametersSchema.safeParse(value ?? [])
  return parsed.success ? true : firstIssue(parsed.error)
}

const validateChart: Validate = (value) => {
  if (value === null || value === undefined) return true
  const parsed = chartSpecSchema.safeParse(value)
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
 * one alone), and bulk updates and deletes are refused.
 */
export const mcpDraftsOnly: CollectionBeforeOperationHook = ({ args, context, operation, req }) => {
  if ((req.payloadAPI as string) !== 'MCP') return args
  // Payload names both a single and a bulk update 'update' here; only a
  // single one carries an id.
  const single = operation === 'create' || (operation === 'update' && 'id' in args && !!args.id)
  if (single) {
    if (operation === 'create') context.reportOrigin = 'mcp'
    return { ...args, data: { ...(args.data ?? {}), _status: 'draft' }, draft: true }
  }
  if (operation === 'update' || operation === 'delete') throw new Forbidden(req.t)
  return args
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
    maxPerDoc: 50,
  },
  hooks: { beforeOperation: [mcpDraftsOnly], beforeChange: [setOrigin] },
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
      name: 'sql',
      label: 'SQL',
      type: 'code',
      required: true,
      validate: validateSql,
      admin: {
        language: 'sql',
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
        description:
          'Optional: {type: line | bar | area, x: column, series: [{column, label}], stacked}.',
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
