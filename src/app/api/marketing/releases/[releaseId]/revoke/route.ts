/** POST /api/marketing/releases/[releaseId]/revoke — kill remaining grants. */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing } from '@/lib/access'
import { RevokeReleaseCommandSchema } from '@/lib/schemas/releases'
import { publishReleaseCommand } from '@/server/release-publisher'
import { EVENT_TYPE_APPLICANT_RELEASE_REVOKED } from '@/lib/events/config'
import { EventPublishError } from '@/server/event-publisher'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ releaseId: string }> },
) {
  try {
    const auth = await requireAuth(canMarketing)
    if ('error' in auth) return auth.error
    const { user } = auth
    const { releaseId } = await params

    const body = await request.json().catch(() => ({}))
    const parsed = RevokeReleaseCommandSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid revoke payload' } },
        { status: 400 },
      )
    }

    const { eventId } = await publishReleaseCommand({
      typ: EVENT_TYPE_APPLICANT_RELEASE_REVOKED,
      conv: `applicant-release:${releaseId}`,
      usr: String(user.id),
      payload: {
        release_id: releaseId,
        revoked_by: String(user.id),
        reason: parsed.data.reason,
      },
    })
    return NextResponse.json({ releaseId, eventId }, { status: 202 })
  } catch (error) {
    console.error('[Release Revoke] Error:', error)
    if (error instanceof EventPublishError) {
      return NextResponse.json(
        { error: { code: 'EVENT_PUBLISH_FAILED', message: 'Failed to publish the revoke.' } },
        { status: 503 },
      )
    }
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
      { status: 500 },
    )
  }
}
