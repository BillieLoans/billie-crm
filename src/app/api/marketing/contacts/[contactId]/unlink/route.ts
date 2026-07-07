/**
 * API Route: POST /api/marketing/contacts/[contactId]/unlink
 *
 * Remove a contact's customer link via MarketingService.UnlinkContact
 * (reason="manual"). The platform rejects unlinking an unlinked contact
 * (FAILED_PRECONDITION → surfaced as COMMAND_FAILED). Gated on
 * `canMarketing`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing } from '@/lib/access'
import { unlinkContact } from '@/server/marketing-grpc-client'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const auth = await requireAuth(canMarketing)
  if ('error' in auth) return auth.error
  const { user } = auth
  const { contactId } = await params

  try {
    const result = await unlinkContact({
      idempotencyKey: `unlink:${contactId}`,
      contactId,
      actor: String(user.id),
    })
    return NextResponse.json({ contactId, eventId: result.eventId }, { status: 202 })
  } catch (e) {
    console.error('[Marketing Unlink Contact] gRPC error:', e)
    return NextResponse.json(
      {
        error: { code: 'COMMAND_FAILED', message: 'Unlinking the contact failed. Please retry.' },
      },
      { status: 503 },
    )
  }
}
