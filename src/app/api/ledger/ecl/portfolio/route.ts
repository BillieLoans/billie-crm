/**
 * API Route: GET /api/ledger/ecl/portfolio
 *
 * Get portfolio-wide ECL summary by bucket.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const client = getLedgerClient()

    try {
      console.log('[Portfolio ECL] Calling gRPC getPortfolioECL')

      const response = await client.getPortfolioECL({})

      console.log('[Portfolio ECL] Raw gRPC response:', JSON.stringify(response, null, 2))

      // Transform the gRPC response to match the expected frontend interface
      const grpcResponse = response as any
      
      const asOfDate = grpcResponse.asOfDate ?? grpcResponse.as_of_date ?? new Date().toISOString()
      const totalAccounts = grpcResponse.totalAccounts ?? grpcResponse.total_accounts ?? 0
      const totalEcl = grpcResponse.totalEcl ?? grpcResponse.total_ecl ?? '0.00'
      const totalCarryingAmount = grpcResponse.totalCarryingAmount ?? grpcResponse.total_carrying_amount ?? '0.00'
      
      // Transform buckets array
      const buckets = (grpcResponse.buckets ?? []).map((bucket: any) => {
        const bucketName = bucket.bucket ?? ''
        const accountCount = bucket.accountCount ?? bucket.account_count ?? 0
        const totalEclBucket = bucket.totalEcl ?? bucket.total_ecl ?? '0.00'
        const totalCarryingBucket = bucket.totalCarryingAmount ?? bucket.total_carrying_amount ?? '0.00'
        const averagePdRate = bucket.averagePdRate ?? bucket.average_pd_rate ?? '0.00'
        
        // Map old bucket names to new ones
        let mappedBucket = bucketName.toLowerCase()
        if (mappedBucket === 'bucket_1' || mappedBucket === 'days_1_30') mappedBucket = 'early_arrears'
        else if (mappedBucket === 'bucket_2' || mappedBucket === 'bucket_3' || mappedBucket === 'days_31_60' || mappedBucket === 'days_61_90') mappedBucket = 'late_arrears'
        else if (mappedBucket === 'bucket_4' || mappedBucket === 'days_90_plus') mappedBucket = 'default'
        else if (mappedBucket === 'current' || mappedBucket === 'bucket_0') mappedBucket = 'current'
        
        return {
          bucket: mappedBucket,
          accountCount,
          totalEcl: totalEclBucket,
          totalCarryingAmount: totalCarryingBucket,
          averagePdRate,
        }
      })

      const transformedResponse = {
        asOfDate,
        totalAccounts,
        totalEcl,
        totalCarryingAmount,
        buckets,
      }

      console.log('[Portfolio ECL] Transformed response:', JSON.stringify(transformedResponse, null, 2))

      return NextResponse.json(transformedResponse)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string; details?: string }
      
      console.error('[Portfolio ECL] gRPC error:', {
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
        console.warn('Ledger service unavailable/unauthenticated/not implemented for portfolio ECL')
        return NextResponse.json({
          totalAccounts: 0,
          totalEcl: '0.00',
          totalCarryingAmount: '0.00',
          buckets: [],
          _fallback: true,
          _message: 'Service unavailable',
        })
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching portfolio ECL:', error)
    return NextResponse.json(
      { error: 'Failed to fetch portfolio ECL', details: (error as Error).message },
      { status: 500 },
    )
  }
}
