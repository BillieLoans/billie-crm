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

interface AcknowledgeBody {
  previewId: string
  anomalyId: string
  acknowledgedBy?: string
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body: AcknowledgeBody = await request.json()

    if (!body.previewId || !body.anomalyId) {
      return NextResponse.json(
        { error: 'previewId and anomalyId are required' },
        { status: 400 },
      )
    }

    const client = getLedgerClient()

    const response = await client.acknowledgeAnomaly({
      previewId: body.previewId,
      anomalyId: body.anomalyId,
      acknowledgedBy: String(user.id),
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error acknowledging anomaly:', error)
    return NextResponse.json(
      { error: 'Failed to acknowledge anomaly', details: (error as Error).message },
      { status: 500 },
    )
  }
}
