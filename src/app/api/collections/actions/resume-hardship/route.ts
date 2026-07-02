/**
 * API Route: POST /api/collections/actions/resume-hardship
 *
 * Operator action — resumes a hardship-paused collections case. Synchronous
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
import type { User } from '@/payload-types'
import {
  getCollectionsServiceClient,
  isFailedPrecondition,
  isNotFound,
  isResourceExhausted,
} from '@/server/collections-service-client'

const Body = z.object({
  accountId: z.string().min(1),
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
    const result = await getCollectionsServiceClient().resumeFromHardship({
      accountId: parsed.data.accountId,
      operatorId,
      idempotencyKey: parsed.data.idempotencyKey,
    })
    return NextResponse.json({ result })
  } catch (err: any) {
    if (isNotFound(err))
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'unknown account' } }, { status: 404 })
    if (isFailedPrecondition(err))
      return NextResponse.json(
        { error: { code: 'FAILED_PRECONDITION', message: err?.details ?? 'precondition failed' } },
        { status: 409 },
      )
    if (isResourceExhausted(err))
      return NextResponse.json(
        { error: { code: 'CONTACT_CAP', message: err?.details ?? 'contact cap reached' } },
        { status: 429 },
      )
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'collections service error' } },
      { status: 502 },
    )
  }
}
