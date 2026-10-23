/**
 * OAuth authorization server metadata (RFC 8414) for the reporting MCP
 * connector, served at `/.well-known/oauth-authorization-server` through a
 * rewrite in next.config.mjs. See `src/server/reporting/mcp-oauth.ts`.
 */
import { NextResponse } from 'next/server'
import { authorizationServerMetadata } from '@/server/reporting/mcp-oauth'

export function GET() {
  return NextResponse.json(authorizationServerMetadata(), {
    headers: { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
  })
}
