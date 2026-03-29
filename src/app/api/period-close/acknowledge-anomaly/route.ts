/**
 * API Route: POST /api/period-close/acknowledge-anomaly
 *
 * Acknowledge an anomaly in a preview.
 *
 * Body:
 * - previewId: string (required) - Preview ID
 * - anomalyId: string (required) - Anomaly ID to acknowledge
 * - acknowledgedBy: string (optional, server-derived) - User acknowledging
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'
import { AcknowledgeAnomalySchema } from '@/lib/schemas/api'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body = await request.json()
    const parseResult = AcknowledgeAnomalySchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parseResult.data

    const client = getLedgerClient()

    const response = await client.acknowledgeAnomaly({
      previewId: data.previewId,
      anomalyId: data.anomalyId,
      acknowledgedBy: String(user.id),
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error acknowledging anomaly:', error)
    return NextResponse.json(
      { error: 'Failed to acknowledge anomaly', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
