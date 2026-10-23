/**
 * POST /api/oauth/token — the token endpoint of the reporting MCP connector:
 * authorization code (with PKCE) and refresh token grants. See
 * `src/server/reporting/mcp-oauth.ts`.
 */
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { tokenRequest } from '@/server/reporting/mcp-oauth'

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }

export async function POST(request: Request) {
  if (!(request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Send application/x-www-form-urlencoded' },
      { status: 400, headers: NO_STORE },
    )
  }
  try {
    const form = new URLSearchParams(await request.text())
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
