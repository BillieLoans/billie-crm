/**
 * API Route: GET /api/system/status
 *
 * Get event processing status for monitoring.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(_request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const client = getLedgerClient()

    try {
      console.log('[System Status] Calling gRPC getEventProcessingStatus')

      const response = await client.getEventProcessingStatus({})

      console.log('[System Status] Raw gRPC response:', JSON.stringify(response, null, 2))

      // Transform the gRPC response to match the expected frontend interface
      const grpcResponse = response as any
      
      const success = grpcResponse.success ?? true
      const overallStatus = grpcResponse.overallStatus ?? grpcResponse.overall_status ?? 'unknown'
      const totalPending = grpcResponse.totalPending ?? grpcResponse.total_pending ?? '0'
      const estimatedCatchupSeconds = grpcResponse.estimatedCatchupSeconds ?? grpcResponse.estimated_catchup_seconds ?? '0'
      const queriedAt = grpcResponse.queriedAt ?? grpcResponse.queried_at ?? new Date().toISOString()
      const warning = grpcResponse.warning ?? grpcResponse.warning_message
      const errorMessage = grpcResponse.errorMessage ?? grpcResponse.error_message
      
      // Transform streams array
      const streams = (grpcResponse.streams ?? []).map((stream: any) => {
        return {
          streamName: stream.streamName ?? stream.stream_name ?? '',
          consumerGroup: stream.consumerGroup ?? stream.consumer_group ?? '',
          streamLength: stream.streamLength ?? stream.stream_length ?? '0',
          pendingCount: stream.pendingCount ?? stream.pending_count ?? '0',
          lastDeliveredId: stream.lastDeliveredId ?? stream.last_delivered_id ?? '',
          lastEntryId: stream.lastEntryId ?? stream.last_entry_id ?? '',
          lagSeconds: stream.lagSeconds ?? stream.lag_seconds ?? '0',
          status: stream.status ?? 'unknown',
          consumerCount: stream.consumerCount ?? stream.consumer_count ?? 0,
          lastError: stream.lastError ?? stream.last_error,
          lastProcessedAt: stream.lastProcessedAt ?? stream.last_processed_at,
        }
      })

      const transformedResponse = {
        success,
        overallStatus,
        totalPending,
        estimatedCatchupSeconds,
        streams,
        queriedAt,
        warning,
        errorMessage,
      }

      console.log('[System Status] Transformed response:', JSON.stringify(transformedResponse, null, 2))

      return NextResponse.json(transformedResponse)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string; details?: string }
      
      console.error('[System Status] gRPC error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        error: grpcError,
      })
      
      // Handle UNAVAILABLE (14), UNAUTHENTICATED (16), UNIMPLEMENTED (12), or missing client method
      if (
        error.code === 14 ||
        error.code === 16 ||
        error.code === 12 ||
        error.message?.includes('UNAVAILABLE') ||
        error.message?.includes('UNAUTHENTICATED') ||
        error.message?.includes('not implemented') ||
        error.message?.includes('call') ||
        error.message?.includes('undefined')
      ) {
        console.warn('Ledger service unavailable/unauthenticated/not implemented for system status')
        return NextResponse.json({
          success: true,
          overallStatus: 'unknown',
          totalPending: '0',
          estimatedCatchupSeconds: '0',
          streams: [],
          queriedAt: new Date().toISOString(),
          _fallback: true,
          _message: 'Service unavailable',
        })
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching system status:', error)
    return NextResponse.json(
      { error: 'Failed to fetch system status', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
