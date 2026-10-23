/**
 * OAuth protected resource metadata (RFC 9728) for the reporting MCP
 * connector, served at `/.well-known/oauth-protected-resource[/api/mcp]`
 * through a rewrite in next.config.mjs. See `src/server/reporting/mcp-oauth.ts`.
 */
import { NextResponse } from 'next/server'
import { protectedResourceMetadata } from '@/server/reporting/mcp-oauth'

export function GET() {
  return NextResponse.json(protectedResourceMetadata(), {
    headers: { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
  })
}
