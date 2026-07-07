/**
 * API Route: POST /api/marketing/batches/[batchId]/invite
 *
 * Trigger invitations for a batch via MarketingService.TriggerBatchInvitations
 * — the platform emits a notification-dispatch command per consented member and
 * skips members without marketing consent. Gated on `canMarketing`.
 *
 * The idempotency key is stable per batch (`invite:{batchId}`) so a double-click
 * can't fan out a second wave of invites.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing } from '@/lib/access'
import { triggerBatchInvitations } from '@/server/marketing-grpc-client'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireAuth(canMarketing)
  if ('error' in auth) return auth.error
  const { user } = auth
  const { batchId } = await params

  try {
    const result = await triggerBatchInvitations({
      idempotencyKey: `invite:${batchId}`,
      batchId,
      actor: String(user.id),
    })
    return NextResponse.json(
      {
        batchId,
        invitedCount: result.invitedCount,
        skippedUnconsented: result.skippedUnconsented,
        skippedNeedsReview: (result as { skippedNeedsReview?: number }).skippedNeedsReview ?? 0,
      },
      { status: 202 },
    )
  } catch (e) {
    console.error('[Marketing Trigger Invitations] gRPC error:', e)
    return NextResponse.json(
      {
        error: {
          code: 'COMMAND_FAILED',
          message: 'Triggering batch invitations failed. Please retry.',
        },
      },
      { status: 503 },
    )
  }
}
