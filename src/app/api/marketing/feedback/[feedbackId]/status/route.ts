/**
 * API Route: POST /api/marketing/feedback/[feedbackId]/status
 *
 * Advance a feedback item's queue status (new → acknowledged → resolved) via
 * MarketingService.SetFeedbackStatus. Gated on `canMarketing`. The idempotency
 * key is stable per (feedback, status) so re-setting the same status is a no-op.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing } from '@/lib/access'
import { SetFeedbackStatusSchema } from '@/lib/schemas/marketing'
import { setFeedbackStatus } from '@/server/marketing-grpc-client'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ feedbackId: string }> },
) {
  const auth = await requireAuth(canMarketing)
  if ('error' in auth) return auth.error
  const { user } = auth
  const { feedbackId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Body must be valid JSON' } },
      { status: 400 },
    )
  }

  const parsed = SetFeedbackStatusSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid status payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  const { status, note } = parsed.data

  try {
    const result = await setFeedbackStatus({
      idempotencyKey: `feedback-status:${feedbackId}:${status}`,
      feedbackId,
      status,
      note: note?.trim() || undefined,
      actor: String(user.id),
    })
    return NextResponse.json(
      { feedbackId, status: result.status, eventId: result.eventId },
      { status: 202 },
    )
  } catch (e) {
    console.error('[Marketing Set Feedback Status] gRPC error:', e)
    return NextResponse.json(
      {
        error: {
          code: 'COMMAND_FAILED',
          message: 'Updating feedback status failed. Please retry.',
        },
      },
      { status: 503 },
    )
  }
}
