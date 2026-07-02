/**
 * API Route: POST /api/marketing/contacts/[contactId]/consent
 *
 * Records a staff-captured consent decision (e.g. verbal consent given or
 * withdrawn during a phone call) via MarketingService.SetConsent. Gated on
 * `canMarketing`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing } from '@/lib/access'
import { SetConsentSchema } from '@/lib/schemas/marketing'
import { setConsent } from '@/server/marketing-grpc-client'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const auth = await requireAuth(canMarketing)
  if ('error' in auth) return auth.error
  const { user } = auth
  const { contactId } = await params

  const parsed = SetConsentSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid consent payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  try {
    const result = await setConsent({
      idempotencyKey: `consent:${contactId}:${Date.now()}`,
      contactId,
      granted: parsed.data.granted,
      channels: parsed.data.channels,
      method: parsed.data.method,
      evidence: parsed.data.evidence ?? '',
      actor: String(user.id),
    })
    return NextResponse.json({ contactId, eventId: result.eventId }, { status: 202 })
  } catch (e) {
    console.error('[Marketing Consent] gRPC error:', e)
    return NextResponse.json(
      { error: { code: 'COMMAND_FAILED', message: 'Consent update failed. Please retry.' } },
      { status: 503 },
    )
  }
}
