/**
 * GET  /api/marketing/releases — projection list (+ derived expired status)
 * POST /api/marketing/releases — the release command (spec §5): resolve
 * targets NOW, dual-publish applicant_release.released.v1, 202.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing, canReadMarketing } from '@/lib/access'
import { CreateReleaseCommandSchema } from '@/lib/schemas/releases'
import { computeReleasePartition } from '@/lib/releases'
import { publishReleaseCommand } from '@/server/release-publisher'
import { EVENT_TYPE_APPLICANT_RELEASE_RELEASED } from '@/lib/events/config'
import type { ApplicantReleaseReleasedPayload } from '@/lib/events/types'
import { EventPublishError } from '@/server/event-publisher'
import { logInteraction } from '@/server/marketing-grpc-client'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth

  const sp = request.nextUrl.searchParams
  const result = await payload.find({
    collection: 'release-batches',
    page: Number(sp.get('page') ?? 1),
    limit: 50,
    sort: '-releasedAt',
    overrideAccess: false,
    user,
  })
  const now = Date.now()
  const docs = result.docs.map((doc) => {
    const d = doc as { status?: string | null; expiresAt?: string | null }
    const derivedStatus =
      d.status === 'active' && d.expiresAt && Date.parse(d.expiresAt) < now ? 'expired' : d.status
    return { ...doc, derivedStatus }
  })
  return NextResponse.json({ ...result, docs })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canMarketing)
    if ('error' in auth) return auth.error
    const { payload, user } = auth

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Body must be valid JSON' } },
        { status: 400 },
      )
    }
    const parsed = CreateReleaseCommandSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid release payload',
            details: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      )
    }
    const command = parsed.data

    const partition = await computeReleasePartition({ payload, user, command })
    const { candidates, counts } = partition
    if (partition.truncated) {
      return NextResponse.json(
        {
          error: {
            code: 'PARTITION_TRUNCATED',
            message:
              'Audience data was truncated — narrow the release or raise the caps before releasing.',
          },
        },
        { status: 422 },
      )
    }
    const granted = candidates.filter(
      (c) => c.bucket === 'granted_sms' || c.bucket === 'granted_no_sms',
    )

    const expiresAt = new Date(Date.now() + command.expiryDays * 86_400_000).toISOString()
    const eventPayload: ApplicantReleaseReleasedPayload & { skipped: Record<string, number> } = {
      release_id: command.releaseId,
      name: command.name,
      type: command.type,
      expires_at: expiresAt,
      send_invite_sms: command.sendInviteSms,
      grants: granted.map((c) => ({
        mobile_e164: c.mobileE164,
        contact_id: c.contactId,
        send_sms: c.sendSms,
      })),
      quota_count: command.type === 'open_quota' ? (command.count ?? 0) : null,
      released_by: String(user.id),
      skipped: {
        already_customer: counts.skipped_already_customer,
        already_released: counts.skipped_already_released,
        needs_review: counts.skipped_needs_review,
        invalid_number: counts.skipped_invalid_number,
      },
    }

    const { eventId } = await publishReleaseCommand({
      typ: EVENT_TYPE_APPLICANT_RELEASE_RELEASED,
      conv: `applicant-release:${command.releaseId}`,
      usr: String(user.id),
      payload: eventPayload,
    })

    // Timeline visibility on matched contacts — best-effort, never blocks the 202.
    for (const c of granted) {
      if (!c.contactId) continue
      logInteraction({
        idempotencyKey: `release:${command.releaseId}:${c.contactId}`,
        contactId: c.contactId,
        kind: 'released_to_apply',
        sourceSystem: 'billie-crm',
        actor: String(user.id),
        metadataJson: JSON.stringify({ release_id: command.releaseId, name: command.name }),
      }).catch(() => {})
    }

    return NextResponse.json({ releaseId: command.releaseId, eventId }, { status: 202 })
  } catch (error) {
    console.error('[Release] Error:', error)
    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'Failed to publish the release. Please try again.',
          },
        },
        { status: 503 },
      )
    }
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
      { status: 500 },
    )
  }
}
