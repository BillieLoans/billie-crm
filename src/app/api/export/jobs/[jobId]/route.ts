/**
 * API Route: GET /api/export/jobs/[jobId]
 *
 * Get status of an export job.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole, isAdmin } from '@/lib/access'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { user } = auth

    const { jobId } = await params

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    try {
      const response = await client.getExportStatus({
        jobId,
      })

      // Verify ownership: only the job creator or an admin can view
      if (response.createdBy && response.createdBy !== String(user.id) && !isAdmin(user)) {
        return NextResponse.json(
          { error: 'You do not have permission to view this export job' },
          { status: 403 },
        )
      }

      return NextResponse.json(response)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      if (error.code === 14 || error.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable for export status')
        return NextResponse.json(
          { error: 'Ledger service unavailable', _fallback: true },
          { status: 503 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching export status:', error)
    return NextResponse.json(
      { error: 'Failed to fetch export status', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
