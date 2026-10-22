/**
 * The reporting MCP connector (BTB-509): Claude chat, Claude Code and Claude
 * artifacts author and read reports through the same governed path as the
 * Reports view, at `POST /api/mcp`.
 *
 * Built on `@payloadcms/plugin-mcp`, which provides the endpoint, the
 * per-key switches (`payload-mcp-api-keys`) and find/create tools for
 * `report-definitions`. Around it:
 *
 * - Only admins mint, see or revoke keys, and only for report authors
 *   (admin, supervisor). Every request re-checks that the key's person is
 *   still an author, and a person's keys are deleted when they stop being
 *   one (`mcp-keys.ts`).
 * - Report definitions: find and create from the plugin, and our own
 *   `update_report_draft` (the plugin's update tool takes a server file path
 *   it reads before any hook runs). Never delete. Every write is a draft and
 *   every read has depth 0 (`mcpDraftsOnly`), so nothing is published
 *   without a person in the admin and no user record reaches Claude.
 * - Custom tools: `describe_reporting_schema`, `run_report_query` (SQL
 *   through the runner as `reporting_reader`, `MCP_ROW_CAP` rows) and
 *   `run_report` (a report by slug, for dashboards built on reviewed,
 *   aggregate reports), on a connection pool of their own so a busy agent
 *   cannot hold up the Reports view or the scheduled jobs.
 *
 * Two kinds of key:
 *
 * - personal: one per report author, for Claude Code. All the tools above.
 * - dashboard: shared by the Claude organisation (a claude.ai connector
 *   with a static request header, used by chat and artifact dashboards).
 *   Read-only: `list_reports` and `run_report`, for the published reports an
 *   admin ticks on the key, and nothing else. It still has an accountable
 *   owner, a report author, and is revoked with them.
 *
 * Every key is rate-limited per server process (`MCP_RATE_LIMITS`).
 *
 * Over MCP, Claude sees query results. That is why only the `reporting`
 * schema is reachable (the runner's login role) and rows are capped.
 * Every query is logged: `run_report` in Report runs, `run_report_query` in
 * Report asks.
 */
import { randomBytes } from 'node:crypto'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import type { CollectionConfig, Payload, PayloadRequest } from 'payload'
import { APIError, Forbidden, UnauthorizedError, ValidationError } from 'payload'
import { z } from 'zod/v3'
import { hideFromNonAdmins, isAdmin } from '@/lib/access'
import { REPORT_VIEWER_ROLES } from '@/lib/schemas/reports'
import { checkRateLimit, type RateLimitOptions } from '@/lib/utils/rateLimit'
import { isReportAuthor, listReports, runReport } from './run-report'
import { ReportRunError, getReportingPool, runReportSql } from './runner'
import { MCP_API_KEYS_SLUG, apiKeyIndex } from './mcp-keys'
import { renderSchemaDescription, SCHEMA_DESCRIPTION_VERSION } from './schema-description'

/** Rows a tool returns. Lower than the Reports view's cap: Claude reads them. */
export const MCP_ROW_CAP = 1_000
/** Characters of JSON a tool returns; rows past it are dropped. */
export const MCP_MAX_RESULT_CHARS = 200_000

/** Requests per key per server process. A dashboard key serves every viewer. */
export const MCP_RATE_LIMITS: Record<McpKeyScope, RateLimitOptions> = {
  personal: { limit: 120, windowMs: 60_000 },
  dashboard: { limit: 300, windowMs: 60_000 },
}

export type McpKeyScope = 'personal' | 'dashboard'

/** What `authenticateMcp` learned about the key, for the tools (on `req.context`). */
interface McpKeyContext {
  scope: McpKeyScope
  /** Dashboard keys: the slugs of the reports the key may run. */
  reports: string[]
}

const keyContext = (req: PayloadRequest): McpKeyContext =>
  (req.context.mcpKey as McpKeyContext | undefined) ?? { scope: 'personal', reports: [] }

/** How long after creation an admin can read a key, to hand it over. */
export const MCP_KEY_VISIBLE_MS = 15 * 60_000

export { MCP_API_KEYS_SLUG, apiKeyIndex }

type ToolResult = { content: Array<{ type: 'text'; text: string }> }

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] })
const json = (value: unknown): ToolResult => text(JSON.stringify(value))

/** The tools only serve report authors; `overrideAuth` already refuses others. */
function assertAuthor(req: PayloadRequest): void {
  if (!isReportAuthor(req.user)) throw new Forbidden()
}

/** Rows that fit `MCP_MAX_RESULT_CHARS` once serialised. */
export function fitRows(rows: Array<Record<string, unknown>>): {
  rows: Array<Record<string, unknown>>
  cut: boolean
} {
  let size = 0
  for (let i = 0; i < rows.length; i++) {
    size += JSON.stringify(rows[i]).length + 1
    if (size > MCP_MAX_RESULT_CHARS) return { rows: rows.slice(0, i), cut: true }
  }
  return { rows, cut: false }
}

async function logQuery(
  payload: Payload,
  user: unknown,
  sql: string,
  outcome: 'ok' | 'error',
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await payload.create({
      collection: 'report-asks',
      data: {
        user: (user as { id?: string } | null)?.id ?? null,
        kind: 'mcp_query',
        // The whole statement (at most 20,000 characters), so the log shows what ran.
        question: sql,
        outcome,
        schemaVersion: SCHEMA_DESCRIPTION_VERSION,
        latencyMs: typeof detail.durationMs === 'number' ? detail.durationMs : undefined,
        definition: detail as never,
      },
      overrideAccess: true,
    })
  } catch (error) {
    console.error('[reports] could not log an MCP query:', error)
  }
}

type McpPluginOptions = Parameters<typeof mcpPlugin>[0]
type McpTool = NonNullable<NonNullable<McpPluginOptions['mcp']>['tools']>[number]

/** A custom tool. (Typed locally: the plugin's zod 3 shape type is too deep to check against.) */
interface ReportingTool {
  name: string
  description: string
  parameters: Record<string, z.ZodTypeAny>
  handler: (args: Record<string, unknown>, req: PayloadRequest) => Promise<ToolResult>
}

const cellValue = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])

/** The custom tools, exported for tests. */
export const reportingTools: ReportingTool[] = [
  {
    name: 'list_reports',
    description:
      'List the published reports this key can run: slug, title, description and parameters (with defaults). Run one with run_report.',
    parameters: {},
    handler: async (_args: Record<string, unknown>, req: PayloadRequest) => {
      assertAuthor(req)
      const key = keyContext(req)
      const reports = (await listReports(req.payload, req.user)).filter(
        (r) => r.published && (key.scope !== 'dashboard' || key.reports.includes(r.slug)),
      )
      return json(
        reports.map((r) => ({
          slug: r.slug,
          title: r.title,
          description: r.description,
          parameters: r.parameters,
        })),
      )
    },
  },
  {
    name: 'describe_reporting_schema',
    description:
      'Describe the reporting schema: every view and table with its grain, every column with its meaning, the helper functions, and the business rules a report must follow. Read this before writing report SQL.',
    parameters: {},
    handler: async (_args: Record<string, unknown>, req: PayloadRequest) => {
      assertAuthor(req)
      return text(
        `${renderSchemaDescription()}\n\nQueries run read-only with a 15 second timeout. ` +
          `run_report_query returns at most ${MCP_ROW_CAP} rows. Report definitions saved over MCP are always drafts.`,
      )
    },
  },
  {
    name: 'run_report_query',
    description: `Run one SELECT (or WITH) over the reporting schema, read-only, as the reporting role, and return its columns and up to ${MCP_ROW_CAP} rows. Bind values as $1, $2… with parameters, in order. Use it to test report SQL before saving a draft. Prefer aggregates: never pull customer-level rows you do not need.`,
    parameters: {
      sql: z.string().min(1).max(20_000).describe('A single SELECT or WITH statement'),
      parameters: z
        .array(cellValue)
        .max(20)
        .optional()
        .describe('Values for $1, $2… in order, e.g. ["2026-10-01"]'),
    },
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      assertAuthor(req)
      const sql = String(args.sql ?? '')
      const values = Array.isArray(args.parameters) ? args.parameters : []
      try {
        const result = await runReportSql(sql, values, {
          rowCap: MCP_ROW_CAP,
          pool: await getReportingPool('mcp'),
        })
        const fitted = fitRows(result.rows)
        await logQuery(req.payload, req.user, sql, 'ok', {
          rowCount: result.rowCount,
          truncated: result.truncated || fitted.cut,
          durationMs: result.durationMs,
        })
        return json({
          columns: result.columns,
          rows: fitted.rows,
          rowCount: fitted.rows.length,
          truncated: result.truncated || fitted.cut,
          durationMs: result.durationMs,
        })
      } catch (error) {
        const message =
          error instanceof ReportRunError
            ? `${error.code}: ${error.message}${error.detail ? ` (${error.detail})` : ''}`
            : 'The query could not be run.'
        await logQuery(req.payload, req.user, sql, 'error', {
          errorCode: error instanceof ReportRunError ? error.code : 'ERROR',
        })
        return text(`Error: ${message}`)
      }
    },
  },
  {
    name: 'run_report',
    description:
      'Run a published report by its slug on the given parameters (blank ones take their defaults) and return its columns and rows. Find slugs and parameters with list_reports. Dashboards should use this, so they show reviewed, aggregate reports only.',
    parameters: {
      slug: z.string().min(1).max(100),
      parameters: z
        .record(z.string(), cellValue)
        .optional()
        .describe('Parameter values by name, e.g. {"from": "2026-10-01"}'),
    },
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      assertAuthor(req)
      const slug = String(args.slug ?? '')
      const key = keyContext(req)
      if (key.scope === 'dashboard' && !key.reports.includes(slug)) {
        return text(`Error: FORBIDDEN: this key cannot run "${slug}". Call list_reports.`)
      }
      const outcome = await runReport(
        req.payload,
        req.user,
        slug,
        {
          parameters: (args.parameters as Record<string, unknown> | undefined) ?? {},
          trigger: 'mcp',
        },
        { rowCap: MCP_ROW_CAP, pool: await getReportingPool('mcp') },
      )
      if (outcome.status !== 200) {
        return text(`Error: ${outcome.body.error.code}: ${outcome.body.error.message}`)
      }
      const fitted = fitRows(outcome.body.rows)
      return json({
        ...outcome.body,
        rows: fitted.rows,
        rowCount: fitted.rows.length,
        truncated: outcome.body.truncated || fitted.cut,
      })
    },
  },
  {
    name: 'update_report_draft',
    description:
      'Change a report definition by id (find ids with findReportDefinitions). Saves a new draft version for a supervisor to publish; the published report, if any, is unchanged until then. Send only the fields to change.',
    parameters: {
      id: z.string().min(1).max(100),
      title: z.string().min(1).max(120).optional(),
      description: z.string().max(1000).optional(),
      sql: z.string().min(1).max(20_000).optional(),
      parameters: z
        .array(z.record(z.string(), z.unknown()))
        .max(20)
        .optional()
        .describe(
          'The whole parameter list: {name, label, type, required, default, options, help}',
        ),
      chart: z.record(z.string(), z.unknown()).nullable().optional(),
      roles: z.array(z.enum(REPORT_VIEWER_ROLES)).optional(),
      schedule: z.enum(['none', 'weekly_monday']).optional(),
    },
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      assertAuthor(req)
      const { id, ...changes } = args
      try {
        const doc = await req.payload.update({
          collection: 'report-definitions',
          id: String(id),
          data: changes as never,
          draft: true,
          depth: 0,
          overrideAccess: false,
          overrideLock: false,
          req,
        })
        return json({ id: doc.id, slug: doc.slug, title: doc.title, status: 'draft' })
      } catch (error) {
        return text(
          `Error: ${error instanceof Error ? error.message : 'The draft could not be saved.'}`,
        )
      }
    },
  },
]

const adminOnly = ({ req }: { req: PayloadRequest }) => isAdmin(req.user)

/**
 * The plugin's key collection, made a plain collection: admin-only, keys
 * issued to report authors only, generated on create.
 *
 * The plugin makes it a Payload auth collection (`useAPIKey`). That would
 * also let every key log in to the REST API and admin as a principal of its
 * own, so `auth` is removed and `authenticateMcp` checks keys instead, the
 * same way Payload does: an HMAC index to find the key, and the key
 * encrypted with the app secret. An admin can read it only for
 * `MCP_KEY_VISIBLE_MS` after creating it, to hand it over.
 */
export function restrictApiKeys(collection: CollectionConfig): CollectionConfig {
  const { auth: _auth, ...plain } = collection
  return {
    ...plain,
    labels: { singular: 'MCP API key', plural: 'MCP API keys' },
    admin: {
      ...collection.admin,
      group: 'Reporting',
      description:
        'Keys for the reporting connector (BTB-509): one per person, for report authors only. Delete a key to revoke it.',
      hidden: hideFromNonAdmins,
    },
    access: { read: adminOnly, create: adminOnly, update: adminOnly, delete: adminOnly },
    fields: [
      ...collection.fields,
      {
        name: 'scope',
        type: 'select',
        required: true,
        defaultValue: 'personal',
        options: [
          { label: 'Personal (Claude Code, one report author)', value: 'personal' },
          { label: 'Dashboard (claude.ai connector, shared, read-only)', value: 'dashboard' },
        ],
        admin: {
          description:
            'A dashboard key is shared by everyone in the Claude organisation and can only list and run the reports ticked below; the switches in the sidebar do not apply to it.',
        },
      },
      {
        name: 'reports',
        type: 'relationship',
        relationTo: 'report-definitions',
        hasMany: true,
        admin: {
          condition: (data) => data?.scope === 'dashboard',
          description:
            'Published reports the dashboard key may run. Choose aggregate reports only: anyone in the Claude organisation can see their results.',
        },
      },
      {
        name: 'apiKey',
        type: 'text',
        label: 'API key',
        admin: {
          readOnly: true,
          description:
            'Generated when the key is saved and shown for 15 minutes: copy it to the person, who adds it to Claude as a bearer token. If it is lost, delete the key and create another.',
        },
        access: { update: () => false },
        hooks: {
          beforeChange: [({ req, value }) => (value ? req.payload.encrypt(value) : value)],
          afterRead: [
            ({ req, value, siblingData }) => {
              const created = Date.parse(String(siblingData?.createdAt ?? ''))
              const fresh = Number.isFinite(created) && Date.now() - created < MCP_KEY_VISIBLE_MS
              // null, not undefined: undefined keeps the stored (encrypted) value.
              return value && fresh ? req.payload.decrypt(value) : null
            },
          ],
        },
      },
      {
        name: 'apiKeyIndex',
        type: 'text',
        index: true,
        unique: true,
        hidden: true,
        access: { update: () => false },
      },
    ],
    hooks: {
      ...collection.hooks,
      beforeChange: [
        ...(collection.hooks?.beforeChange ?? []),
        async ({ data, operation, req }) => {
          const id =
            typeof data.user === 'object' && data.user !== null
              ? (data.user as { id: string }).id
              : data.user
          const person = id
            ? await req.payload.findByID({ collection: 'users', id, depth: 0, req })
            : null
          if (!isReportAuthor(person)) {
            throw new ValidationError({
              collection: collection.slug,
              errors: [
                { path: 'user', message: 'Keys are for report authors (admin or supervisor)' },
              ],
            })
          }
          const reports = Array.isArray(data.reports) ? data.reports : []
          if (data.scope === 'dashboard' && reports.length === 0) {
            throw new ValidationError({
              collection: collection.slug,
              errors: [
                { path: 'reports', message: 'Choose the reports this dashboard key may run' },
              ],
            })
          }
          const scoped = data.scope === 'dashboard' ? data : { ...data, reports: [] }
          if (operation !== 'create') return scoped
          const key = `bcrm_${randomBytes(32).toString('base64url')}`
          return { ...scoped, apiKey: key, apiKeyIndex: apiKeyIndex(req.payload.secret, key) }
        },
      ],
    },
  }
}

/**
 * Find the key from `Authorization: Bearer <key>`, and require that its
 * person is still a report author, so changing their role revokes the key.
 * Sets `req.user`, which the custom tools and the draft-only hook read, and
 * returns the key's switches as the plugin's access settings.
 */
export const authenticateMcp: NonNullable<McpPluginOptions['overrideAuth']> = async (req) => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  if (!match) throw new UnauthorizedError()
  const { docs } = await req.payload.find({
    collection: MCP_API_KEYS_SLUG,
    where: { apiKeyIndex: { equals: apiKeyIndex(req.payload.secret, match[1]) } },
    depth: 1,
    limit: 1,
    pagination: false,
    overrideAccess: true,
  })
  const key = docs[0] as unknown as
    | (Record<string, unknown> & { id: string; user?: unknown; scope?: McpKeyScope })
    | undefined
  if (!key || typeof key.user !== 'object' || key.user === null) throw new UnauthorizedError()
  if (!isReportAuthor(key.user)) throw new Forbidden()
  const scope: McpKeyScope = key.scope === 'dashboard' ? 'dashboard' : 'personal'
  if (!checkRateLimit(`mcp:${key.id}`, MCP_RATE_LIMITS[scope])) {
    throw new APIError('Too many requests for this key. Try again in a minute.', 429)
  }
  const user = { ...(key.user as object), collection: 'users', _strategy: 'mcp-api-key' }
  req.user = user as unknown as PayloadRequest['user']
  if (scope === 'personal') {
    req.context.mcpKey = { scope, reports: [] } satisfies McpKeyContext
    return { ...key, user } as unknown as Awaited<ReturnType<typeof authenticateMcp>>
  }
  // Dashboard: list and run the ticked reports, whatever the switches say.
  const reports = (Array.isArray(key.reports) ? key.reports : [])
    .map((r) => (typeof r === 'object' && r !== null ? (r as { slug?: string }).slug : undefined))
    .filter((slug): slug is string => typeof slug === 'string')
  req.context.mcpKey = { scope, reports } satisfies McpKeyContext
  return {
    user,
    reportDefinitions: { find: false, create: false },
    'payload-mcp-tool': {
      listReports: true,
      runReport: true,
      describeReportingSchema: false,
      runReportQuery: false,
      updateReportDraft: false,
    },
  } as unknown as Awaited<ReturnType<typeof authenticateMcp>>
}

export const reportingMcp = mcpPlugin({
  userCollection: 'users',
  collections: {
    'report-definitions': {
      description:
        'Report definitions: title, description, SQL over the reporting schema, parameters and chart. Writes over MCP are always saved as drafts for a supervisor to publish.',
      // No plugin update or delete: see update_report_draft.
      enabled: { find: true, create: true, update: false, delete: false },
    },
  },
  mcp: {
    tools: reportingTools as unknown as McpTool[],
    serverOptions: {
      serverInfo: { name: 'Billie CRM reporting', version: '1.0.0' },
      instructions:
        'Billie CRM reporting. Call describe_reporting_schema before writing SQL, test it with run_report_query, then save it with createReportDefinitions or update_report_draft (always a draft). Prefer aggregates; never pull customer-level rows you do not need.',
    },
  },
  overrideApiKeyCollection: restrictApiKeys,
  overrideAuth: authenticateMcp,
})
