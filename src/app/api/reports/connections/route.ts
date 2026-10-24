/**
 * GET /api/reports/connections — the signed-in person's own MCP connections
 * (Claude apps they approved on the CRM's sign-in page): the app, where it
 * sends them back to, when it was approved and last used, and when it ends.
 * Only ever their own; admins see everyone's under Reporting, MCP
 * connections.
 */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { errorResponse } from '@/server/reporting/route-auth'
import { listOwnConnections } from '@/server/reporting/mcp-oauth'

export async function GET() {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  try {
    return NextResponse.json({
      connections: await listOwnConnections(auth.payload, String(auth.user.id)),
    })
  } catch (error) {
    console.error('[reports] could not list connections:', error)
    return errorResponse(500, 'LIST_FAILED', 'Your connected apps could not be loaded. Try again.')
  }
}
