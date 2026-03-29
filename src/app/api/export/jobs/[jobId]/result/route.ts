/**
 * API Route: GET /api/export/jobs/[jobId]/result
 *
 * Download export result as a file.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient, ExportFormat } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

const CONTENT_TYPES: Record<string, string> = {
  [ExportFormat.EXPORT_FORMAT_CSV]: 'text/csv',
  [ExportFormat.EXPORT_FORMAT_JSON]: 'application/json',
}

const FILE_EXTENSIONS: Record<string, string> = {
  [ExportFormat.EXPORT_FORMAT_CSV]: 'csv',
  [ExportFormat.EXPORT_FORMAT_JSON]: 'json',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const { jobId } = await params

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    try {
      const response = await client.getExportResult({
        jobId,
      })

      if (!response.success) {
        return NextResponse.json(
          { error: response.errorMessage || 'Export result not available' },
          { status: 404 },
        )
      }

      const contentType = CONTENT_TYPES[response.format] ?? 'application/octet-stream'
      const ext = FILE_EXTENSIONS[response.format] ?? 'dat'
      const filename = `export-${jobId}.${ext}`

      return new NextResponse(response.data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      if (error.code === 14 || error.message?.includes('UNAVAILABLE')) {
        console.warn('[ExportAPI] Ledger service unavailable for export result')
        return NextResponse.json(
          { error: 'Ledger service unavailable' },
          { status: 503 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('[ExportAPI] Error fetching export result:', error)
    return NextResponse.json(
      { error: 'Failed to fetch export result', details: (error as Error).message },
      { status: 500 },
    )
  }
}
