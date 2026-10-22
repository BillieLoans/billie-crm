import type { Access, CollectionConfig, FieldHook, Validate } from 'payload'
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
      ],
      admin: { position: 'sidebar', readOnly: true },
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
