/**
 * API Route: POST /api/marketing/batches/[batchId]/assign
 *
 * Assign a filtered CRM segment (a list of contact_ids) to a batch via
 * MarketingService.AssignBatch. Gated on `canMarketing`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing } from '@/lib/access'
import { AssignBatchSchema } from '@/lib/schemas/marketing'
import { assignBatch } from '@/server/marketing-grpc-client'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireAuth(canMarketing)
  if ('error' in auth) return auth.error
  const { user } = auth
  const { batchId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Body must be valid JSON' } },
      { status: 400 },
    )
  }

  const parsed = AssignBatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid assign payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  try {
    const result = await assignBatch({
      // Stable per (batch, member-set) so a retry/double-click can't
      // double-fire — matching the sibling command routes.
      idempotencyKey: `assign:${batchId}:${[...parsed.data.contact_ids].sort().join(',').slice(0, 64)}:${parsed.data.contact_ids.length}`,
      batchId,
      contactIds: parsed.data.contact_ids,
      actor: String(user.id),
    })
    return NextResponse.json(
      { batchId, assignedCount: result.assignedCount, eventId: result.eventId },
      { status: 202 },
    )
  } catch (e) {
    console.error('[Marketing Assign Batch] gRPC error:', e)
    return NextResponse.json(
      { error: { code: 'COMMAND_FAILED', message: 'Assigning the batch failed. Please retry.' } },
      { status: 503 },
    )
  }
}
