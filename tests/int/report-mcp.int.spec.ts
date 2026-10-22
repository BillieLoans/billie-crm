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
import { MCP_API_KEYS_SLUG } from '@/server/reporting/mcp'
import { reportingReaderPool, reportingReaderUri } from '../utils/reportingReader'

const P = 'TEST-BTB509'
let payload: Payload
let pool: Pool
let reader: Pool
const users: Record<string, { id: string; role: string }> = {}
let key = ''
let previousReportingUri: string | undefined
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
  previousReportingUri = process.env.REPORTING_DATABASE_URI
  process.env.REPORTING_DATABASE_URI = reportingReaderUri()
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
      reportDefinitions: { find: true, create: true, update: true },
    } as never,
    overrideAccess: false,
    user: { ...users.admin, collection: 'users' } as never,
  })
  key = (created as unknown as { apiKey: string }).apiKey
}, 60_000)

afterAll(async () => {
  await cleanup()
  await reader?.end()
  await (await getReportingPool()).end()
  process.env.REPORTING_DATABASE_URI = previousReportingUri
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

describe('MCP tools', () => {
  it('lists the reporting tools and report find/create/update, never delete', async () => {
    const r = await rpc('tools/list', {}, key)
    expect(r.status).toBe(200)
    const names = r.body?.result?.tools?.map((t) => t.name) ?? []
    expect(names).toEqual(
      expect.arrayContaining([
        'describe_reporting_schema',
        'run_report_query',
        'run_report',
        'findReportDefinitions',
        'createReportDefinitions',
        'updateReportDefinitions',
      ]),
    )
    expect(names.some((n) => /delete/i.test(n))).toBe(false)
  })

  it('describes the reporting schema', async () => {
    expect(await callText('describe_reporting_schema', {})).toContain('## decision (view)')
  })

  it('runs a read-only query as reporting_reader, and logs it', async () => {
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
    const updated = await callText('updateReportDefinitions', {
      id: published.id,
      title: `${P} published, changed`,
      _status: 'published',
    })
    expect(updated).toMatch(/updated successfully/i)
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

  it('refuses a bulk update', async () => {
    const text = await callText('updateReportDefinitions', {
      where: JSON.stringify({ slug: { like: 'test-btb509' } }),
      title: `${P} everything`,
    })
    expect(text).toMatch(/error|not allowed/i)
    const { docs } = await payload.find({
      collection: 'report-definitions',
      where: { title: { equals: `${P} everything` } },
      draft: true,
      overrideAccess: true,
    })
    expect(docs).toHaveLength(0)
  })

  it('a key stops working when its person is no longer a report author', async () => {
    await payload.update({
      collection: 'users',
      id: users.supervisor.id,
      data: { role: 'operations' },
      overrideAccess: true,
    })
    expect((await rpc('tools/list', {}, key)).status).toBe(403)
  })
})
