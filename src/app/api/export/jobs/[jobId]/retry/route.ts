/**
 * API Route: POST /api/export/jobs/[jobId]/retry
 *
 * Retry a failed export job.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error

    const { jobId } = await params

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    const response = await client.retryExport({
      jobId,
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error retrying export:', error)
    return NextResponse.json(
      { error: 'Failed to retry export', details: (error as Error).message },
      { status: 500 },
    )
  }
}
