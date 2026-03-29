/**
 * API Route: POST /api/period-close/finalize
 *
 * Finalize a period close.
 *
 * Body:
 * - previewId: string (required) - Preview ID to finalize
 * - finalizedBy: string (optional, server-derived) - User finalizing
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'

interface FinalizeBody {
  previewId: string
  finalizedBy?: string
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body: FinalizeBody = await request.json()

    if (!body.previewId) {
      return NextResponse.json({ error: 'previewId is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    const response = await client.finalizePeriodClose({
      previewId: body.previewId,
      finalizedBy: String(user.id),
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error finalizing period close:', error)
    return NextResponse.json(
      { error: 'Failed to finalize period close', details: (error as Error).message },
      { status: 500 },
    )
  }
}
