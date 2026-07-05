/**
 * API Route: POST /api/webhooks/clicksend
 *
 * ClickSend inbound-SMS webhook. Accept-and-enqueue: verify a shared secret,
 * publish the raw inbound onto the CRM internal stream, and return 200 fast.
 * The Python event-processor consumes `clicksend.inbound.received.v1`
 * asynchronously — resolving the sender to a contact and issuing a
 * marketingService LogInteraction (kind=message_in) — so the request path does
 * no gRPC/DB work and ClickSend gets a prompt ack.
 *
 * Auth: shared secret compared in constant time. ClickSend inbound rules only
 * let you configure a URL, so the secret is accepted as either an `x-webhook-secret`
 * header OR a `?secret=` query param. Fail-closed: a missing/blank env secret
 * rejects every request.
 *
 * Body: ClickSend's default delivery is form-urlencoded; the optional JSON mode
 * sends a JSON body. Both are handled by Content-Type.
 */

import { NextRequest, NextResponse } from 'next/server'
import { safeEqual } from '@/lib/intake-auth'
import { ClickSendInboundSchema } from '@/lib/schemas/clicksend'
import { createAndPublishEvent } from '@/server/event-publisher'
import { EVENT_TYPE_CLICKSEND_INBOUND_RECEIVED } from '@/lib/events/config'

function authorised(request: NextRequest): boolean {
  const expected = process.env.CLICKSEND_WEBHOOK_SECRET
  if (!expected) return false // fail-closed
  const querySecret = new URL(request.url).searchParams.get('secret')
  const provided = request.headers.get('x-webhook-secret') ?? querySecret ?? ''
  return safeEqual(provided, expected)
}

function parseBody(rawBody: string, contentType: string | null): unknown {
  if (contentType && contentType.includes('application/json')) {
    return JSON.parse(rawBody)
  }
  // ClickSend default: application/x-www-form-urlencoded
  return Object.fromEntries(new URLSearchParams(rawBody))
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Invalid webhook credentials' } },
      { status: 401 },
    )
  }

  const rawBody = await request.text()

  let parsedBody: unknown
  try {
    parsedBody = parseBody(rawBody, request.headers.get('content-type'))
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Unparseable body' } },
      { status: 400 },
    )
  }

  const parsed = ClickSendInboundSchema.safeParse(parsedBody)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid inbound payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  try {
    await createAndPublishEvent({
      typ: EVENT_TYPE_CLICKSEND_INBOUND_RECEIVED,
      userId: 'clicksend',
      payload: parsed.data,
    })
    // Prompt ack — processing happens async off the CRM internal stream.
    return NextResponse.json({ status: 'accepted' }, { status: 200 })
  } catch (e) {
    // Enqueue failed — 503 so ClickSend retries the inbound.
    console.error('[ClickSend Webhook] enqueue failed:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: { code: 'WEBHOOK_UNAVAILABLE', message: 'Please retry' } },
      { status: 503 },
    )
  }
}
