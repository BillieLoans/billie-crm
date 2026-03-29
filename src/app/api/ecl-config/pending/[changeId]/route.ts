/**
 * API Route: DELETE /api/ecl-config/pending/[changeId]
 *
 * Cancel a pending config change.
 *
 * Body:
 * - cancelledBy: string (required) - User cancelling the change
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'

interface CancelBody {
  cancelledBy: string
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ changeId: string }> },
) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    const { changeId } = await params

    if (!changeId) {
      return NextResponse.json({ error: 'changeId is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    const response = await client.cancelPendingConfigChange({
      changeId,
      cancelledBy: String(user.id),
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error cancelling config change:', error)
    return NextResponse.json(
      { error: 'Failed to cancel config change', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
