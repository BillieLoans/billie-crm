/**
 * API Route: POST /api/export/jobs/[jobId]/retry
 *
 * Retry a failed export job.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { canService, isAdmin } from '@/lib/access'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user } = auth

    const { jobId } = await params

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    // Verify ownership before retrying
    const status = await client.getExportStatus({ jobId })
    if (status.createdBy && status.createdBy !== String(user.id) && !isAdmin(user)) {
      return NextResponse.json(
        { error: 'You do not have permission to retry this export job' },
        { status: 403 },
      )
    }

    const response = await client.retryExport({
      jobId,
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error retrying export:', error)
    return NextResponse.json(
      { error: 'Failed to retry export', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
