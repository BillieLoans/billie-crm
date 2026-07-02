/**
 * API Route: POST /api/marketing/contacts/[contactId]/erase
 *
 * Privacy-erasure of a contact via MarketingService.EraseContact. This is
 * an irreversible, admin-only action — deliberately gated on `isAdmin`
 * rather than `canMarketing`, unlike the other command routes in this
 * directory.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { isAdmin } from '@/lib/access'
import { eraseContact } from '@/server/marketing-grpc-client'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const auth = await requireAuth(isAdmin)
  if ('error' in auth) return auth.error
  const { user } = auth
  const { contactId } = await params

  try {
    const result = await eraseContact({
      idempotencyKey: `erase:${contactId}:${Date.now()}`,
      contactId,
      actor: String(user.id),
    })
    return NextResponse.json({ contactId, eventId: result.eventId }, { status: 202 })
  } catch (e) {
    console.error('[Marketing Erase Contact] gRPC error:', e)
    return NextResponse.json(
      { error: { code: 'COMMAND_FAILED', message: 'Erasure failed. Please retry.' } },
      { status: 503 },
    )
  }
}
