/**
 * API Route: /api/marketing/contacts
 *
 * GET  — list contacts from the read-only `contacts` projection, filterable
 *        by stage/source/city and a free-text `q` across name/email/mobile.
 *        Gated on `canReadMarketing` (marketing role or admin, plus the
 *        existing servicing roles — see src/lib/access.ts).
 * POST — staff-initiated contact creation. Routes to the same
 *        MarketingService.UpsertContact RPC as the public waitlist intake
 *        route, but with `waitlist: false` (a staff-created contact is not
 *        automatically enqueued) and the acting staff user as `actor`.
 *        Gated on `canMarketing`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing, canReadMarketing } from '@/lib/access'
import { CreateContactSchema } from '@/lib/schemas/marketing'
import { upsertContact } from '@/server/marketing-grpc-client'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth

  const sp = request.nextUrl.searchParams
  // Merged-away duplicates never appear in the grid — their history lives on
  // the survivor.
  const where: Record<string, unknown> = { mergedInto: { exists: false } }
  if (sp.get('stage')) where.derivedStage = { equals: sp.get('stage') }
  if (sp.get('source')) where.source = { equals: sp.get('source') }
  if (sp.get('city')) where.city = { like: sp.get('city') }
  if (sp.get('batch')) where.batchId = { equals: sp.get('batch') }
  if (sp.get('needs_review') === 'true') where.needsReview = { equals: true }
  if (sp.get('advisory_council') === 'true') where.panelMember = { equals: true }
  // Win-back safety: former_customer alone mixes repaid (C-P) and written-off
  // (C-N) people — loan_status distinguishes them ("repaid" only for C-P).
  if (sp.get('loan_status')) where.loanStatus = { equals: sp.get('loan_status') }
  if (sp.get('q')) {
    where.or = [
      { firstName: { like: sp.get('q') } },
      { email: { like: sp.get('q') } },
      { mobileE164: { like: sp.get('q') } },
    ]
  }

  const result = await payload.find({
    collection: 'contacts',
    where: where as never,
    page: Number(sp.get('page') ?? 1),
    limit: 50,
    sort: '-updatedAt',
    overrideAccess: false,
    user,
  })

  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(canMarketing)
  if ('error' in auth) return auth.error
  const { user } = auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Body must be valid JSON' } },
      { status: 400 },
    )
  }

  const parsed = CreateContactSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid contact payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  const data = parsed.data
  const idempotencyKey = `create-contact:${data.mobile ?? data.email}:${Date.now()}`

  try {
    const result = await upsertContact({
      idempotencyKey,
      firstName: data.first_name,
      email: data.email,
      mobile: data.mobile,
      city: data.city,
      postcode: data.postcode,
      source: data.source,
      channelPreference: data.channel_preference,
      waitlist: false,
      actor: String(user.id),
    })
    return NextResponse.json(
      { contactId: result.contactId, eventId: result.eventId, created: result.created },
      { status: 202 },
    )
  } catch (e) {
    console.error('[Marketing Create Contact] gRPC error:', e)
    return NextResponse.json(
      { error: { code: 'COMMAND_FAILED', message: 'Contact creation failed. Please retry.' } },
      { status: 503 },
    )
  }
}
