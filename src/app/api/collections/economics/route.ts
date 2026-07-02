/**
 * API Route: POST /api/collections/economics
 *
 * Batch cost-of-recovery economics lookup, for the WS3 net-recovery sort
 * on the case list. Body: `{ accountIds: string[] }`, capped at 200 to
 * keep the gRPC batch RPC bounded.
 *
 * Same UNAVAILABLE (gRPC code 14) graceful-degrade contract as the other
 * collections reads: the UI gets a 200 with `unavailable: true` and an
 * empty `items` array instead of a hard failure.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { getCollectionsServiceClient } from '@/server/collections-service-client'

const Body = z.object({
  accountIds: z.array(z.string().min(1)).min(1).max(200),
})

function isUnavailable(err: any): boolean {
  return err?.code === 14 || (typeof err?.message === 'string' && err.message.includes('UNAVAILABLE'))
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid JSON' } },
      { status: 400 },
    )
  }

  const parsed = Body.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'invalid body', details: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    )
  }

  try {
    const items = await getCollectionsServiceClient().listCaseEconomics(parsed.data.accountIds)
    return NextResponse.json({ items })
  } catch (err: any) {
    if (isUnavailable(err)) return NextResponse.json({ items: [], unavailable: true })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'collections service error' } },
      { status: 502 },
    )
  }
}
