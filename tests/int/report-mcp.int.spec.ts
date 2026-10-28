// @vitest-environment node
/**
 * Integration coverage for the reporting MCP connector (BTB-509), end to
 * end through POST /api/mcp: per-person keys for report authors only,
 * admin-only key management, the tools, read-only reporting queries capped
 * and logged, every write a draft, and a role change revoking a key. TEST
 * data only.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { REST_POST } from '@payloadcms/next/routes'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import type { Pool } from 'pg'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { getReportingPool } from '@/server/reporting/runner'
import {
  MCP_API_KEYS_SLUG,
  MCP_KEY_VISIBLE_MS,
  MCP_PERSONAL_KEY_TTL_MS,
  MCP_RATE_LIMITS,
} from '@/server/reporting/mcp'
import { MCP_IDENTIFIER_ROW_CAP } from '@/server/reporting/mcp-guard'
import {
  reportingMcpReaderPool,
  reportingMcpReaderUri,
  reportingReaderPool,
  reportingReaderUri,
} from '../utils/reportingReader'

const P = 'TEST-BTB509'
let payload: Payload
let pool: Pool
let reader: Pool
let mcpReader: Pool
const users: Record<string, { id: string; role: string }> = {}
let key = ''
let previousReportingUri: string | undefined
let previousMcpUri: string | undefined
const POST = REST_POST(config)

type RpcResult = {
  status: number
  body: {
    result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }> }
    error?: unknown
  } | null
}

let rpcId = 0
async function rpc(method: string, params: unknown, bearer?: string): Promise<RpcResult> {
  const res = await POST(
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    }),
    { params: Promise.resolve({ slug: ['mcp'] }) },
  )
  const text = await res.text()
  const data = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5))
    .join('')
  let body: RpcResult['body'] = null
  try {
    body = JSON.parse(data || text)
  } catch {
    body = null
  }
  return { status: res.status, body }
}

const callText = async (name: string, args: Record<string, unknown>, bearer = key) => {
  const r = await rpc('tools/call', { name, arguments: args }, bearer)
  return r.body?.result?.content?.[0]?.text ?? JSON.stringify(r.body)
}

async function cleanup() {
  await pool.query(`DELETE FROM reporting.decision_event WHERE conversation_id LIKE '${P}%'`)
  await pool.query(`DELETE FROM report_asks WHERE question LIKE '%${P}%'`)
  await pool.query(`DELETE FROM report_runs WHERE report_slug LIKE 'test-btb509%'`)
  await payload.delete({
    collection: 'report-definitions',
    where: { title: { like: P } },
    overrideAccess: true,
  })
  await payload.delete({
    collection: MCP_API_KEYS_SLUG,
    where: { label: { like: P } },
    overrideAccess: true,
  })
  await pool.query(`DELETE FROM users WHERE email LIKE 'test-btb509-%'`)
}

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as unknown as Pool
  reader = await reportingReaderPool(pool)
  mcpReader = await reportingMcpReaderPool(pool)
  previousReportingUri = process.env.REPORTING_DATABASE_URI
  process.env.REPORTING_DATABASE_URI = reportingReaderUri()
  previousMcpUri = process.env.REPORTING_MCP_DATABASE_URI
  process.env.REPORTING_MCP_DATABASE_URI = reportingMcpReaderUri()
  await cleanup()
  for (const [suffix, decision] of [
    ['1', 'APPROVED'],
    ['2', 'DECLINED'],
  ]) {
    await pool.query(
      `INSERT INTO reporting.decision_event (decision_key, conversation_id, decision, decided_at)
       VALUES ($1, $2, $3, '2001-04-02T03:00:00Z')`,
      [`${P}-${suffix}`, `${P}-C${suffix}`, decision],
    )
  }
  for (const role of ['admin', 'supervisor', 'operations']) {
    const u = await payload.create({
      collection: 'users',
      data: {
        email: `test-btb509-${role}-${Date.now()}@billie.loans`,
        password: 'Test1234!',
        role: role as 'supervisor',
        firstName: 'Test',
        lastName: role,
      },
    })
    users[role] = { id: String(u.id), role }
  }
  const created = await payload.create({
    collection: MCP_API_KEYS_SLUG,
    data: {
      label: `${P} supervisor`,
      user: users.supervisor.id,
      // Report tools are off on a new key until an admin turns them on.
      reportDefinitions: { find: true, create: true },
    } as never,
    overrideAccess: false,
    user: { ...users.admin, collection: 'users' } as never,
  })
  key = (created as unknown as { apiKey: string }).apiKey
}, 60_000)

afterAll(async () => {
  await cleanup()
  await reader?.end()
  await mcpReader?.end()
  await (await getReportingPool('mcp')).end()
  await (await getReportingPool('mcp-query')).end()
  // Assigning undefined would store the string "undefined".
  if (previousReportingUri === undefined) delete process.env.REPORTING_DATABASE_URI
  else process.env.REPORTING_DATABASE_URI = previousReportingUri
  if (previousMcpUri === undefined) delete process.env.REPORTING_MCP_DATABASE_URI
  else process.env.REPORTING_MCP_DATABASE_URI = previousMcpUri
})

describe('MCP API keys', () => {
  it('are generated on create, stored encrypted and found by HMAC', async () => {
    expect(key).toMatch(/^bcrm_[A-Za-z0-9_-]{40,}$/)
    const { rows } = await pool.query(
      `SELECT api_key, api_key_index FROM payload_mcp_api_keys WHERE label = $1`,
      [`${P} supervisor`],
    )
    expect(rows[0].api_key).not.toContain(key)
    expect(rows[0].api_key_index).toMatch(/^[0-9a-f]{64}$/)
  })

  it('can be read back only for a short time after creation', async () => {
    const [doc] = (
      await payload.find({
        collection: MCP_API_KEYS_SLUG,
        where: { label: { equals: `${P} supervisor` } },
        overrideAccess: true,
      })
    ).docs as unknown as Array<{ id: string; apiKey?: string }>
    expect(doc.apiKey).toBe(key)
    await pool.query(
      `UPDATE payload_mcp_api_keys SET created_at = now() - make_interval(secs => $1) WHERE id = $2`,
      [MCP_KEY_VISIBLE_MS / 1000 + 60, doc.id],
    )
    const later = (await payload.findByID({
      collection: MCP_API_KEYS_SLUG,
      id: doc.id,
      overrideAccess: true,
    })) as unknown as { apiKey?: string }
    expect(later.apiKey ?? null).toBeNull()
    // The key still works: only reading it back is closed.
    expect((await rpc('tools/list', {}, key)).status).toBe(200)
    // That use wiped the stored copy and recorded the time.
    const { rows } = await pool.query(
      `SELECT api_key, last_used_at FROM payload_mcp_api_keys WHERE id = $1`,
      [doc.id],
    )
    expect(rows[0].api_key).toBeNull()
    expect(rows[0].last_used_at).not.toBeNull()
  })

  it('expire: 90 days for a personal key, and not a request later', async () => {
    const created = await payload.create({
      collection: MCP_API_KEYS_SLUG,
      data: { label: `${P} expiring`, user: users.supervisor.id } as never,
      overrideAccess: false,
      user: { ...users.admin, collection: 'users' } as never,
    })
    const { id, apiKey, expiresAt } = created as unknown as {
      id: string
      apiKey: string
      expiresAt: string
    }
    const ttl = Date.parse(expiresAt) - Date.parse(String(created.createdAt))
    expect(Math.abs(ttl - MCP_PERSONAL_KEY_TTL_MS)).toBeLessThan(60_000)
    expect((await rpc('tools/list', {}, apiKey)).status).toBe(200)
    await pool.query(
      `UPDATE payload_mcp_api_keys SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [id],
    )
    expect((await rpc('tools/list', {}, apiKey)).status).toBe(401)
  })

  it('are managed by admins only, and issued to report authors only', async () => {
    await expect(
      payload.create({
        collection: MCP_API_KEYS_SLUG,
        data: { label: `${P} self-issued`, user: users.supervisor.id } as never,
        overrideAccess: false,
        user: { ...users.supervisor, collection: 'users' } as never,
      }),
    ).rejects.toThrow()
    await expect(
      payload.find({
        collection: MCP_API_KEYS_SLUG,
        overrideAccess: false,
        user: { ...users.supervisor, collection: 'users' } as never,
      }),
    ).rejects.toThrow()
    const refused = await payload
      .create({
        collection: MCP_API_KEYS_SLUG,
        data: { label: `${P} operations`, user: users.operations.id } as never,
        overrideAccess: false,
        user: { ...users.admin, collection: 'users' } as never,
      })
      .catch((e: { data?: { errors?: Array<{ message: string }> } }) => e)
    expect(JSON.stringify((refused as { data?: unknown }).data)).toMatch(/report authors/)
  })

  it('a missing or unknown key is refused', async () => {
    expect((await rpc('tools/list', {})).status).toBe(401)
    expect((await rpc('tools/list', {}, 'bcrm_not-a-key')).status).toBe(401)
  })

  it('do not authenticate anywhere but /api/mcp', async () => {
    const { user } = await payload.auth({
      headers: new Headers({ authorization: `${MCP_API_KEYS_SLUG} API-Key ${key}` }),
    })
    expect(user).toBeNull()
  })
})

describe('Dashboard keys', () => {
  const admin = () => ({ ...users.admin, collection: 'users' }) as never
  let dashboardKey = ''

  beforeAll(async () => {
    const report = (slug: string, title: string) =>
      payload.create({
        collection: 'report-definitions',
        data: {
          title: `${P} ${title}`,
          slug,
          sql: `SELECT decision, count(*) AS n FROM decision WHERE conversation_id LIKE '${P}%' GROUP BY 1 ORDER BY 1`,
          parameters: [],
          roles: ['admin', 'supervisor'],
          _status: 'published',
        } as never,
        overrideAccess: true,
      })
    const shared = await report('test-btb509-dashboard', 'dashboard')
    await report('test-btb509-not-shared', 'not shared')
    const created = await payload.create({
      collection: MCP_API_KEYS_SLUG,
      data: {
        label: `${P} dashboard`,
        user: users.supervisor.id,
        scope: 'dashboard',
        reports: [shared.id],
        // Ignored for a dashboard key.
        reportDefinitions: { find: true, create: true },
      } as never,
      overrideAccess: false,
      user: admin(),
    })
    dashboardKey = (created as unknown as { apiKey: string }).apiKey
  })

  it('must name the reports it may run', async () => {
    const refused = await payload
      .create({
        collection: MCP_API_KEYS_SLUG,
        data: { label: `${P} empty`, user: users.supervisor.id, scope: 'dashboard' } as never,
        overrideAccess: false,
        user: admin(),
      })
      .catch((e: { data?: unknown }) => e)
    expect(JSON.stringify((refused as { data?: unknown }).data)).toMatch(/Choose the reports/)
  })

  it('offers only list_reports and run_report', async () => {
    const r = await rpc('tools/list', {}, dashboardKey)
    expect(r.body?.result?.tools?.map((t) => t.name).sort()).toEqual(['list_reports', 'run_report'])
  })

  it('lists and runs the reports ticked on it, and nothing else', async () => {
    const listed = JSON.parse(await callText('list_reports', {}, dashboardKey))
    expect(listed.map((r: { slug: string }) => r.slug)).toEqual(['test-btb509-dashboard'])
    const run = JSON.parse(
      await callText('run_report', { slug: 'test-btb509-dashboard' }, dashboardKey),
    )
    expect(run.rows).toEqual([
      { decision: 'APPROVED', n: 1 },
      { decision: 'DECLINED', n: 1 },
    ])
    expect(await callText('run_report', { slug: 'test-btb509-not-shared' }, dashboardKey)).toMatch(
      /^Error: FORBIDDEN/,
    )
    // No ad-hoc SQL, whatever the caller asks for.
    expect(await callText('run_report_query', { sql: 'SELECT 1 AS n' }, dashboardKey)).not.toMatch(
      /"rows"/,
    )
  })

  it('is rate-limited per key', async () => {
    const created = await payload.create({
      collection: MCP_API_KEYS_SLUG,
      data: { label: `${P} limited`, user: users.admin.id } as never,
      overrideAccess: false,
      user: admin(),
    })
    const limited = (created as unknown as { apiKey: string }).apiKey
    const statuses: number[] = []
    for (let i = 0; i <= MCP_RATE_LIMITS.personal.limit; i++) {
      statuses.push((await rpc('tools/list', {}, limited)).status)
    }
    expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true)
    expect(statuses.at(-1)).toBe(429)
    // Other keys are unaffected.
    expect((await rpc('tools/list', {}, key)).status).toBe(200)
  }, 60_000)
})

describe('MCP tools', () => {
  it('lists the reporting tools and report find/create, never the plugin update or delete', async () => {
    const r = await rpc('tools/list', {}, key)
    expect(r.status).toBe(200)
    const names = r.body?.result?.tools?.map((t) => t.name) ?? []
    expect(names).toEqual(
      expect.arrayContaining([
        'list_reports',
        'describe_reporting_schema',
        'run_report_query',
        'run_report',
        'update_report_draft',
        'findReportDefinitions',
        'createReportDefinitions',
      ]),
    )
    // The plugin's update takes a server file path, read before any hook runs.
    expect(names).not.toContain('updateReportDefinitions')
    expect(names.some((n) => /delete/i.test(n))).toBe(false)
  })

  it('describes the reporting schema, without the restricted columns', async () => {
    const described = await callText('describe_reporting_schema', {})
    expect(described).toContain('## decision (view)')
    expect(described).toContain('## restricted_finding_summary (view)')
    expect(described).toContain('## Restricted over this connector')
    expect(described).not.toMatch(/^- (pep_hit|vulnerable_flag|fraud_score|kill_reason) /m)
  })

  it('runs a read-only query as reporting_mcp_reader, and logs it', async () => {
    const text = await callText('run_report_query', {
      sql: `SELECT decision, count(*) AS n FROM decision WHERE conversation_id LIKE $1 GROUP BY 1 ORDER BY 1`,
      parameters: [`${P}%`],
    })
    const result = JSON.parse(text)
    expect(result.rows).toEqual([
      { decision: 'APPROVED', n: 1 },
      { decision: 'DECLINED', n: 1 },
    ])
    expect(await callText('run_report_query', { sql: 'SELECT email FROM public.users' })).toMatch(
      /^Error: (PERMISSION|INVALID_SQL)/,
    )
    const asks = await payload.find({
      collection: 'report-asks',
      where: { kind: { equals: 'mcp_query' }, user: { equals: users.supervisor.id } },
      sort: '-createdAt',
      overrideAccess: true,
    })
    expect(asks.docs.map((d) => d.outcome)).toEqual(['error', 'ok'])
    // The log says which key ran it, not just whose it is.
    expect((asks.docs[0] as { actor?: { scope?: string; key?: string } }).actor).toMatchObject({
      scope: 'personal',
    })
    expect((asks.docs[0] as { actor?: { key?: string } }).actor?.key).toBeTruthy()
    expect(result.note).toMatch(/not instructions/)
  })

  it('cannot read a restricted column by any route, and caps identifier-bearing results (ADR 0002)', async () => {
    for (const sql of [
      `SELECT conversation_id, pep_hit FROM application WHERE conversation_id LIKE $1`,
      `SELECT conversation_id AS c, fraud_score AS s FROM application WHERE conversation_id LIKE $1`,
      `SELECT conversation_id FROM application WHERE conversation_id LIKE $1 AND pep_hit`,
      `SELECT conversation_id FROM application WHERE conversation_id LIKE $1 ORDER BY fraud_score`,
    ]) {
      const refused = await callText('run_report_query', { sql, parameters: [`${P}%`] })
      expect(refused, sql).toMatch(
        /^Error: PERMISSION: The query names a column this connector cannot read/,
      )
    }
    // Age and identifiers are open (ADR 0002 widens ADR 0001 here).
    const open = JSON.parse(
      await callText('run_report_query', {
        sql: `SELECT conversation_id, age_at_application FROM application WHERE conversation_id LIKE $1`,
        parameters: [`${P}%`],
      }),
    )
    expect(open.columns.map((c: { name: string }) => c.name)).toEqual([
      'conversation_id',
      'age_at_application',
    ])
    // Restricted findings are counted through the summary views.
    const summary = JSON.parse(
      await callText('run_report_query', {
        sql: `SELECT sum(applications) AS n, sum(pep_hits) AS pep FROM restricted_finding_summary`,
      }),
    )
    expect(summary.rows).toHaveLength(1)
    const capped = JSON.parse(
      await callText('run_report_query', {
        sql: `SELECT g AS conversation_id FROM generate_series(1, ${MCP_IDENTIFIER_ROW_CAP + 10}) g`,
      }),
    )
    expect(capped.rows).toHaveLength(MCP_IDENTIFIER_ROW_CAP)
    expect(capped.truncated).toBe(true)
    expect(capped.truncatedBecause).toMatch(/identifies/)
    const logged = await payload.find({
      collection: 'report-asks',
      where: { kind: { equals: 'mcp_query' }, user: { equals: users.supervisor.id } },
      sort: '-createdAt',
      limit: 4,
      overrideAccess: true,
    })
    expect(
      logged.docs.map((d) => (d.definition as { errorCode?: string })?.errorCode ?? 'ok'),
    ).toEqual(['ok', 'ok', 'ok', 'PERMISSION'])
  })

  it('runs a published report that reads restricted columns only when an admin has allowed it', async () => {
    const report = await payload.create({
      collection: 'report-definitions',
      data: {
        title: `${P} PEP count`,
        slug: 'test-btb509-pep-count',
        sql: 'SELECT count(*) FILTER (WHERE pep_hit) AS n FROM application',
        parameters: [],
        roles: ['admin', 'supervisor'],
        _status: 'published',
      } as never,
      overrideAccess: true,
    })
    expect(await callText('run_report', { slug: 'test-btb509-pep-count' })).toMatch(
      /^Error: PERMISSION: .*An admin can allow/,
    )
    await payload.update({
      collection: 'report-definitions',
      id: report.id,
      data: { mcpRestrictedAccess: true, _status: 'published' } as never,
      overrideAccess: true,
    })
    const run = JSON.parse(await callText('run_report', { slug: 'test-btb509-pep-count' }))
    expect(run.rows).toHaveLength(1)
  })

  it('only an admin can allow restricted columns, and a SQL change by anyone else withdraws it', async () => {
    const asUser = (role: string) => ({ ...users[role], collection: 'users' }) as never
    const base = {
      sql: 'SELECT 1 AS n',
      parameters: [],
      roles: ['admin', 'supervisor'],
      _status: 'published',
    }
    // A supervisor cannot create a report with the flag set.
    const bySupervisor = await payload.create({
      collection: 'report-definitions',
      data: {
        ...base,
        title: `${P} by supervisor`,
        slug: 'test-btb509-sup',
        mcpRestrictedAccess: true,
      } as never,
      overrideAccess: false,
      user: asUser('supervisor'),
    })
    expect((bySupervisor as { mcpRestrictedAccess?: boolean }).mcpRestrictedAccess).toBe(false)
    // An admin can.
    const byAdmin = await payload.create({
      collection: 'report-definitions',
      data: {
        ...base,
        title: `${P} by admin`,
        slug: 'test-btb509-adm',
        mcpRestrictedAccess: true,
      } as never,
      overrideAccess: false,
      user: asUser('admin'),
    })
    expect((byAdmin as { mcpRestrictedAccess?: boolean }).mcpRestrictedAccess).toBe(true)
    // A supervisor's title change keeps the approval; a SQL change withdraws it.
    const retitled = await payload.update({
      collection: 'report-definitions',
      id: byAdmin.id,
      data: { title: `${P} by admin, retitled` } as never,
      overrideAccess: false,
      user: asUser('supervisor'),
    })
    expect((retitled as { mcpRestrictedAccess?: boolean }).mcpRestrictedAccess).toBe(true)
    const rewritten = await payload.update({
      collection: 'report-definitions',
      id: byAdmin.id,
      data: { sql: 'SELECT 2 AS n' } as never,
      overrideAccess: false,
      user: asUser('supervisor'),
    })
    expect((rewritten as { mcpRestrictedAccess?: boolean }).mcpRestrictedAccess).toBe(false)
  })

  it("withdraws the approval when SQL changes over MCP, even in an admin's session", async () => {
    const report = await payload.create({
      collection: 'report-definitions',
      data: {
        title: `${P} approved`,
        slug: 'test-btb509-approved',
        sql: 'SELECT 1 AS n',
        parameters: [],
        roles: ['admin'],
        mcpRestrictedAccess: true,
        _status: 'published',
      } as never,
      overrideAccess: true,
    })
    const adminKey = (
      (await payload.create({
        collection: MCP_API_KEYS_SLUG,
        data: {
          label: `${P} admin editor`,
          user: users.admin.id,
          reportDefinitions: { find: true, create: true },
        } as never,
        overrideAccess: false,
        user: { ...users.admin, collection: 'users' } as never,
      })) as unknown as { apiKey: string }
    ).apiKey
    await callText('update_report_draft', { id: report.id, sql: 'SELECT 2 AS n' }, adminKey)
    const draft = await payload.findByID({
      collection: 'report-definitions',
      id: report.id,
      draft: true,
      overrideAccess: true,
    })
    expect(draft.sql).toBe('SELECT 2 AS n')
    expect((draft as { mcpRestrictedAccess?: boolean }).mcpRestrictedAccess).toBe(false)
  })

  it('cannot allow restricted columns itself, even for an admin', async () => {
    const adminKey = (
      (await payload.create({
        collection: MCP_API_KEYS_SLUG,
        data: {
          label: `${P} admin`,
          user: users.admin.id,
          reportDefinitions: { find: true, create: true },
        } as never,
        overrideAccess: false,
        user: { ...users.admin, collection: 'users' } as never,
      })) as unknown as { apiKey: string }
    ).apiKey
    await callText(
      'createReportDefinitions',
      {
        title: `${P} self-allowed`,
        slug: 'test-btb509-self-allowed',
        sql: 'SELECT count(*) FILTER (WHERE pep_hit) AS n FROM application',
        parameters: [],
        roles: ['admin'],
        mcpRestrictedAccess: true,
      },
      adminKey,
    )
    const { docs } = await payload.find({
      collection: 'report-definitions',
      where: { slug: { equals: 'test-btb509-self-allowed' } },
      draft: true,
      overrideAccess: true,
    })
    expect(docs).toHaveLength(1)
    expect((docs[0] as { mcpRestrictedAccess?: boolean }).mcpRestrictedAccess).toBe(false)
  })

  it('saves a new report as a draft, whatever status is asked for', async () => {
    const text = await callText('createReportDefinitions', {
      title: `${P} decisions`,
      slug: 'test-btb509-decisions',
      sql: `SELECT decision, count(*) AS n FROM decision WHERE decided_on >= $1::date GROUP BY 1`,
      parameters: [{ name: 'from', label: 'From', type: 'date', default: '2001-01-01' }],
      roles: ['admin', 'supervisor'],
      _status: 'published',
      draft: false,
    })
    expect(text).toMatch(/created successfully/)
    const { docs } = await payload.find({
      collection: 'report-definitions',
      where: { slug: { equals: 'test-btb509-decisions' } },
      draft: true,
      depth: 0,
      overrideAccess: true,
    })
    expect(docs[0]).toMatchObject({
      _status: 'draft',
      origin: 'mcp',
      author: users.supervisor.id,
    })
  })

  it('an update writes a draft and leaves the published report alone', async () => {
    const published = await payload.create({
      collection: 'report-definitions',
      data: {
        title: `${P} published`,
        slug: 'test-btb509-published',
        sql: 'SELECT 1 AS n',
        parameters: [],
        roles: ['admin', 'supervisor'],
        _status: 'published',
      } as never,
      overrideAccess: true,
    })
    const updated = await callText('update_report_draft', {
      id: published.id,
      title: `${P} published, changed`,
    })
    expect(JSON.parse(updated)).toMatchObject({ status: 'draft' })
    const live = await payload.findByID({
      collection: 'report-definitions',
      id: published.id,
      overrideAccess: true,
    })
    expect(live).toMatchObject({ title: `${P} published`, _status: 'published' })
    const latest = await payload.findByID({
      collection: 'report-definitions',
      id: published.id,
      draft: true,
      overrideAccess: true,
    })
    expect(latest.title).toBe(`${P} published, changed`)

    // A published report runs by slug, logged as an MCP run.
    const run = JSON.parse(await callText('run_report', { slug: 'test-btb509-published' }))
    expect(run.rows).toEqual([{ n: 1 }])
    const runs = await payload.find({
      collection: 'report-runs',
      where: { reportSlug: { equals: 'test-btb509-published' } },
      overrideAccess: true,
    })
    expect(runs.docs[0]).toMatchObject({ trigger: 'mcp', outcome: 'ok' })
  })

  it("never returns the author's user record, whatever depth is asked for", async () => {
    const text = await callText('findReportDefinitions', {
      where: JSON.stringify({ slug: { equals: 'test-btb509-decisions' } }),
      depth: 3,
      draft: true,
    })
    expect(text).toContain('test-btb509-decisions')
    expect(text).not.toContain('test-btb509-supervisor')
    expect(text).not.toMatch(/"email"/)
  })

  it('refuses a bulk update and a delete, even through the Local API on an MCP request', async () => {
    const req = { payloadAPI: 'MCP', user: { ...users.supervisor, collection: 'users' } }
    await expect(
      payload.update({
        collection: 'report-definitions',
        where: { slug: { like: 'test-btb509' } },
        data: { title: `${P} everything` },
        req: req as never,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await expect(
      payload.delete({
        collection: 'report-definitions',
        where: { slug: { like: 'test-btb509' } },
        req: req as never,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('a key is deleted when its person is no longer a report author', async () => {
    await payload.update({
      collection: 'users',
      id: users.supervisor.id,
      data: { role: 'operations' },
      overrideAccess: true,
    })
    expect((await rpc('tools/list', {}, key)).status).toBe(401)
    // Promoting them again does not bring the old key back.
    await payload.update({
      collection: 'users',
      id: users.supervisor.id,
      data: { role: 'supervisor' },
      overrideAccess: true,
    })
    expect((await rpc('tools/list', {}, key)).status).toBe(401)
  })

  it("a deleted person's keys go with them", async () => {
    const admin = { ...users.admin, collection: 'users' }
    const created = await payload.create({
      collection: MCP_API_KEYS_SLUG,
      data: { label: `${P} admin`, user: users.admin.id } as never,
      overrideAccess: false,
      user: admin as never,
    })
    await payload.delete({ collection: 'users', id: users.admin.id, overrideAccess: true })
    const left = await payload.find({
      collection: MCP_API_KEYS_SLUG,
      where: { id: { equals: created.id } },
      overrideAccess: true,
    })
    expect(left.docs).toHaveLength(0)
  })
})
