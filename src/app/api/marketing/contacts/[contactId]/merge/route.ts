/**
 * API Route: POST /api/marketing/contacts/[contactId]/merge
 *
 * Resolve a duplicate: merge another contact record INTO this one (the URL
 * contact is the survivor). The platform validates both records and emits
 * contact.merged.v1; projections re-attach history and tombstone the
 * duplicate. Irreversible — the UI requires typed confirmation. Gated on
 * `canMarketing` like the other identity-shaping commands (link/unlink).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { canMarketing } from '@/lib/access'
import { mergeContact } from '@/server/marketing-grpc-client'

const MergeSchema = z.object({
  merged_contact_id: z.string().min(1),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const auth = await requireAuth(canMarketing)
  if ('error' in auth) return auth.error
  const { user } = auth
  const { contactId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Body must be valid JSON' } },
      { status: 400 },
    )
  }
  const parsed = MergeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'merged_contact_id is required' } },
      { status: 400 },
    )
  }
  if (parsed.data.merged_contact_id === contactId) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Cannot merge a contact into itself' } },
      { status: 400 },
    )
  }

  try {
    const result = await mergeContact({
      idempotencyKey: `merge:${contactId}:${parsed.data.merged_contact_id}`,
      survivorContactId: contactId,
      mergedContactId: parsed.data.merged_contact_id,
      actor: String(user.id),
    })
    return NextResponse.json(
      { survivorContactId: contactId, eventId: result.eventId },
      { status: 202 },
    )
  } catch (e) {
    console.error('[Marketing Merge Contact] gRPC error:', e)
    return NextResponse.json(
      { error: { code: 'COMMAND_FAILED', message: 'Merge failed. Please retry.' } },
      { status: 503 },
    )
  }
}
