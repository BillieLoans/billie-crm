// @vitest-environment node
/**
 * Integration coverage for OAuth sign-in to the reporting MCP connector
 * (`src/server/reporting/mcp-oauth.ts`): discovery and the 401 challenge,
 * client registration limited to known callbacks, the sign-in request and
 * consent form, PKCE, refresh rotation, replayed codes and refresh tokens
 * revoking the connection, tools following the person's current role, and
 * connections going with a person who loses every staff role. TEST data only.
 */
import { createHash, randomBytes } from 'node:crypto'
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { REST_POST } from '@payloadcms/next/routes'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import type { Pool } from 'pg'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { getReportingPool } from '@/server/reporting/runner'
import {
  OAUTH_CLIENTS_SLUG,
  OAUTH_GRANTS_SLUG,
  approveAuthorization,
  checkAuthorizationRequest,
  openAuthorizationRequest,
  sealAuthorizationRequest,
  verifyAccessToken,
} from '@/server/reporting/mcp-oauth'
import { GET as protectedResource } from '@/app/api/oauth/protected-resource/route'
import { GET as authorizationServer } from '@/app/api/oauth/authorization-server/route'
import { POST as register } from '@/app/api/oauth/register/route'
import { POST as token } from '@/app/api/oauth/token/route'
import { GET as authorize, POST as decide } from '@/app/api/oauth/authorize/route'
import { reportingReaderPool, reportingReaderUri } from '../utils/reportingReader'

const P = 'TEST-OAUTH'
const ORIGIN = 'https://crm.test'
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'
const POST = REST_POST(config)

let payload: Payload
let pool: Pool
let reader: Pool
let previousAppUrl: string | undefined
let previousReportingUri: string | undefined
const users: Record<string, { id: string; email: string }> = {}

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

let rpcId = 0
async function rpc(method: string, params: unknown, bearer?: string) {
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
  let body: {
    result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }> }
  } | null = null
  try {
    body = JSON.parse(data || text)
  } catch {
    body = null
  }
  return { status: res.status, headers: res.headers, body }
}

const toolNames = async (bearer: string) =>
  ((await rpc('tools/list', {}, bearer)).body?.result?.tools ?? []).map((t) => t.name).sort()

const callText = async (name: string, args: Record<string, unknown>, bearer: string) =>
  (await rpc('tools/call', { name, arguments: args }, bearer)).body?.result?.content?.[0]?.text ??
  ''

async function registerClient(body: Record<string, unknown>) {
  const res = await register(
    new Request(`${ORIGIN}/api/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `${P}-${Math.random()}` },
      body: JSON.stringify(body),
    }),
  )
  return { status: res.status, body: await res.json() }
}

async function tokenCall(form: Record<string, string>, authorization?: string) {
  const res = await token(
    new Request(`${ORIGIN}/api/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(authorization ? { authorization } : {}),
      },
      body: new URLSearchParams(form).toString(),
    }),
  )
  return { status: res.status, headers: res.headers, body: await res.json() }
}

const authorizeParams = (clientId: string, verifier: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: CLAUDE,
    response_type: 'code',
    code_challenge: s256(verifier),
    code_challenge_method: 'S256',
    state: 'state-1',
    resource: `${ORIGIN}/api/mcp`,
    ...extra,
  })

/** Approve a connection for `who` and return the code and its verifier. */
async function approve(clientId: string, who: string) {
  const verifier = randomBytes(32).toString('base64url')
  const check = await checkAuthorizationRequest(payload, authorizeParams(clientId, verifier))
  if (!check.ok) throw new Error(check.message)
  const user = await payload.findByID({ collection: 'users', id: users[who].id, depth: 0 })
  const target = await approveAuthorization(payload, user, check.request)
  const url = new URL(String(target))
  return { code: String(url.searchParams.get('code')), verifier, url }
}

/** A public client signed in as `who`, through to tokens. */
async function connect(clientId: string, who: string) {
  const { code, verifier } = await approve(clientId, who)
  const t = await tokenCall({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: CLAUDE,
    resource: `${ORIGIN}/api/mcp`,
  })
  expect([t.status, t.body.error_description]).toEqual([200, undefined])
  return t.body as { access_token: string; refresh_token: string }
}

async function cleanup() {
  await pool.query(
    `DELETE FROM mcp_oauth_grants WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'test-oauth-%')`,
  )
  await pool.query(`DELETE FROM mcp_oauth_clients WHERE client_name LIKE '${P}%'`)
  await pool.query(`DELETE FROM report_runs WHERE report_slug LIKE 'test-oauth%'`)
  await payload.delete({
    collection: 'report-definitions',
    where: { title: { like: P } },
    overrideAccess: true,
  })
  await pool.query(`DELETE FROM users WHERE email LIKE 'test-oauth-%'`)
}

let publicClient = ''

beforeAll(async () => {
  previousAppUrl = process.env.NEXT_PUBLIC_APP_URL
  process.env.NEXT_PUBLIC_APP_URL = ORIGIN
  previousReportingUri = process.env.REPORTING_DATABASE_URI
  process.env.REPORTING_DATABASE_URI = reportingReaderUri()
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as unknown as Pool
  // Creates reporting_reader with its password and grants: a fresh database
  // (CI) has none until some suite does.
  reader = await reportingReaderPool(pool)
  await cleanup()
  for (const role of ['supervisor', 'readonly', 'operations']) {
    const email = `test-oauth-${role}-${Date.now()}@billie.loans`
    const u = await payload.create({
      collection: 'users',
      data: {
        email,
        password: 'Test1234!',
        role: role as 'readonly',
        firstName: 'Test',
        lastName: role,
      },
    })
    users[role] = { id: String(u.id), email }
  }
  for (const [slug, roles] of [
    ['test-oauth-readonly', ['readonly']],
    ['test-oauth-authors', ['supervisor']],
  ] as const) {
    await payload.create({
      collection: 'report-definitions',
      data: {
        title: `${P} ${slug}`,
        slug,
        sql: 'SELECT 1 AS n',
        parameters: [],
        roles,
        _status: 'published',
      } as never,
      overrideAccess: true,
    })
  }
  const registered = await registerClient({
    client_name: `${P} public`,
    redirect_uris: [CLAUDE],
    token_endpoint_auth_method: 'none',
  })
  publicClient = registered.body.client_id
}, 60_000)

afterAll(async () => {
  // The MCP pool is left open: the Payload instance, and so the pool, is shared with
  // later files (report-mcp closes it).
  await cleanup()
  await reader?.end()
  // Assigning undefined would store the string "undefined".
  for (const [name, value] of [
    ['NEXT_PUBLIC_APP_URL', previousAppUrl],
    ['REPORTING_DATABASE_URI', previousReportingUri],
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('discovery', () => {
  it('serves protected resource and authorization server metadata', async () => {
    const resource = await (await protectedResource()).json()
    expect(resource).toMatchObject({
      resource: `${ORIGIN}/api/mcp`,
      authorization_servers: [ORIGIN],
      scopes_supported: ['reports'],
    })
    const server = await (await authorizationServer()).json()
    expect(server).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/api/oauth/authorize`,
      token_endpoint: `${ORIGIN}/api/oauth/token`,
      registration_endpoint: `${ORIGIN}/api/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    })
  })

  it('answers /api/mcp without a token with a challenge naming the metadata', async () => {
    const r = await rpc('tools/list', {})
    expect(r.status).toBe(401)
    expect(r.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp", scope="reports"`,
    )
    const bad = await rpc('tools/list', {}, 'bcrmat_not-a-real-token')
    expect(bad.status).toBe(401)
    expect(bad.headers.get('www-authenticate')).toMatch(/error="invalid_token"/)
  })
})

describe('client registration', () => {
  it('registers public and confidential clients for known callbacks', async () => {
    const pub = await registerClient({
      client_name: `${P} pub`,
      redirect_uris: [CLAUDE, 'http://localhost:33418/callback'],
      token_endpoint_auth_method: 'none',
    })
    expect(pub.status).toBe(201)
    expect(pub.body.client_id).toMatch(/^bcrmcl_/)
    expect(pub.body.client_secret).toBeUndefined()
    // RFC 7591: the default method is client_secret_basic, so a secret is issued.
    const conf = await registerClient({ client_name: `${P} conf`, redirect_uris: [CLAUDE] })
    expect(conf.status).toBe(201)
    expect(conf.body.client_secret).toMatch(/^bcrmcs_/)
    const stored = await payload.find({
      collection: OAUTH_CLIENTS_SLUG,
      where: { clientId: { equals: conf.body.client_id } },
      overrideAccess: true,
    })
    expect(JSON.stringify(stored.docs[0])).not.toContain(conf.body.client_secret)
  })

  it('refuses any other redirect URI', async () => {
    for (const uri of [
      'https://evil.example/callback',
      'https://claude.ai.evil.example/api/mcp/auth_callback',
      'http://claude.ai/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callback#x',
    ]) {
      const r = await registerClient({ client_name: `${P} bad`, redirect_uris: [uri] })
      expect([uri, r.status, r.body.error]).toEqual([uri, 400, 'invalid_redirect_uri'])
    }
    expect((await registerClient({ client_name: `${P} bad` })).status).toBe(400)
  })
})

describe('sign-in request', () => {
  const verifier = 'v'.repeat(43)

  it('shows an unknown client or an unregistered redirect on the page, never redirecting', async () => {
    const unknown = await checkAuthorizationRequest(
      payload,
      authorizeParams('bcrmcl_unknown', verifier),
    )
    expect(unknown).toMatchObject({ ok: false })
    expect(unknown.ok === false && unknown.redirectTo).toBeFalsy()
    const elsewhere = await checkAuthorizationRequest(
      payload,
      authorizeParams(publicClient, verifier, { redirect_uri: 'http://localhost:1/callback' }),
    )
    expect(elsewhere.ok === false && elsewhere.redirectTo).toBeFalsy()
  })

  it('sends other problems back to the client', async () => {
    const noPkce = await checkAuthorizationRequest(
      payload,
      authorizeParams(publicClient, verifier, { code_challenge_method: 'plain' }),
    )
    expect(
      noPkce.ok === false && new URL(String(noPkce.redirectTo)).searchParams.get('error'),
    ).toBe('invalid_request')
    const otherResource = await checkAuthorizationRequest(
      payload,
      authorizeParams(publicClient, verifier, { resource: 'https://other.test/api/mcp' }),
    )
    const back = new URL(String(otherResource.ok === false && otherResource.redirectTo))
    expect(back.searchParams.get('error')).toBe('invalid_target')
    expect(back.searchParams.get('state')).toBe('state-1')
    expect(back.searchParams.get('iss')).toBe(ORIGIN)
  })

  it('hands a good request, signed, to the sign-in page from this origin', async () => {
    const params = authorizeParams(publicClient, verifier)
    const res = await authorize(new Request(`${ORIGIN}/api/oauth/authorize?${params}`))
    expect(res.status).toBe(200)
    const html = await res.text()
    const sealed = /\/oauth\/authorize\?req=([A-Za-z0-9_.-]+)/.exec(html)?.[1]
    expect(openAuthorizationRequest(payload.secret, sealed)).toMatchObject({
      clientId: publicClient,
      redirectUri: CLAUDE,
      state: 'state-1',
    })
    const unknown = await authorize(
      new Request(`${ORIGIN}/api/oauth/authorize?${authorizeParams('bcrmcl_unknown', verifier)}`),
    )
    expect(unknown.headers.get('location')).toBe(`${ORIGIN}/oauth/authorize?problem=client`)
    const plain = await authorize(
      new Request(
        `${ORIGIN}/api/oauth/authorize?${authorizeParams(publicClient, verifier, { code_challenge_method: 'plain' })}`,
      ),
    )
    expect(new URL(String(plain.headers.get('location'))).searchParams.get('error')).toBe(
      'invalid_request',
    )
  })

  it('signs the request so it cannot be altered on its way through the login', async () => {
    const check = await checkAuthorizationRequest(payload, authorizeParams(publicClient, verifier))
    if (!check.ok) throw new Error(check.message)
    const sealed = sealAuthorizationRequest(payload.secret, check.request)
    expect(openAuthorizationRequest(payload.secret, sealed)).toEqual(check.request)
    const [body, sig] = sealed.split('.')
    const altered = Buffer.from(
      JSON.stringify({
        ...check.request,
        redirectUri: 'https://evil.example/',
        exp: Date.now() + 60_000,
      }),
    ).toString('base64url')
    expect(openAuthorizationRequest(payload.secret, `${altered}.${sig}`)).toBeNull()
    expect(openAuthorizationRequest('another-secret', sealed)).toBeNull()
    expect(openAuthorizationRequest(payload.secret, body)).toBeNull()
  })

  it('the consent form sends a signed-out person to the login, and back', async () => {
    const check = await checkAuthorizationRequest(payload, authorizeParams(publicClient, verifier))
    if (!check.ok) throw new Error(check.message)
    const sealed = sealAuthorizationRequest(payload.secret, check.request)
    const form = new FormData()
    form.set('request', sealed)
    form.set('decision', 'allow')
    const res = await decide(
      new Request(`${ORIGIN}/api/oauth/authorize`, { method: 'POST', body: form }),
    )
    expect(res.status).toBe(303)
    const login = new URL(String(res.headers.get('location')))
    expect(login.pathname).toBe('/admin/login')
    expect(login.searchParams.get('redirect')).toBe(`/oauth/authorize?req=${sealed}`)
  })

  it('the consent form approves or declines for the signed-in person', async () => {
    const check = await checkAuthorizationRequest(payload, authorizeParams(publicClient, verifier))
    if (!check.ok) throw new Error(check.message)
    const { token: session } = await payload.login({
      collection: 'users',
      data: { email: users.readonly.email, password: 'Test1234!' },
    })
    const post = async (decision: string) => {
      const form = new FormData()
      form.set('request', sealAuthorizationRequest(payload.secret, check.request))
      form.set('decision', decision)
      const res = await decide(
        new Request(`${ORIGIN}/api/oauth/authorize`, {
          method: 'POST',
          body: form,
          // A browser's same-origin form post: Payload reads the cookie for allowed origins.
          headers: { cookie: `payload-token=${session}`, origin: payload.config.csrf[0] },
        }),
      )
      expect(res.status).toBe(303)
      return new URL(String(res.headers.get('location')))
    }
    const denied = await post('deny')
    expect(`${denied.origin}${denied.pathname}`).toBe(CLAUDE)
    expect(denied.searchParams.get('error')).toBe('access_denied')
    const allowed = await post('allow')
    expect(allowed.searchParams.get('code')).toMatch(/^bcrmac_/)
    expect(allowed.searchParams.get('state')).toBe('state-1')
    expect(allowed.searchParams.get('iss')).toBe(ORIGIN)
  })
})

describe('tokens', () => {
  it('exchanges a code once, with the right verifier, for tokens that work at /api/mcp', async () => {
    const { code, verifier } = await approve(publicClient, 'readonly')
    const wrong = await tokenCall({
      grant_type: 'authorization_code',
      client_id: publicClient,
      code,
      code_verifier: 'w'.repeat(43),
    })
    expect(wrong.body.error).toBe('invalid_grant')
    // A failed attempt spends the code.
    const late = await tokenCall({
      grant_type: 'authorization_code',
      client_id: publicClient,
      code,
      code_verifier: verifier,
    })
    expect(late.body.error).toBe('invalid_grant')

    const tokens = await connect(publicClient, 'readonly')
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'reports' })
    expect((await rpc('tools/list', {}, tokens.access_token)).status).toBe(200)
  })

  it('a replayed code revokes what it issued', async () => {
    const { code, verifier } = await approve(publicClient, 'readonly')
    const form = {
      grant_type: 'authorization_code',
      client_id: publicClient,
      code,
      code_verifier: verifier,
    }
    const first = await tokenCall(form)
    expect(first.status).toBe(200)
    const replay = await tokenCall(form)
    expect(replay.body.error).toBe('invalid_grant')
    expect(await verifyAccessToken(payload, first.body.access_token)).toBeNull()
  })

  it('refresh tokens rotate; a late replay revokes the connection, a quick one does not', async () => {
    const tokens = await connect(publicClient, 'readonly')
    const refresh = (refresh_token: string) =>
      tokenCall({ grant_type: 'refresh_token', client_id: publicClient, refresh_token })
    const next = await refresh(tokens.refresh_token)
    expect(next.status).toBe(200)
    expect(next.body.refresh_token).not.toBe(tokens.refresh_token)
    // The replaced access token works until it expires, so a second session is not cut off.
    expect(await verifyAccessToken(payload, tokens.access_token)).not.toBeNull()
    expect(await verifyAccessToken(payload, next.body.access_token)).not.toBeNull()

    // A retry or a second session within the grace period: refused, nothing revoked.
    expect((await refresh(tokens.refresh_token)).body.error).toBe('invalid_grant')
    expect(await verifyAccessToken(payload, next.body.access_token)).not.toBeNull()

    // The same replay later means someone else has the token: the connection goes.
    await pool.query(
      `UPDATE mcp_oauth_grants SET refreshed_at = now() - interval '5 minutes'
        WHERE refresh_index IS NOT NULL AND user_id = $1`,
      [users.readonly.id],
    )
    expect((await refresh(tokens.refresh_token)).body.error).toBe('invalid_grant')
    expect(await verifyAccessToken(payload, next.body.access_token)).toBeNull()
    expect((await refresh(next.body.refresh_token)).body.error).toBe('invalid_grant')
  })

  it('deleting a client ends its connections', async () => {
    const own = await registerClient({
      client_name: `${P} doomed`,
      redirect_uris: [CLAUDE],
      token_endpoint_auth_method: 'none',
    })
    const tokens = await connect(own.body.client_id, 'readonly')
    await payload.delete({
      collection: OAUTH_CLIENTS_SLUG,
      where: { clientId: { equals: own.body.client_id } },
      overrideAccess: true,
    })
    expect(await verifyAccessToken(payload, tokens.access_token)).toBeNull()
  })

  it('a confidential client must authenticate', async () => {
    const conf = await registerClient({ client_name: `${P} secret`, redirect_uris: [CLAUDE] })
    const clientId = conf.body.client_id
    const { code, verifier } = await approve(clientId, 'readonly')
    const form = { grant_type: 'authorization_code', code, code_verifier: verifier }
    const anonymous = await tokenCall({ ...form, client_id: clientId })
    expect(anonymous.status).toBe(401)
    expect(anonymous.body.error).toBe('invalid_client')
    const basic = `Basic ${Buffer.from(`${clientId}:${conf.body.client_secret}`).toString('base64')}`
    const ok = await tokenCall(form, basic)
    expect(ok.status).toBe(200)
  })

  it('expired tokens are refused', async () => {
    const tokens = await connect(publicClient, 'readonly')
    await pool.query(
      `UPDATE mcp_oauth_grants SET access_expires_at = now() - interval '1 second'
        WHERE user_id = $1`,
      [users.readonly.id],
    )
    const r = await rpc('tools/list', {}, tokens.access_token)
    expect(r.status).toBe(401)
    expect(r.headers.get('www-authenticate')).toMatch(/invalid_token/)
  })
})

describe('what a connection can do', () => {
  it('a report author gets every reporting tool', async () => {
    const { access_token } = await connect(publicClient, 'supervisor')
    expect(await toolNames(access_token)).toEqual(
      expect.arrayContaining([
        'createReportDefinitions',
        'describe_reporting_schema',
        'findReportDefinitions',
        'list_reports',
        'run_report',
        'run_report_query',
        'update_report_draft',
      ]),
    )
    const listed = JSON.parse(await callText('list_reports', {}, access_token))
    expect(listed.map((r: { slug: string }) => r.slug)).toEqual(
      expect.arrayContaining(['test-oauth-authors', 'test-oauth-readonly']),
    )
  })

  it('other staff list and run the reports their role may run, and nothing else', async () => {
    // A closed pool (another suite's teardown, or a shutdown) is replaced on next use.
    await (await getReportingPool('mcp')).end()
    const { access_token } = await connect(publicClient, 'readonly')
    expect(await toolNames(access_token)).toEqual(['list_reports', 'run_report'])
    const listed = JSON.parse(await callText('list_reports', {}, access_token))
    const slugs = listed.map((r: { slug: string }) => r.slug)
    expect(slugs).toContain('test-oauth-readonly')
    expect(slugs).not.toContain('test-oauth-authors')
    const run = JSON.parse(
      await callText('run_report', { slug: 'test-oauth-readonly' }, access_token),
    )
    expect(run.rows).toEqual([{ n: 1 }])
    expect(await callText('run_report', { slug: 'test-oauth-authors' }, access_token)).toMatch(
      /^Error: FORBIDDEN/,
    )
    expect(await callText('run_report_query', { sql: 'SELECT 1' }, access_token)).not.toMatch(
      /"rows"/,
    )
  })

  it("follows the person's role on every request", async () => {
    const { access_token } = await connect(publicClient, 'operations')
    expect(await toolNames(access_token)).toEqual(['list_reports', 'run_report'])
    await payload.update({
      collection: 'users',
      id: users.operations.id,
      data: { role: 'supervisor' },
      overrideAccess: true,
    })
    expect(await toolNames(access_token)).toContain('run_report_query')
    // Losing every staff role ends their connections.
    await payload.update({
      collection: 'users',
      id: users.operations.id,
      data: { role: 'marketing' },
      overrideAccess: true,
    })
    expect((await rpc('tools/list', {}, access_token)).status).toBe(401)
    const left = await payload.find({
      collection: OAUTH_GRANTS_SLUG,
      where: { user: { equals: users.operations.id } },
      overrideAccess: true,
    })
    expect(left.docs).toHaveLength(0)
  })

  it('a deleted connection stops working at once, and a deleted person takes theirs', async () => {
    const { access_token } = await connect(publicClient, 'readonly')
    const found = await verifyAccessToken(payload, access_token)
    await payload.delete({
      collection: OAUTH_GRANTS_SLUG,
      id: String(found?.grantId),
      overrideAccess: true,
    })
    expect((await rpc('tools/list', {}, access_token)).status).toBe(401)

    await connect(publicClient, 'readonly')
    await payload.delete({ collection: 'users', id: users.readonly.id, overrideAccess: true })
    const left = await payload.find({
      collection: OAUTH_GRANTS_SLUG,
      where: { user: { equals: users.readonly.id } },
      overrideAccess: true,
    })
    expect(left.docs).toHaveLength(0)
  })
})
