/**
 * API Route: POST /api/intake/waitlist
 *
 * Public, unauthenticated-by-session intake endpoint for the marketing
 * site's waitlist form. Callers authenticate via a shared API key + HMAC
 * body signature (see @/lib/intake-auth) rather than a Payload session.
 *
 * gRPC-primary, chatLedger-fallback: the write goes straight to the platform's
 * MarketingService.UpsertContact over gRPC. If that fails for any reason
 * (network blip, deploy, deadline exceeded), the request is never dropped —
 * it's published as a `contact.intake.requested.v1` command onto `chatLedger`,
 * and billieChat's Broker routes it to the marketingService inbox (which
 * consumes it via `_handle_intake_command` / `build_contact_observed`). Both
 * paths carry the same idempotency_key, so a client retry (or the queued
 * command being processed later) can never create a duplicate contact.
 */

import { NextRequest, NextResponse } from 'next/server'
import { WaitlistIntakeSchema, type WaitlistIntake } from '@/lib/schemas/intake'
import { verifyIntakeAuth } from '@/lib/intake-auth'
import { upsertContact } from '@/server/marketing-grpc-client'
import { publishContactIntakeRequested } from '@/server/chatledger-publisher'
import type { ContactIntakeCommandPayload } from '@/lib/events/types'

/**
 * Build the snake_case command payload for the Redis fallback. Keys
 * deliberately match the platform's `_handle_intake_command` /
 * `build_contact_observed` cmd dict — do not rename without updating that
 * consumer in lockstep.
 */
function intakeToCommandPayload(
  intake: WaitlistIntake,
  idempotencyKey: string,
): ContactIntakeCommandPayload {
  return {
    idempotency_key: idempotencyKey,
    // Optional fields are normalised to null rather than left undefined:
    // JSON.stringify drops undefined-valued keys entirely, which would
    // silently strip them from the command the platform consumes.
    first_name: intake.first_name ?? null,
    email: intake.email ?? null,
    mobile: intake.mobile ?? null,
    city: intake.city ?? null,
    postcode: intake.postcode ?? null,
    source: intake.source,
    utm: intake.utm ?? {},
    platforms: intake.platforms ?? [],
    channel_preference: intake.channel_preference ?? null,
    referred_by_code: intake.ref ?? null,
    waitlist: true,
    consent: intake.consent,
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

  const parsed = WaitlistIntakeSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid intake payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  const intake = parsed.data
  const idempotencyKey = intake.idempotency_key ?? `intake:${intake.mobile ?? intake.email}`

  try {
    const result = await upsertContact({
      idempotencyKey,
      firstName: intake.first_name,
      email: intake.email,
      mobile: intake.mobile,
      city: intake.city,
      postcode: intake.postcode,
      source: intake.source,
      utmJson: JSON.stringify(intake.utm ?? {}),
      platforms: intake.platforms ?? [],
      channelPreference: intake.channel_preference,
      referredByCode: intake.ref,
      waitlist: true,
      consent: intake.consent,
      actor: 'intake',
    })
    return NextResponse.json({ status: 'accepted', contactId: result.contactId }, { status: 200 })
  } catch (grpcError) {
    // Never lose a signup: durable fallback publishing the intake command onto
    // chatLedger, which the Broker routes to the marketingService inbox.
    console.warn(
      '[Intake] gRPC failed, publishing to chatLedger fallback:',
      grpcError instanceof Error ? grpcError.message : grpcError,
    )
    try {
      await publishContactIntakeRequested(intakeToCommandPayload(intake, idempotencyKey))
      return NextResponse.json({ status: 'queued' }, { status: 200 })
    } catch (publishError) {
      console.error(
        '[Intake] BOTH paths failed — signup at risk:',
        publishError instanceof Error ? publishError.message : publishError,
      )
      return NextResponse.json(
        { error: { code: 'INTAKE_UNAVAILABLE', message: 'Please retry' } },
        { status: 503 },
      )
    }
  }
}
