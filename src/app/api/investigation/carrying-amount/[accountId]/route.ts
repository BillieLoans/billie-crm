/**
 * API Route: GET /api/investigation/carrying-amount/[accountId]
 *
 * Get carrying amount breakdown for audit verification.
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
      const response = await client.getCarryingAmountBreakdown({
        accountId,
      })

      // Transform the gRPC response to match the expected frontend interface
      // Handle both camelCase (from proto loader) and snake_case field names
      const grpcResponse = response as any

      const transformedResponse = {
        accountId: grpcResponse.accountId ?? grpcResponse.account_id ?? accountId,
        principalBalance: grpcResponse.principalBalance ?? grpcResponse.principal_balance ?? '0',
        accruedYield: grpcResponse.accruedYield ?? grpcResponse.accrued_yield ?? '0',
        carryingAmount: grpcResponse.carryingAmount ?? grpcResponse.carrying_amount ?? '0',
        feeBalance: grpcResponse.feeBalance ?? grpcResponse.fee_balance ?? '0',
        disbursedPrincipal: grpcResponse.disbursedPrincipal ?? grpcResponse.disbursed_principal ?? '0',
        establishmentFee: grpcResponse.establishmentFee ?? grpcResponse.establishment_fee ?? '0',
        totalPaid: grpcResponse.totalPaid ?? grpcResponse.total_paid ?? '0',
        lastAccrualDate: grpcResponse.lastAccrualDate ?? grpcResponse.last_accrual_date ?? '',
        daysAccrued: grpcResponse.daysAccrued ?? grpcResponse.days_accrued ?? 0,
        termDays: grpcResponse.termDays ?? grpcResponse.term_days ?? 0,
        dailyAccrualRate: grpcResponse.dailyAccrualRate ?? grpcResponse.daily_accrual_rate ?? '0',
        calculationTimestamp: grpcResponse.calculationTimestamp ?? grpcResponse.calculation_timestamp ?? new Date().toISOString(),
      }

      // Debug logging to verify field mapping
      console.log(`[Carrying Amount Breakdown] Account: ${accountId}, Mapped fields:`, {
        feeBalance: transformedResponse.feeBalance,
        establishmentFee: transformedResponse.establishmentFee,
        principalBalance: transformedResponse.principalBalance,
        accruedYield: transformedResponse.accruedYield,
        'raw.feeBalance': grpcResponse.feeBalance,
        'raw.fee_balance': grpcResponse.fee_balance,
        'raw.establishmentFee': grpcResponse.establishmentFee,
        'raw.establishment_fee': grpcResponse.establishment_fee,
      })

      return NextResponse.json(transformedResponse)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string }
      if (error.code === 14 || error.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable for carrying amount')
        return NextResponse.json(
          { error: 'Ledger service unavailable', _fallback: true },
          { status: 503 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching carrying amount:', error)
    return NextResponse.json(
      { error: 'Failed to fetch carrying amount', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
