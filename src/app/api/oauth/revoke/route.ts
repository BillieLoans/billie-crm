/**
 * POST /api/oauth/revoke — token revocation (RFC 7009) for the reporting MCP
 * connector: a client hands back an access or refresh token and the
 * connection it belongs to ends. See `src/server/reporting/mcp-oauth.ts`.
 */
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { rateLimit } from '@/lib/utils/rateLimit'
import { revokeRequest } from '@/server/reporting/mcp-oauth'

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }

export async function POST(request: Request) {
  const ip =
    request.headers.get('cf-connecting-ip') ?? request.headers.get('fly-client-ip') ?? 'unknown'
  if (!(await rateLimit(`oauth-revoke:${ip}`, { limit: 60, windowMs: 60_000 }))) {
    return NextResponse.json(
      { error: 'slow_down', error_description: 'Too many requests. Try again in a minute.' },
      { status: 429, headers: NO_STORE },
    )
  }
  if (!(request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Send application/x-www-form-urlencoded' },
      { status: 400, headers: NO_STORE },
    )
  }
  try {
    const form = new URLSearchParams(await request.text())
    const payload = await getPayload({ config: configPromise })
    const result = await revokeRequest(payload, form, request.headers.get('authorization'))
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { ...NO_STORE, ...result.headers },
    })
  } catch (error) {
    console.error('[mcp-oauth] revocation failed:', error)
    return NextResponse.json(
      { error: 'server_error', error_description: 'The request failed. Try again.' },
      { status: 500, headers: NO_STORE },
    )
  }
}
