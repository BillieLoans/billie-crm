/**
 * The reporting MCP connector (BTB-509): Claude chat, Claude Code and Claude
 * artifacts author and read reports through the same governed path as the
 * Reports view, at `POST /api/mcp`.
 *
 * Built on `@payloadcms/plugin-mcp`, which provides the endpoint, the
 * per-key switches (`payload-mcp-api-keys`) and find/create/update tools for
 * `report-definitions`. Around it:
 *
 * - Only admins mint, see or revoke keys, and only for report authors
 *   (admin, supervisor). Every request re-checks that the key's person is
 *   still an author, so changing their role revokes the key too.
 * - Report definitions: find, create and update, never delete. Every write
 *   is a draft (`ReportDefinitions` forces it for MCP requests), so nothing
 *   is published without a person in the admin.
 * - Custom tools: `describe_reporting_schema`, `run_report_query` (SQL
 *   through the runner as `reporting_reader`, `MCP_ROW_CAP` rows) and
 *   `run_report` (a report by slug, for dashboards built on reviewed,
 *   aggregate reports).
 *
 * Over MCP, Claude sees query results. That is why only the `reporting`
 * schema is reachable (the runner's login role) and rows are capped.
 * Every query is logged: `run_report` in Report runs, `run_report_query` in
 * Report asks.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import type { CollectionConfig, Payload, PayloadRequest } from 'payload'
import { Forbidden, UnauthorizedError, ValidationError } from 'payload'
import { z } from 'zod/v3'
import { hideFromNonAdmins, isAdmin } from '@/lib/access'
import { isReportAuthor, runReport } from './run-report'
import { ReportRunError, runReportSql } from './runner'
import { renderSchemaDescription, SCHEMA_DESCRIPTION_VERSION } from './schema-description'

/** Rows a tool returns. Lower than the Reports view's cap: Claude reads them. */
export const MCP_ROW_CAP = 1_000
/** Characters of JSON a tool returns; rows past it are dropped. */
export const MCP_MAX_RESULT_CHARS = 200_000

export const MCP_API_KEYS_SLUG = 'payload-mcp-api-keys' as const

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
        question: sql.slice(0, 2000),
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
        const result = await runReportSql(sql, values, { rowCap: MCP_ROW_CAP })
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
      'Run a published report by its slug on the given parameters (blank ones take their defaults) and return its columns and rows. Find slugs with findReportDefinitions. Dashboards should use this, so they show reviewed, aggregate reports only.',
    parameters: {
      slug: z.string().min(1).max(100),
      parameters: z
        .record(z.string(), cellValue)
        .optional()
        .describe('Parameter values by name, e.g. {"from": "2026-10-01"}'),
    },
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      assertAuthor(req)
      const outcome = await runReport(
        req.payload,
        req.user,
        String(args.slug ?? ''),
        {
          parameters: (args.parameters as Record<string, unknown> | undefined) ?? {},
          trigger: 'mcp',
        },
        { rowCap: MCP_ROW_CAP },
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
]

/** The HMAC a key is found by; the key itself is stored encrypted. */
export function apiKeyIndex(secret: string, key: string): string {
  return createHmac('sha256', secret).update(key).digest('hex')
}

const adminOnly = ({ req }: { req: PayloadRequest }) => isAdmin(req.user)

/**
 * The plugin's key collection, made a plain collection: admin-only, keys
 * issued to report authors only, generated on create.
 *
 * The plugin makes it a Payload auth collection (`useAPIKey`). That would
 * also let every key log in to the REST API and admin as a principal of its
 * own, so `auth` is removed and `authenticateMcp` checks keys instead, the
 * same way Payload does: an HMAC index to find the key, the key encrypted
 * with the app secret so an admin can copy it.
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
        name: 'apiKey',
        type: 'text',
        label: 'API key',
        admin: {
          readOnly: true,
          description:
            'Generated when the key is saved. The person adds it to Claude as a bearer token.',
        },
        access: { update: () => false },
        hooks: {
          beforeChange: [({ req, value }) => (value ? req.payload.encrypt(value) : value)],
          afterRead: [({ req, value }) => (value ? req.payload.decrypt(value) : value)],
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
          if (operation !== 'create') return data
          const key = `bcrm_${randomBytes(32).toString('base64url')}`
          return { ...data, apiKey: key, apiKeyIndex: apiKeyIndex(req.payload.secret, key) }
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
  const key = docs[0] as unknown as (Record<string, unknown> & { user?: unknown }) | undefined
  if (!key || typeof key.user !== 'object' || key.user === null) throw new UnauthorizedError()
  if (!isReportAuthor(key.user)) throw new Forbidden()
  const user = { ...(key.user as object), collection: 'users', _strategy: 'mcp-api-key' }
  req.user = user as unknown as PayloadRequest['user']
  return { ...key, user } as unknown as Awaited<ReturnType<typeof authenticateMcp>>
}

export const reportingMcp = mcpPlugin({
  userCollection: 'users',
  collections: {
    'report-definitions': {
      description:
        'Report definitions: title, description, SQL over the reporting schema, parameters and chart. Writes over MCP are always saved as drafts for a supervisor to publish.',
      enabled: { find: true, create: true, update: true, delete: false },
    },
  },
  mcp: {
    tools: reportingTools as unknown as McpTool[],
    serverOptions: {
      serverInfo: { name: 'Billie CRM reporting', version: '1.0.0' },
      instructions:
        'Billie CRM reporting. Call describe_reporting_schema before writing SQL, test it with run_report_query, then save it with createReportDefinitions (always a draft). Prefer aggregates; never pull customer-level rows you do not need.',
    },
  },
  overrideApiKeyCollection: restrictApiKeys,
  overrideAuth: authenticateMcp,
})
