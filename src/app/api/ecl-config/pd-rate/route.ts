/**
 * API Route: PUT /api/ecl-config/pd-rate
 *
 * Update PD rate for a bucket.
 *
 * Body:
 * - bucket: string (required) - Bucket name
 * - rate: number (required) - New PD rate
 * - updatedBy: string (optional, server-derived) - User making the change
 * - reason: string (optional) - Reason for change
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'
import { UpdatePDRateSchema } from '@/lib/schemas/api'

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body = await request.json()
    const parseResult = UpdatePDRateSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parseResult.data

    const client = getLedgerClient()

    try {
      const response = await client.updatePDRate({
        bucket: data.bucket,
        pdRate: data.rate.toString(),
        updatedBy: String(user.id),
      })

      // Transform the gRPC response to match expected format
      const grpcResponse = response as any
      const _overlayMultiplier = parseFloat(grpcResponse.overlayMultiplier ?? grpcResponse.overlay_multiplier ?? '1.0')
      const pdRatesMap = grpcResponse.pdRates ?? grpcResponse.pd_rates ?? {}
      const lastUpdated = grpcResponse.lastUpdated ?? grpcResponse.last_updated ?? new Date().toISOString()
      const _updatedBy = grpcResponse.updatedBy ?? grpcResponse.updated_by ?? String(user.id)

      // Find the updated bucket's previous rate (if available)
      const previousRate = pdRatesMap[data.bucket] ? parseFloat(pdRatesMap[data.bucket] as string) : data.rate

      return NextResponse.json({
        success: true,
        bucket: data.bucket,
        newRate: data.rate,
        previousRate: previousRate,
        updatedAt: lastUpdated,
      })
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string; details?: string }
      
      console.error('[PD Rate Update] gRPC error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        error: grpcError,
      })

      // Handle UNAVAILABLE (14), UNIMPLEMENTED (12), or missing client method
      if (
        error.code === 14 ||
        error.code === 12 ||
        error.message?.includes('UNAVAILABLE') ||
        error.message?.includes('not implemented') ||
        error.message?.includes('call')
      ) {
        console.warn('Ledger service unavailable or method not implemented for PD rate update')
        return NextResponse.json(
          {
            error: 'Ledger service unavailable',
            message: 'PD rate update could not be applied. Please try again later.',
          },
          { status: 503 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error updating PD rate:', error)
    return NextResponse.json(
      { error: 'Failed to update PD rate', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
