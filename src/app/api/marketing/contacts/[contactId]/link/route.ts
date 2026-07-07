/**
 * API Route: POST /api/marketing/contacts/[contactId]/link
 *
 * Manually link a marketing contact to a customer via
 * MarketingService.LinkContact — the matcher links automatically on
 * mobile/email; this covers the cases it can't. The customer_id comes from
 * the staff customer search picker, so it references a real customer row.
 * Re-linking an already-linked contact overwrites (the correction path).
 * Gated on `canMarketing`. Idempotency key is stable per (contact, customer)
 * so a double-click can't double-emit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing } from '@/lib/access'
import { LinkContactSchema } from '@/lib/schemas/marketing'
import { linkContact } from '@/server/marketing-grpc-client'

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

  const parsed = LinkContactSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid link payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  const { customer_id: customerId } = parsed.data

  try {
    const result = await linkContact({
      idempotencyKey: `link:${contactId}:${customerId}`,
      contactId,
      customerId,
      actor: String(user.id),
    })
    return NextResponse.json({ contactId, eventId: result.eventId }, { status: 202 })
  } catch (e) {
    console.error('[Marketing Link Contact] gRPC error:', e)
    return NextResponse.json(
      { error: { code: 'COMMAND_FAILED', message: 'Linking the contact failed. Please retry.' } },
      { status: 503 },
    )
  }
}
