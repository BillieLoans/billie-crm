/**
 * OAuth 2.1 for the reporting MCP connector: claude.ai and Claude Code
 * connect with a person's own CRM sign-in instead of a shared key.
 *
 * The CRM is both the authorization server and the resource server
 * (`/api/mcp`), following the MCP authorization spec (2025-11-25):
 *
 * - Discovery: protected resource metadata (RFC 9728), named in the
 *   `WWW-Authenticate` challenge on a 401 from `/api/mcp`, and authorization
 *   server metadata (RFC 8414). Both live under `/.well-known/`, rewritten in
 *   `next.config.mjs` to `/api/oauth/*`.
 * - Clients register themselves (RFC 7591). Registration only accepts the
 *   claude.ai and claude.com callbacks, loopback addresses (Claude Code) and
 *   `MCP_OAUTH_REDIRECT_URIS`, so no registration can send a person's code
 *   anywhere else.
 * - Authorization code with PKCE (S256 only) and the `resource` indicator
 *   (RFC 8707). `/api/oauth/authorize` checks the request and hands it,
 *   signed, to the sign-in page (`/oauth/authorize`), which goes through the
 *   CRM login, shows who is asking and where the person will be sent back
 *   to, and records the approval as an MCP connection (`mcp-oauth-grants`).
 * - Opaque tokens, stored as HMACs: access tokens last an hour; refresh
 *   tokens rotate on every use and lapse after 30 days unused. A code or a
 *   refresh token used twice revokes the connection.
 *
 * What a token may do is decided on every request from the person's current
 * role (`authenticateMcp` in `mcp.ts`), not at sign-in.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Payload } from 'payload'
import { hasAnyRole } from '@/lib/access'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { OAUTH_GRANTS_SLUG, apiKeyIndex } from './mcp-keys'

export const OAUTH_CLIENTS_SLUG = 'mcp-oauth-clients' as const
export { OAUTH_GRANTS_SLUG }

/** The one scope: use the reporting connector, as far as the person's role allows. */
export const OAUTH_SCOPE = 'reports'
export const ACCESS_TOKEN_TTL_S = 60 * 60
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60
export const CODE_TTL_S = 5 * 60
/** How long a sign-in page link stays valid: long enough to log in first. */
export const AUTHORIZE_REQUEST_TTL_MS = 15 * 60_000

export const ACCESS_TOKEN_PREFIX = 'bcrmat_'
const REFRESH_TOKEN_PREFIX = 'bcrmrt_'
const CODE_PREFIX = 'bcrmac_'
const CLIENT_ID_PREFIX = 'bcrmcl_'
const CLIENT_SECRET_PREFIX = 'bcrmcs_'

const AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'] as const
type AuthMethod = (typeof AUTH_METHODS)[number]

/** Hosted MCP clients' callbacks. Loopback addresses are allowed separately. */
const HOSTED_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
]
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** A PKCE verifier or S256 challenge (RFC 7636). */
const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/

const newSecret = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`
const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url')
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * The CRM's public origin (`NEXT_PUBLIC_APP_URL`, with the same local default
 * as Payload's `serverURL`): the issuer and the resource's host.
 */
export function appOrigin(): string {
  return new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').origin
}

/** The canonical URI of the MCP server, the audience of every token. */
export const mcpResourceUri = (): string => `${appOrigin()}/api/mcp`

export const resourceMetadataUri = (): string =>
  `${appOrigin()}/.well-known/oauth-protected-resource/api/mcp`

/** Protected resource metadata (RFC 9728). */
export function protectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: mcpResourceUri(),
    authorization_servers: [appOrigin()],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Billie CRM reporting',
  }
}

/** Authorization server metadata (RFC 8414). */
export function authorizationServerMetadata(): Record<string, unknown> {
  const origin = appOrigin()
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: [...AUTH_METHODS],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  }
}

/** The challenge on a 401 from `/api/mcp`, which starts discovery. */
export function wwwAuthenticate(error?: 'invalid_token'): string {
  const parts = [`resource_metadata="${resourceMetadataUri()}"`, `scope="${OAUTH_SCOPE}"`]
  if (error) parts.push(`error="${error}"`)
  return `Bearer ${parts.join(', ')}`
}

/**
 * Where the CRM may send a person back to with a code: the claude.ai and
 * claude.com callbacks, a loopback address over http (Claude Code listens on
 * one; RFC 8252), or an exact URI in `MCP_OAUTH_REDIRECT_URIS`.
 */
export function isAllowedRedirectUri(uri: unknown): boolean {
  if (typeof uri !== 'string' || uri.length > 500) return false
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.hash || url.username || url.password) return false
  const extra = (process.env.MCP_OAUTH_REDIRECT_URIS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if ([...HOSTED_REDIRECT_URIS, ...extra].includes(uri)) return true
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

/** Whether `value` names this MCP server (RFC 8707), ignoring a trailing slash and case of host. */
function isThisResource(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.search || url.hash) return false
    return `${url.origin}${url.pathname.replace(/\/$/, '')}` === mcpResourceUri()
  } catch {
    return false
  }
}

export interface OAuthResult {
  status: number
  body: Record<string, unknown>
  headers?: Record<string, string>
}

const oauthError = (
  status: number,
  error: string,
  description: string,
  headers?: Record<string, string>,
): OAuthResult => ({ status, body: { error, error_description: description }, headers })

interface ClientDoc {
  id: string
  clientId: string
  clientName?: string | null
  redirectUris: string[]
  tokenEndpointAuthMethod: AuthMethod
  secretIndex?: string | null
}

async function findClient(payload: Payload, clientId: unknown): Promise<ClientDoc | null> {
  if (typeof clientId !== 'string' || !clientId.startsWith(CLIENT_ID_PREFIX)) return null
  if (clientId.length > 100) return null
  const { docs } = await payload.find({
    collection: OAUTH_CLIENTS_SLUG,
    where: { clientId: { equals: clientId } },
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    showHiddenFields: true,
  })
  const doc = docs[0] as unknown as ClientDoc | undefined
  return doc && Array.isArray(doc.redirectUris) ? doc : null
}

/** Dynamic client registration (RFC 7591), `POST /api/oauth/register`. */
export async function registerClient(payload: Payload, input: unknown): Promise<OAuthResult> {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const redirectUris = body.redirect_uris
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > 10 ||
    !redirectUris.every((u) => typeof u === 'string')
  ) {
    return oauthError(400, 'invalid_redirect_uri', 'redirect_uris must list 1 to 10 URIs')
  }
  const refused = redirectUris.find((u) => !isAllowedRedirectUri(u))
  if (refused !== undefined) {
    return oauthError(400, 'invalid_redirect_uri', `This server does not redirect to ${refused}`)
  }
  // RFC 7591's default is client_secret_basic.
  const method = (body.token_endpoint_auth_method ?? 'client_secret_basic') as AuthMethod
  if (!AUTH_METHODS.includes(method)) {
    return oauthError(400, 'invalid_client_metadata', 'Unsupported token_endpoint_auth_method')
  }
  const grantTypes = body.grant_types ?? ['authorization_code']
  const responseTypes = body.response_types ?? ['code']
  if (
    !Array.isArray(grantTypes) ||
    !grantTypes.every((g) => g === 'authorization_code' || g === 'refresh_token') ||
    !Array.isArray(responseTypes) ||
    !responseTypes.every((r) => r === 'code')
  ) {
    return oauthError(
      400,
      'invalid_client_metadata',
      'Only the authorization_code and refresh_token grants, and response type code, are supported',
    )
  }
  const clientName =
    typeof body.client_name === 'string' ? body.client_name.trim().slice(0, 100) : ''
  const clientId = `${CLIENT_ID_PREFIX}${randomBytes(16).toString('base64url')}`
  const secret = method === 'none' ? undefined : newSecret(CLIENT_SECRET_PREFIX)
  await payload.create({
    collection: OAUTH_CLIENTS_SLUG,
    data: {
      clientId,
      clientName: clientName || null,
      redirectUris,
      tokenEndpointAuthMethod: method,
      secretIndex: secret ? apiKeyIndex(payload.secret, secret) : null,
    },
    overrideAccess: true,
  })
  return {
    status: 201,
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      ...(clientName ? { client_name: clientName } : {}),
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: method,
    },
  }
}

/** A checked authorization request, carried through the CRM login. */
export interface AuthorizationRequest {
  clientId: string
  clientName: string
  redirectUri: string
  state: string | null
  codeChallenge: string
  resource: string
}

export type AuthorizationCheck =
  | { ok: true; request: AuthorizationRequest }
  /** `redirectTo` is set when the error can go back to the client (RFC 6749 4.1.2.1). */
  | { ok: false; message: string; redirectTo?: string }

function errorRedirect(
  redirectUri: string,
  state: string | null,
  error: string,
  description: string,
): string {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  url.searchParams.set('error_description', description)
  if (state) url.searchParams.set('state', state)
  url.searchParams.set('iss', appOrigin())
  return url.href
}

/**
 * Check `GET /api/oauth/authorize`. An unknown client or a redirect URI it
 * did not register is shown to the person and never redirected to; any other
 * problem goes back to the client.
 */
export async function checkAuthorizationRequest(
  payload: Payload,
  params: URLSearchParams,
): Promise<AuthorizationCheck> {
  const client = await findClient(payload, params.get('client_id'))
  if (!client) {
    return {
      ok: false,
      message: 'This app is not registered with the CRM. Go back to Claude and connect again.',
    }
  }
  const asked = params.get('redirect_uri')
  const redirectUri = asked ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null)
  if (
    !redirectUri ||
    !client.redirectUris.includes(redirectUri) ||
    !isAllowedRedirectUri(redirectUri)
  ) {
    return {
      ok: false,
      message: 'The app asked to send you back to an address it did not register.',
    }
  }
  const state = params.get('state')
  const fail = (error: string, description: string): AuthorizationCheck => ({
    ok: false,
    message: description,
    redirectTo: errorRedirect(
      redirectUri,
      state && state.length <= 1000 ? state : null,
      error,
      description,
    ),
  })
  if (state !== null && state.length > 1000) return fail('invalid_request', 'state is too long')
  if (params.get('response_type') !== 'code') {
    return fail('unsupported_response_type', 'Only response_type=code is supported')
  }
  const challenge = params.get('code_challenge') ?? ''
  if (params.get('code_challenge_method') !== 'S256' || !PKCE_VALUE.test(challenge)) {
    return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required')
  }
  const resource = params.get('resource')
  if (resource !== null && !isThisResource(resource)) {
    return fail('invalid_target', `Tokens are issued for ${mcpResourceUri()} only`)
  }
  return {
    ok: true,
    request: {
      clientId: client.clientId,
      clientName: client.clientName || 'An unnamed app',
      redirectUri,
      state,
      codeChallenge: challenge,
      resource: mcpResourceUri(),
    },
  }
}

const requestSignature = (secret: string, body: string) =>
  createHmac('sha256', secret).update(`mcp-oauth-request:${body}`).digest('base64url')

/** Sign a checked request so it survives the login redirect and the consent form unchanged. */
export function sealAuthorizationRequest(secret: string, request: AuthorizationRequest): string {
  const body = Buffer.from(
    JSON.stringify({ ...request, exp: Date.now() + AUTHORIZE_REQUEST_TTL_MS }),
  ).toString('base64url')
  return `${body}.${requestSignature(secret, body)}`
}

/** The request `sealAuthorizationRequest` signed, or null if it was altered or has expired. */
export function openAuthorizationRequest(
  secret: string,
  sealed: unknown,
): AuthorizationRequest | null {
  if (typeof sealed !== 'string' || sealed.length > 8000) return null
  const [body, signature, extra] = sealed.split('.')
  if (!body || !signature || extra !== undefined) return null
  if (!sameText(signature, requestSignature(secret, body))) return null
  try {
    const { exp, ...request } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof exp !== 'number' || exp < Date.now()) return null
    return request as AuthorizationRequest
  } catch {
    return null
  }
}

/** Drop codes never exchanged and connections whose refresh token has lapsed. */
async function deleteStaleGrants(payload: Payload): Promise<void> {
  const now = new Date().toISOString()
  await payload.delete({
    collection: OAUTH_GRANTS_SLUG,
    where: {
      or: [
        {
          and: [
            { accessIndex: { exists: false } },
            { codeExpiresAt: { less_than: new Date(Date.now() - 60 * 60_000).toISOString() } },
          ],
        },
        { refreshExpiresAt: { less_than: now } },
      ],
    },
    overrideAccess: true,
  })
}

/**
 * The person approved: record the connection with a one-time code and
 * return the client's redirect URI to send them to. Null when the client
 * or its redirect URI has gone since the page was shown, or the person may
 * not use reporting.
 */
export async function approveAuthorization(
  payload: Payload,
  user: unknown,
  request: AuthorizationRequest,
): Promise<string | null> {
  const client = await findClient(payload, request.clientId)
  if (!client || !client.redirectUris.includes(request.redirectUri)) return null
  if (!hasAnyRole(user)) return null
  await deleteStaleGrants(payload)
  const code = newSecret(CODE_PREFIX)
  await payload.create({
    collection: OAUTH_GRANTS_SLUG,
    data: {
      user: (user as { id: string }).id,
      clientId: client.clientId,
      clientName: client.clientName ?? null,
      redirectUri: request.redirectUri,
      redirectHost: new URL(request.redirectUri).host,
      scope: OAUTH_SCOPE,
      resource: request.resource,
      codeIndex: apiKeyIndex(payload.secret, code),
      codeChallenge: request.codeChallenge,
      codeExpiresAt: iso(CODE_TTL_S * 1000),
      codeUsed: false,
    },
    overrideAccess: true,
  })
  const url = new URL(request.redirectUri)
  url.searchParams.set('code', code)
  if (request.state) url.searchParams.set('state', request.state)
  url.searchParams.set('iss', appOrigin())
  return url.href
}

/** The person declined: send them back with `access_denied`. */
export function denyAuthorization(request: AuthorizationRequest): string {
  return errorRedirect(request.redirectUri, request.state, 'access_denied', 'Access was declined')
}

function basicCredentials(header: string | null): { id: string; secret: string } | null {
  const match = /^Basic\s+(\S+)$/i.exec(header ?? '')
  if (!match) return null
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  if (colon < 0) return null
  try {
    // RFC 6749 2.3.1: both parts are form-urlencoded.
    return {
      id: decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' ')),
      secret: decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' ')),
    }
  } catch {
    return null
  }
}

async function authenticateClient(
  payload: Payload,
  form: URLSearchParams,
  authorization: string | null,
): Promise<{ client: ClientDoc } | { error: OAuthResult }> {
  const basic = basicCredentials(authorization)
  const formId = form.get('client_id')
  if (basic && formId && formId !== basic.id) {
    return { error: oauthError(400, 'invalid_request', 'Two different client ids were sent') }
  }
  const refuse = {
    error: oauthError(
      401,
      'invalid_client',
      'Client authentication failed',
      basic ? { 'WWW-Authenticate': 'Basic realm="Billie CRM"' } : undefined,
    ),
  }
  const client = await findClient(payload, basic?.id ?? formId)
  if (!client) return refuse
  if (client.tokenEndpointAuthMethod === 'none') return { client }
  const secret = basic?.secret ?? form.get('client_secret')
  if (!secret || !client.secretIndex) return refuse
  return sameText(apiKeyIndex(payload.secret, secret), client.secretIndex) ? { client } : refuse
}

interface GrantDoc {
  id: string
  user: string
  clientId: string
  redirectUri: string
  resource: string
  codeChallenge?: string | null
  codeExpiresAt?: string | null
  accessExpiresAt?: string | null
  lastUsedAt?: string | null
}

const invalidGrant = (description: string) => oauthError(400, 'invalid_grant', description)

async function staffUser(payload: Payload, id: unknown): Promise<Record<string, unknown> | null> {
  if (typeof id !== 'string') return null
  const user = await payload.findByID({
    collection: 'users',
    id,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
  })
  return user && hasAnyRole(user) ? (user as unknown as Record<string, unknown>) : null
}

function tokenResponse(access: string, refresh: string): OAuthResult {
  return {
    status: 200,
    body: {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: refresh,
      scope: OAUTH_SCOPE,
    },
  }
}

function sqlPool(payload: Payload) {
  const pool = getDashboardPool(payload)
  if (!pool) throw new Error('No database pool')
  return pool
}

async function exchangeCode(
  payload: Payload,
  client: ClientDoc,
  form: URLSearchParams,
): Promise<OAuthResult> {
  const code = form.get('code') ?? ''
  const verifier = form.get('code_verifier') ?? ''
  if (!code.startsWith(CODE_PREFIX)) return invalidGrant('Unknown authorization code')
  if (!PKCE_VALUE.test(verifier))
    return oauthError(400, 'invalid_request', 'code_verifier is required')
  const codeIndex = apiKeyIndex(payload.secret, code)
  // Claim the code atomically, so two exchanges cannot both succeed.
  const claimed = await sqlPool(payload).query(
    `UPDATE mcp_oauth_grants SET code_used = true, updated_at = now()
      WHERE code_index = $1 AND code_used IS NOT TRUE RETURNING id`,
    [codeIndex],
  )
  const revokeCode = () =>
    payload.delete({
      collection: OAUTH_GRANTS_SLUG,
      where: { codeIndex: { equals: codeIndex } },
      overrideAccess: true,
    })
  if (claimed.rows.length === 0) {
    // Unknown, or used before: whatever the first use issued is revoked (OAuth 2.1 4.1.3).
    await revokeCode()
    return invalidGrant('The authorization code is invalid or was already used')
  }
  const grant = (await payload.findByID({
    collection: OAUTH_GRANTS_SLUG,
    id: String(claimed.rows[0].id),
    depth: 0,
    overrideAccess: true,
    showHiddenFields: true,
  })) as unknown as GrantDoc
  const redirectUri = form.get('redirect_uri')
  const resource = form.get('resource')
  const problem =
    grant.clientId !== client.clientId
      ? 'The code was issued to another client'
      : !grant.codeExpiresAt || Date.parse(grant.codeExpiresAt) <= Date.now()
        ? 'The authorization code has expired'
        : redirectUri !== null && redirectUri !== grant.redirectUri
          ? 'redirect_uri does not match the authorization request'
          : resource !== null && !isThisResource(resource)
            ? 'The code was issued for another resource'
            : !grant.codeChallenge || !sameText(sha256(verifier), grant.codeChallenge)
              ? 'code_verifier does not match the code challenge'
              : null
  if (problem) {
    await revokeCode()
    return invalidGrant(problem)
  }
  if (!(await staffUser(payload, grant.user))) {
    await revokeCode()
    return invalidGrant('The person can no longer use reporting')
  }
  const access = newSecret(ACCESS_TOKEN_PREFIX)
  const refresh = newSecret(REFRESH_TOKEN_PREFIX)
  await payload.update({
    collection: OAUTH_GRANTS_SLUG,
    id: grant.id,
    data: {
      accessIndex: apiKeyIndex(payload.secret, access),
      accessExpiresAt: iso(ACCESS_TOKEN_TTL_S * 1000),
      refreshIndex: apiKeyIndex(payload.secret, refresh),
      refreshExpiresAt: iso(REFRESH_TOKEN_TTL_S * 1000),
      lastUsedAt: new Date().toISOString(),
    },
    overrideAccess: true,
  })
  return tokenResponse(access, refresh)
}

async function refreshTokens(
  payload: Payload,
  client: ClientDoc,
  form: URLSearchParams,
): Promise<OAuthResult> {
  const old = form.get('refresh_token') ?? ''
  if (!old.startsWith(REFRESH_TOKEN_PREFIX)) return invalidGrant('Unknown refresh token')
  const resource = form.get('resource')
  if (resource !== null && !isThisResource(resource)) {
    return oauthError(400, 'invalid_target', `Tokens are issued for ${mcpResourceUri()} only`)
  }
  const oldIndex = apiKeyIndex(payload.secret, old)
  const access = newSecret(ACCESS_TOKEN_PREFIX)
  const refresh = newSecret(REFRESH_TOKEN_PREFIX)
  // Rotate atomically: only one use of a refresh token can succeed.
  const rotated = await sqlPool(payload).query(
    `UPDATE mcp_oauth_grants
        SET refresh_index = $2, previous_refresh_index = $1, access_index = $3,
            access_expires_at = $4, refresh_expires_at = $5, last_used_at = now(), updated_at = now()
      WHERE refresh_index = $1 AND client_id = $6 AND refresh_expires_at > now()
      RETURNING id, user_id`,
    [
      oldIndex,
      apiKeyIndex(payload.secret, refresh),
      apiKeyIndex(payload.secret, access),
      iso(ACCESS_TOKEN_TTL_S * 1000),
      iso(REFRESH_TOKEN_TTL_S * 1000),
      client.clientId,
    ],
  )
  if (rotated.rows.length === 0) {
    // A token already rotated away is being replayed: someone else has a copy.
    await payload.delete({
      collection: OAUTH_GRANTS_SLUG,
      where: { previousRefreshIndex: { equals: oldIndex } },
      overrideAccess: true,
    })
    return invalidGrant('The refresh token is invalid, expired or was already used')
  }
  const { id, user_id: userId } = rotated.rows[0]
  if (!(await staffUser(payload, userId))) {
    await payload.delete({ collection: OAUTH_GRANTS_SLUG, id: String(id), overrideAccess: true })
    return invalidGrant('The person can no longer use reporting')
  }
  return tokenResponse(access, refresh)
}

/** `POST /api/oauth/token`: the authorization_code and refresh_token grants. */
export async function tokenRequest(
  payload: Payload,
  form: URLSearchParams,
  authorization: string | null,
): Promise<OAuthResult> {
  const auth = await authenticateClient(payload, form, authorization)
  if ('error' in auth) return auth.error
  const grantType = form.get('grant_type')
  if (grantType === 'authorization_code') return exchangeCode(payload, auth.client, form)
  if (grantType === 'refresh_token') return refreshTokens(payload, auth.client, form)
  return oauthError(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token')
}

/**
 * The person behind an access token, read fresh from the database, or null
 * if the token is unknown, expired, revoked or issued for another resource.
 * Role checks are the caller's.
 */
export async function verifyAccessToken(
  payload: Payload,
  accessToken: string,
): Promise<{ grantId: string; user: Record<string, unknown> } | null> {
  if (!accessToken.startsWith(ACCESS_TOKEN_PREFIX) || accessToken.length > 200) return null
  const { docs } = await payload.find({
    collection: OAUTH_GRANTS_SLUG,
    where: { accessIndex: { equals: apiKeyIndex(payload.secret, accessToken) } },
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
  })
  const grant = docs[0] as unknown as GrantDoc | undefined
  if (!grant?.accessExpiresAt || Date.parse(grant.accessExpiresAt) <= Date.now()) return null
  if (grant.resource !== mcpResourceUri()) return null
  const user = await payload.findByID({
    collection: 'users',
    id: grant.user,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
  })
  if (!user) return null
  if (!grant.lastUsedAt || Date.now() - Date.parse(grant.lastUsedAt) > 10 * 60_000) {
    try {
      await payload.update({
        collection: OAUTH_GRANTS_SLUG,
        id: grant.id,
        data: { lastUsedAt: new Date().toISOString() },
        overrideAccess: true,
      })
    } catch (error) {
      console.error('[mcp-oauth] could not record use of a connection:', error)
    }
  }
  return { grantId: grant.id, user: user as unknown as Record<string, unknown> }
}
