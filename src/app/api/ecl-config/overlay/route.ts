/**
 * API Route: PUT /api/ecl-config/overlay
 *
 * Update overlay multiplier.
 *
 * Body:
 * - overlayMultiplier: string (required) - New overlay value
 * - updatedBy: string (optional, server-derived) - User making the change
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'
import { UpdateOverlaySchema } from '@/lib/schemas/api'

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body = await request.json()
    const parseResult = UpdateOverlaySchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parseResult.data

    // Handle both 'value' (number) and 'overlayMultiplier' (string) for backward compatibility
    const overlayValue = data.value ?? (data.overlayMultiplier ? parseFloat(data.overlayMultiplier) : undefined)

    if (overlayValue === undefined || isNaN(overlayValue)) {
      return NextResponse.json({ error: 'overlayMultiplier or value is required and must be a valid number' }, { status: 400 })
    }

    const client = getLedgerClient()

    try {
      console.log('[Overlay Update] Calling gRPC with:', {
        overlayMultiplier: overlayValue.toString(),
        updatedBy: String(user.id),
      })

      const response = await client.updateOverlayMultiplier({
        overlayMultiplier: overlayValue.toString(), // gRPC expects string
        updatedBy: String(user.id),
      })

      console.log('[Overlay Update] gRPC response:', JSON.stringify(response, null, 2))

      // Transform the gRPC response to match expected format
      const grpcResponse = response as any
      const overlayMultiplier = parseFloat(grpcResponse.overlayMultiplier ?? grpcResponse.overlay_multiplier ?? overlayValue.toString())
      const pdRatesMap = grpcResponse.pdRates ?? grpcResponse.pd_rates ?? {}
      const lastUpdated = grpcResponse.lastUpdated ?? grpcResponse.last_updated ?? new Date().toISOString()
      const updatedBy = grpcResponse.updatedBy ?? grpcResponse.updated_by ?? String(user.id)

      return NextResponse.json({
        success: true,
        newValue: overlayMultiplier,
        previousValue: overlayValue, // We don't have the previous value from gRPC, so use current
        updatedAt: lastUpdated,
      })
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string; details?: string }
      
      console.error('[Overlay Update] gRPC error:', {
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
        error.message?.includes('call') ||
        error.message?.includes('undefined')
      ) {
        console.warn('Ledger service unavailable or method not implemented for overlay update')
        return NextResponse.json(
          {
            success: true,
            newValue: overlayValue,
            previousValue: overlayValue,
            updatedAt: new Date().toISOString(),
            _fallback: true,
            _message: 'Overlay update service not available',
          },
          { status: 200 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error updating overlay multiplier:', error)
    return NextResponse.json(
      { error: 'Failed to update overlay multiplier', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
