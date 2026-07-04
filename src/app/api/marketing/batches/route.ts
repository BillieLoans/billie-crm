/**
 * API Route: /api/marketing/batches
 *
 * GET  — list batches from the read-only `batches` projection. Gated on
 *        `canReadMarketing`.
 * POST — create a marketing batch via MarketingService.CreateBatch. The
 *        `criteria` object is the segment snapshot the batch was built from.
 *        Gated on `canMarketing`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing, canReadMarketing } from '@/lib/access'
import { CreateBatchSchema } from '@/lib/schemas/marketing'
import { createBatch } from '@/server/marketing-grpc-client'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth

  const sp = request.nextUrl.searchParams
  const result = await payload.find({
    collection: 'batches',
    page: Number(sp.get('page') ?? 1),
    limit: 50,
    sort: '-batchCreatedAt',
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

  const parsed = CreateBatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid batch payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  const data = parsed.data

  try {
    const result = await createBatch({
      idempotencyKey: `batch:${Date.now()}`,
      name: data.name,
      criteriaJson: JSON.stringify(data.criteria ?? {}),
      actor: String(user.id),
    })
    return NextResponse.json({ batchId: result.batchId, eventId: result.eventId }, { status: 202 })
  } catch (e) {
    console.error('[Marketing Create Batch] gRPC error:', e)
    return NextResponse.json(
      { error: { code: 'COMMAND_FAILED', message: 'Creating the batch failed. Please retry.' } },
      { status: 503 },
    )
  }
}
