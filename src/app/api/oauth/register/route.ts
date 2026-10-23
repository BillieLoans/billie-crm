/**
 * POST /api/oauth/register — dynamic client registration (RFC 7591) for the
 * reporting MCP connector. Registering grants nothing: a person still signs
 * in and approves each connection. See `src/server/reporting/mcp-oauth.ts`.
 */
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { checkRateLimit } from '@/lib/utils/rateLimit'
import { registerClient } from '@/server/reporting/mcp-oauth'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  const ip =
    request.headers.get('cf-connecting-ip') ?? request.headers.get('fly-client-ip') ?? 'unknown'
  if (!checkRateLimit(`oauth-register:${ip}`, { limit: 20, windowMs: 60 * 60_000 })) {
    return NextResponse.json(
      { error: 'slow_down', error_description: 'Too many registrations. Try again later.' },
      { status: 429, headers: NO_STORE },
    )
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_client_metadata', error_description: 'The body must be JSON' },
      { status: 400, headers: NO_STORE },
    )
  }
  try {
    const payload = await getPayload({ config: configPromise })
    const result = await registerClient(payload, body)
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
  } catch (error) {
    console.error('[mcp-oauth] registration failed:', error)
    return NextResponse.json(
      { error: 'server_error', error_description: 'Registration failed. Try again.' },
      { status: 500, headers: NO_STORE },
    )
  }
}
