/**
 * API Route: POST /api/intake/feedback
 *
 * Public, unauthenticated-by-session intake endpoint for the marketing site's
 * feedback form. Callers authenticate via a shared API key + HMAC body
 * signature (see @/lib/intake-auth), the same posture as the waitlist intake.
 *
 * gRPC-primary, chatLedger-fallback: the write goes straight to the platform's
 * MarketingService.SubmitFeedback over gRPC. If that fails for any reason, the
 * feedback is never dropped — it's published as a `feedback.submit.requested.v1`
 * command onto `chatLedger`, and billieChat's Broker routes it to the
 * marketingService inbox. Both paths carry the same idempotency_key, so a
 * client retry (or the queued command being processed later) can't duplicate
 * feedback.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { FeedbackIntakeSchema, type FeedbackIntake } from '@/lib/schemas/intake'
import { verifyIntakeAuth } from '@/lib/intake-auth'
import { submitFeedback } from '@/server/marketing-grpc-client'
import { publishFeedbackSubmitted } from '@/server/chatledger-publisher'
import type { FeedbackSubmitCommandPayload } from '@/lib/events/types'

/**
 * Build the snake_case command payload for the chatLedger fallback. Keys mirror
 * the platform's SubmitFeedback request; optional fields are normalised to null
 * (JSON.stringify drops undefined-valued keys, silently stripping them).
 */
function feedbackToCommandPayload(
  intake: FeedbackIntake,
  idempotencyKey: string,
): FeedbackSubmitCommandPayload {
  return {
    idempotency_key: idempotencyKey,
    contact_id: intake.contact_id,
    customer_id: intake.customer_id ?? null,
    type: intake.type,
    severity: intake.severity ?? null,
    text: intake.text,
    product_area: intake.product_area ?? null,
    actor: 'intake',
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  if (!verifyIntakeAuth(request, rawBody)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Invalid intake credentials' } },
      { status: 401 },
    )
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Body must be JSON' } },
      { status: 400 },
    )
  }

  const parsed = FeedbackIntakeSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid feedback payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  const intake = parsed.data
  // Stable idempotency key: client-supplied, else derived from the contact and a
  // hash of the text so a double-submit of the same feedback is deduped, while
  // genuinely different feedback from the same contact is not.
  const idempotencyKey =
    intake.idempotency_key ??
    `feedback:${intake.contact_id}:${createHash('sha256').update(intake.text).digest('hex').slice(0, 16)}`

  try {
    const result = await submitFeedback({
      idempotencyKey,
      contactId: intake.contact_id,
      customerId: intake.customer_id,
      type: intake.type,
      severity: intake.severity,
      text: intake.text,
      productArea: intake.product_area,
      actor: 'intake',
    })
    return NextResponse.json({ status: 'accepted', feedbackId: result.feedbackId }, { status: 200 })
  } catch (grpcError) {
    // Never lose feedback: durable fallback publishing the command onto
    // chatLedger, which the Broker routes to the marketingService inbox.
    console.warn(
      '[FeedbackIntake] gRPC failed, publishing to chatLedger fallback:',
      grpcError instanceof Error ? grpcError.message : grpcError,
    )
    try {
      await publishFeedbackSubmitted(feedbackToCommandPayload(intake, idempotencyKey))
      return NextResponse.json({ status: 'queued' }, { status: 200 })
    } catch (publishError) {
      console.error(
        '[FeedbackIntake] BOTH paths failed — feedback at risk:',
        publishError instanceof Error ? publishError.message : publishError,
      )
      return NextResponse.json(
        { error: { code: 'INTAKE_UNAVAILABLE', message: 'Please retry' } },
        { status: 503 },
      )
    }
  }
}
