/**
 * POST /api/marketing/releases/preflight — the partition staff confirm before
 * releasing. POST (not GET) because phone_list bodies carry up to 1,000
 * numbers. Read-gated: it's a computation, not a command.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canReadMarketing } from '@/lib/access'
import { CreateReleaseCommandSchema } from '@/lib/schemas/releases'
import { computeReleasePartition } from '@/lib/releases'

export async function POST(request: NextRequest) {
  const auth = await requireAuth(canReadMarketing)
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

  const { counts, candidates, truncated } = await computeReleasePartition({
    payload,
    user,
    command: parsed.data,
  })
  return NextResponse.json({
    counts,
    total: candidates.length,
    ...(truncated ? { truncated } : {}),
  })
}
