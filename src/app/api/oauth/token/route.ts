/**
 * POST /api/oauth/token — the token endpoint of the reporting MCP connector:
 * authorization code (with PKCE) and refresh token grants. See
 * `src/server/reporting/mcp-oauth.ts`.
 *
 * Rate-limited per source address and per client id. Tokens and codes are
 * 256-bit random, so the limit is about load, not guessing.
 */
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { rateLimit } from '@/lib/utils/rateLimit'
import { tokenRequest } from '@/server/reporting/mcp-oauth'

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }

const tooMany = () =>
  NextResponse.json(
    { error: 'slow_down', error_description: 'Too many token requests. Try again in a minute.' },
    { status: 429, headers: NO_STORE },
  )

export async function POST(request: Request) {
  if (!(request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Send application/x-www-form-urlencoded' },
      { status: 400, headers: NO_STORE },
    )
  }
  const ip =
    request.headers.get('cf-connecting-ip') ?? request.headers.get('fly-client-ip') ?? 'unknown'
  if (!(await rateLimit(`oauth-token:ip:${ip}`, { limit: 120, windowMs: 60_000 }))) {
    return tooMany()
  }
  try {
    const form = new URLSearchParams(await request.text())
    const clientId = form.get('client_id')
    if (
      clientId &&
      clientId.length <= 100 &&
      !(await rateLimit(`oauth-token:client:${clientId}`, { limit: 300, windowMs: 60_000 }))
    ) {
      return tooMany()
    }
    const payload = await getPayload({ config: configPromise })
    const result = await tokenRequest(payload, form, request.headers.get('authorization'))
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { ...NO_STORE, ...result.headers },
    })
  } catch (error) {
    console.error('[mcp-oauth] token request failed:', error)
    return NextResponse.json(
      { error: 'server_error', error_description: 'The token request failed. Try again.' },
      { status: 500, headers: NO_STORE },
    )
  }
}
