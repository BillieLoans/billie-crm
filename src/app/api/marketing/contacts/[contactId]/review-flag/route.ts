/**
 * API Route: POST /api/marketing/contacts/[contactId]/review-flag
 *
 * Set or clear a contact's needs-review flag (A2 sign-off decision). The flag
 * is a contact ATTRIBUTE (the model's D16 mechanism, like advocate) set via
 * MarketingService.UpdateContact — while set, the platform skips the contact
 * in every invitation send and the grid can filter on it. Audited via the
 * contact.updated.v1 event trail. Gated on `canMarketing`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { canMarketing } from '@/lib/access'
import { updateContact } from '@/server/marketing-grpc-client'

const ReviewFlagSchema = z.object({
  needs_review: z.boolean(),
  reason: z.string().max(500).optional(),
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

  const parsed = ReviewFlagSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid review-flag payload' } },
      { status: 400 },
    )
  }

  const { needs_review: needsReview, reason } = parsed.data

  try {
    const result = await updateContact({
      idempotencyKey: `review-flag:${contactId}:${needsReview}`,
      contactId,
      attributesJson: JSON.stringify({
        needs_review: needsReview,
        needs_review_reason: needsReview ? (reason?.trim() ?? null) : null,
      }),
      actor: String(user.id),
    })
    return NextResponse.json({ contactId, eventId: result.eventId }, { status: 202 })
  } catch (e) {
    console.error('[Marketing Review Flag] gRPC error:', e)
    return NextResponse.json(
      {
        error: {
          code: 'COMMAND_FAILED',
          message: 'Updating the review flag failed. Please retry.',
        },
      },
      { status: 503 },
    )
  }
}
