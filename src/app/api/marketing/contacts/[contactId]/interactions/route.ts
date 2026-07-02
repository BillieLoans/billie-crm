/**
 * API Route: POST /api/marketing/contacts/[contactId]/interactions
 *
 * Logs a staff-initiated interaction (a note, or an outbound/inbound
 * message record) via MarketingService.LogInteraction. Gated on
 * `canMarketing`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing } from '@/lib/access'
import { LogInteractionSchema } from '@/lib/schemas/marketing'
import { logInteraction } from '@/server/marketing-grpc-client'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const auth = await requireAuth(canMarketing)
  if ('error' in auth) return auth.error
  const { user } = auth
  const { contactId } = await params

  const parsed = LogInteractionSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid interaction payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  const data = parsed.data

  try {
    const result = await logInteraction({
      idempotencyKey: `interaction:${contactId}:${Date.now()}`,
      contactId,
      kind: data.kind,
      channel: data.channel,
      direction: data.direction,
      subject: data.subject,
      body: data.body,
      sourceSystem: data.source_system,
      occurredAt: data.occurred_at,
      metadataJson: data.metadata ? JSON.stringify(data.metadata) : undefined,
      actor: String(user.id),
    })
    return NextResponse.json({ contactId, eventId: result.eventId }, { status: 202 })
  } catch (e) {
    console.error('[Marketing Log Interaction] gRPC error:', e)
    return NextResponse.json(
      {
        error: { code: 'COMMAND_FAILED', message: 'Logging the interaction failed. Please retry.' },
      },
      { status: 503 },
    )
  }
}
