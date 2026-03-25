/**
 * API Routes: POST/GET /api/export/jobs
 *
 * POST: Create an export job
 * GET: List user's export jobs
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getLedgerClient,
  ExportType,
  ExportFormat,
  ExportStatus,
  type ExportJobResponse,
} from '@/server/grpc-client'

/**
 * Maps gRPC export type enums to UI-friendly names.
 */
const EXPORT_TYPE_TO_UI: Record<string, string> = {
  [ExportType.EXPORT_TYPE_JOURNAL_ENTRIES]: 'journal_entries',
  [ExportType.EXPORT_TYPE_AUDIT_TRAIL]: 'audit_trail',
  [ExportType.EXPORT_TYPE_METHODOLOGY]: 'methodology',
}

/**
 * Maps gRPC export format enums to UI-friendly names.
 */
const EXPORT_FORMAT_TO_UI: Record<string, string> = {
  [ExportFormat.EXPORT_FORMAT_CSV]: 'csv',
  [ExportFormat.EXPORT_FORMAT_JSON]: 'json',
}

/**
 * Maps gRPC export status enums to UI-friendly names.
 */
const EXPORT_STATUS_TO_UI: Record<string, string> = {
  [ExportStatus.EXPORT_STATUS_PENDING]: 'pending',
  [ExportStatus.EXPORT_STATUS_PROCESSING]: 'processing',
  [ExportStatus.EXPORT_STATUS_COMPLETED]: 'ready',
  [ExportStatus.EXPORT_STATUS_FAILED]: 'failed',
}

/**
 * Transform a gRPC ExportJobResponse into the shape the UI expects.
 */
function mapExportJob(job: ExportJobResponse) {
  return {
    id: job.jobId,
    type: EXPORT_TYPE_TO_UI[job.exportType] ?? job.exportType,
    format: EXPORT_FORMAT_TO_UI[job.exportFormat] ?? job.exportFormat,
    status: EXPORT_STATUS_TO_UI[job.status] ?? job.status,
    createdAt: job.createdAt,
    createdBy: job.createdBy,
    completedAt: job.completedAt || undefined,
    sizeBytes: job.resultSizeBytes ? parseInt(job.resultSizeBytes, 10) : undefined,
    downloadUrl: job.jobId ? `/api/export/jobs/${job.jobId}/result` : undefined,
    errorMessage: job.errorMessage || undefined,
  }
}

interface CreateExportBody {
  exportType: ExportType
  exportFormat?: ExportFormat
  createdBy: string
  periodDate?: string
  accountIds?: string[]
  dateRangeStart?: string
  dateRangeEnd?: string
  includeCalculationBreakdown?: boolean
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateExportBody = await request.json()
    console.log('[ExportAPI] POST /api/export/jobs - body:', JSON.stringify(body, null, 2))

    if (!body.exportType) {
      console.warn('[ExportAPI] Missing exportType in request')
      return NextResponse.json({ error: 'exportType is required' }, { status: 400 })
    }

    if (!body.createdBy) {
      console.warn('[ExportAPI] Missing createdBy in request')
      return NextResponse.json({ error: 'createdBy is required' }, { status: 400 })
    }

    const client = getLedgerClient()
    console.log('[ExportAPI] Got ledger client, calling createExportJob...')

    try {
      const response = await client.createExportJob({
        exportType: body.exportType,
        exportFormat: body.exportFormat,
        createdBy: body.createdBy,
        periodDate: body.periodDate,
        accountIds: body.accountIds,
        dateRangeStart: body.dateRangeStart,
        dateRangeEnd: body.dateRangeEnd,
        includeCalculationBreakdown: body.includeCalculationBreakdown,
      })

      console.log('[ExportAPI] createExportJob success:', JSON.stringify(response, null, 2))
      return NextResponse.json(response)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      console.error('[ExportAPI] gRPC error:', { code: error.code, message: error.message })
      if (
        error.code === 14 ||
        error.code === 12 ||
        error.message?.includes('UNAVAILABLE') ||
        error.message?.includes('not implemented') ||
        error.message?.includes('call')
      ) {
        console.warn('[ExportAPI] Ledger service unavailable for createExportJob:', error.message)
        return NextResponse.json(
          {
            error: 'Export service is not available',
            message: 'The export service is currently unavailable. Please try again later.',
          },
          { status: 503 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('[ExportAPI] Unhandled error creating export job:', error)
    return NextResponse.json(
      { error: 'Failed to create export job', message: (error as Error).message },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const userId = searchParams.get('userId')
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined
    const includeCompleted = searchParams.get('includeCompleted') !== 'false'

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const client = getLedgerClient()
    console.log('[ExportAPI] GET /api/export/jobs - userId:', userId, 'limit:', limit)

    try {
      const response = await client.listExportJobs({
        userId,
        limit,
        includeCompleted,
      })

      const mappedJobs = (response?.jobs ?? []).map(mapExportJob)
      console.log('[ExportAPI] listExportJobs success, jobs count:', mappedJobs.length)
      return NextResponse.json({ jobs: mappedJobs, totalCount: mappedJobs.length })
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      console.error('[ExportAPI] listExportJobs gRPC error:', { code: error.code, message: error.message })
      // Handle UNAVAILABLE (14), UNIMPLEMENTED (12), or missing client method
      if (
        error.code === 14 ||
        error.code === 12 ||
        error.message?.includes('UNAVAILABLE') ||
        error.message?.includes('not implemented') ||
        error.message?.includes('call')
      ) {
        console.warn('[ExportAPI] Ledger service unavailable for listExportJobs - returning empty fallback')
        return NextResponse.json(
          {
            jobs: [],
            totalCount: 0,
            _fallback: true,
            _message: 'Export jobs service not available',
          },
          { status: 200 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error listing export jobs:', error)
    return NextResponse.json(
      { error: 'Failed to list export jobs', details: (error as Error).message },
      { status: 500 },
    )
  }
}
