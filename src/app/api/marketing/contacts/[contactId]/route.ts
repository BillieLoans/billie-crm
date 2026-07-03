/**
 * API Route: /api/marketing/contacts/[contactId]
 *
 * GET   — single contact detail plus its interaction timeline and audit
 *         trail, all sourced from the read-only projections. Gated on
 *         `canReadMarketing`.
 * PATCH — staff-initiated field update via MarketingService.UpdateContact.
 *         Gated on `canMarketing`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing, canReadMarketing } from '@/lib/access'
import { UpdateContactSchema } from '@/lib/schemas/marketing'
import { updateContact } from '@/server/marketing-grpc-client'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth
  const { contactId } = await params

  const contactResult = await payload.find({
    collection: 'contacts',
    where: { contactId: { equals: contactId } },
    limit: 1,
    overrideAccess: false,
    user,
  })

  const contact = contactResult.docs[0]
  if (!contact) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
      { status: 404 },
    )
  }

  const [interactionsResult, auditResult] = await Promise.all([
    payload.find({
      collection: 'interactions',
      where: { contactIdString: { equals: contactId } },
      sort: '-occurredAt',
      limit: 100,
      overrideAccess: false,
      user,
    }),
    payload.find({
      collection: 'contact-audit-log',
      where: { contactIdString: { equals: contactId } },
      sort: '-occurredAt',
      limit: 100,
      overrideAccess: false,
      user,
    }),
  ])

  return NextResponse.json({
    contact,
    interactions: interactionsResult.docs,
    audit: auditResult.docs,
  })
}

export async function PATCH(
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

  const parsed = UpdateContactSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid contact update payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  const data = parsed.data

  try {
    const result = await updateContact({
      idempotencyKey: `update-contact:${contactId}:${Date.now()}`,
      contactId,
      firstName: data.first_name,
      email: data.email,
      mobile: data.mobile,
      city: data.city,
      postcode: data.postcode,
      channelPreference: data.channel_preference,
      attributesJson: data.attributes ? JSON.stringify(data.attributes) : undefined,
      actor: String(user.id),
    })
    return NextResponse.json({ contactId, eventId: result.eventId }, { status: 202 })
  } catch (e) {
    console.error('[Marketing Update Contact] gRPC error:', e)
    return NextResponse.json(
      { error: { code: 'COMMAND_FAILED', message: 'Contact update failed. Please retry.' } },
      { status: 503 },
    )
  }
}
