/**
 * API Route: POST /api/collections/actions/flag-hardship
 *
 * Operator action — flags a collections case as hardship-paused. Synchronous
 * gRPC command against the headless collections engine (BTB-198 WS5); the
 * engine applies the FSM transition, emits `collection.case.*` to
 * ChatLedger, and returns a verdict.
 *
 * Error mapping: NOT_FOUND → 404, FAILED_PRECONDITION → 409 (gate/state
 * reason surfaced via `err.details`), RESOURCE_EXHAUSTED → 429 (contact
 * cap), anything else → 502.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { mapCollectionsActionError } from '@/lib/collections/action-error'
import type { User } from '@/payload-types'
import { getCollectionsServiceClient } from '@/server/collections-service-client'

const Body = z.object({
  accountId: z.string().min(1),
  reason: z.string().min(1),
  idempotencyKey: z.string().min(8),
})

function agentIdentifier(user: User): string {
  return `agent:${user.email ?? user.id}`
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(canService)
  if ('error' in auth) return auth.error
  const { user } = auth

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

  const operatorId = agentIdentifier(user)

  try {
    const result = await getCollectionsServiceClient().flagHardship({
      accountId: parsed.data.accountId,
      operatorId,
      reason: parsed.data.reason,
      idempotencyKey: parsed.data.idempotencyKey,
    })
    return NextResponse.json({ result })
  } catch (err: unknown) {
    return mapCollectionsActionError(err)
  }
}
