/**
 * API Route: POST /api/ledger/ecl/recalc/portfolio
 *
 * Trigger portfolio-wide ECL recalculation.
 *
 * Body:
 * - triggeredBy: string (required) - Reason for recalculation
 * - batchSize: number (optional) - Accounts per batch
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'

interface RecalcBody {
  triggeredBy: string
  batchSize?: number
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error

    const body: RecalcBody = await request.json()

    if (!body.triggeredBy) {
      return NextResponse.json({ error: 'triggeredBy is required' }, { status: 400 })
    }

    // Look up username from user GUID
    let triggeredByName = body.triggeredBy
    if (body.triggeredBy && body.triggeredBy.length === 24) {
      // Looks like a MongoDB ObjectId (user GUID), try to look up the username
      try {
        const payload = await getPayload({ config: configPromise })
        const userResult = await payload.findByID({
          collection: 'users',
          id: body.triggeredBy,
        })
        
        if (userResult) {
          triggeredByName = userResult.firstName && userResult.lastName
            ? `${userResult.firstName} ${userResult.lastName}`
            : userResult.email || body.triggeredBy
        }
      } catch (userError) {
        console.warn('[Portfolio Recalc] Could not look up user, using GUID:', userError)
        // Continue with GUID if lookup fails
      }
    }

    const client = getLedgerClient()

    try {
      const response = await client.triggerPortfolioECLRecalculation({
        triggeredBy: triggeredByName, // Send username instead of GUID
        batchSize: body.batchSize,
      })

      // Transform the gRPC response to match expected format
      const grpcResponse = response as any
      const transformedResponse = {
        success: true,
        jobId: `portfolio-recalc-${Date.now()}`, // Generate a job ID if not provided
        accountCount: grpcResponse.totalAccounts ?? grpcResponse.total_accounts ?? 0,
        status: 'queued' as const,
        startedAt: grpcResponse.startedAt ?? grpcResponse.started_at,
        completedAt: grpcResponse.completedAt ?? grpcResponse.completed_at,
        processed: grpcResponse.processed ?? 0,
        skipped: grpcResponse.skipped ?? 0,
        failed: grpcResponse.failed ?? 0,
        triggeredBy: grpcResponse.triggeredBy ?? grpcResponse.triggered_by ?? body.triggeredBy,
      }

      return NextResponse.json(transformedResponse)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string; details?: string }
      
      console.error('[Portfolio Recalc] gRPC error:', {
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
        console.warn('Ledger service unavailable or method not implemented for portfolio recalc')
        return NextResponse.json(
          {
            error: 'Recalculation service not available',
            message: 'The portfolio ECL recalculation service is not currently available. Please try again later.',
          },
          { status: 503 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error triggering portfolio ECL recalculation:', error)
    return NextResponse.json(
      { error: 'Failed to trigger recalculation', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
