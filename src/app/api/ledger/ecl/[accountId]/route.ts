/**
 * API Route: GET /api/ledger/ecl/[accountId]
 *
 * Get ECL allowance for a loan account.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const { accountId } = await params

    if (!accountId) {
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    try {
      const response = await client.getECLAllowance({
        accountId,
      })

      // Transform the gRPC response to match the expected frontend interface
      // Handle both camelCase (from proto loader) and snake_case field names
      const grpcResponse = response as any
      
      const eclAmount = grpcResponse.eclAmount ?? grpcResponse.ecl_amount ?? '0'
      const carryingAmount = grpcResponse.carryingAmount ?? grpcResponse.carrying_amount ?? '0'
      const agingBucket = grpcResponse.agingBucket ?? grpcResponse.aging_bucket ?? 'current'
      const pdRate = grpcResponse.pdRate ?? grpcResponse.pd_rate ?? '0'
      const overlayMultiplier = grpcResponse.overlayMultiplier ?? grpcResponse.overlay_multiplier ?? '1.0'
      const lastCalculated = grpcResponse.lastCalculated ?? grpcResponse.last_calculated ?? new Date().toISOString()
      const previousEclAmount = grpcResponse.previousEclAmount ?? grpcResponse.previous_ecl_amount
      const eclDelta = grpcResponse.eclDelta ?? grpcResponse.ecl_delta
      const triggeredByEventId = grpcResponse.triggeredByEventId ?? grpcResponse.triggered_by_event_id
      const responseAccountId = grpcResponse.accountId ?? grpcResponse.account_id ?? accountId

      // Calculate change direction
      let eclChange: string | undefined
      let changeDirection: 'increase' | 'decrease' | 'unchanged' = 'unchanged'
      if (eclDelta) {
        const deltaNum = parseFloat(eclDelta)
        eclChange = Math.abs(deltaNum).toFixed(2)
        changeDirection = deltaNum > 0 ? 'increase' : deltaNum < 0 ? 'decrease' : 'unchanged'
      } else if (previousEclAmount) {
        const current = parseFloat(eclAmount)
        const previous = parseFloat(previousEclAmount)
        const delta = current - previous
        eclChange = Math.abs(delta).toFixed(2)
        changeDirection = delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'unchanged'
      }

      // Default LGD rate (not in gRPC response, using standard 100% for now)
      const lgdRate = '1.0'

      // Transform bucket name (gRPC uses bucket names, frontend expects "current", "early_arrears", "late_arrears", or "default")
      const bucket = agingBucket.toLowerCase()

      // Build triggeredBy object if event ID exists
      const triggeredBy = triggeredByEventId
        ? {
            eventId: triggeredByEventId,
            eventType: 'ECL_CALCULATION',
            timestamp: lastCalculated,
            description: `ECL calculation triggered by ${triggeredByEventId}`,
          }
        : undefined

      const transformedResponse = {
        accountId: responseAccountId,
        eclAmount,
        priorEclAmount: previousEclAmount,
        eclChange,
        changeDirection,
        carryingAmount,
        bucket,
        pdRate,
        overlayMultiplier,
        lgdRate,
        calculatedAt: lastCalculated,
        triggeredBy,
        history: [], // ECL history not in current gRPC response
        updatedAt: lastCalculated,
        _fallback: false,
      }

      console.log(`[ECL API] Transformed response for account ${accountId}:`, {
        eclAmount: transformedResponse.eclAmount,
        bucket: transformedResponse.bucket,
        pdRate: transformedResponse.pdRate,
      })

      return NextResponse.json(transformedResponse)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string; details?: string }
      
      // Log the full error for debugging
      console.error(`[ECL API] Error for account ${accountId}:`, {
        code: error.code,
        message: error.message,
        details: error.details,
        error: grpcError,
      })

      // Handle NOT_FOUND - account has no ECL state yet
      if (error.code === 5 || error.message?.includes('NOT_FOUND')) {
        console.warn(`No ECL allowance found for account ${accountId}. Returning default.`)
        return NextResponse.json(
          {
            accountId,
            eclAmount: '0.00',
            eclChange: '0.00',
            changeDirection: 'unchanged',
            carryingAmount: '0.00',
            bucket: 'CURRENT',
            pdRate: '0.00',
            overlayMultiplier: '1.00',
            lgdRate: '0.00',
            calculatedAt: new Date().toISOString(),
            history: [],
          },
          { status: 200 },
        )
      }
      // Handle UNAVAILABLE (14), UNIMPLEMENTED (12), or missing client method
      if (
        error.code === 14 ||
        error.code === 12 ||
        error.message?.includes('UNAVAILABLE') ||
        error.message?.includes('UNIMPLEMENTED') ||
        error.message?.includes('not implemented') ||
        error.message?.includes('call') ||
        error.details?.includes('not implemented')
      ) {
        console.warn(`Ledger service unavailable or method not implemented for ECL allowance (code: ${error.code}, message: ${error.message})`)
        return NextResponse.json(
          {
            accountId,
            eclAmount: '0.00',
            eclChange: '0.00',
            changeDirection: 'unchanged',
            carryingAmount: '0.00',
            bucket: 'CURRENT',
            pdRate: '0.00',
            overlayMultiplier: '1.00',
            lgdRate: '0.00',
            calculatedAt: new Date().toISOString(),
            history: [],
            _fallback: true,
            _message: 'ECL allowance service not available',
          },
          { status: 200 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching ECL allowance:', error)
    return NextResponse.json(
      { error: 'Failed to fetch ECL allowance', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
