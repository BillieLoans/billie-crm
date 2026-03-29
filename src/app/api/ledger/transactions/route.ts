/**
 * API Route: GET /api/ledger/transactions
 *
 * Fetch transactions for a loan account from the AccountingLedgerService.
 *
 * Query params:
 * - loanAccountId (required): Loan account ID
 * - limit (optional): Max transactions to return
 * - fromDate (optional): Start date filter (YYYY-MM-DD)
 * - toDate (optional): End date filter (YYYY-MM-DD)
 * - type (optional): Transaction type filter
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getLedgerClient,
  TransactionType,
  getTransactionTypeLabel,
} from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const searchParams = request.nextUrl.searchParams
    const loanAccountId = searchParams.get('loanAccountId')

    if (!loanAccountId) {
      return NextResponse.json({ error: 'loanAccountId is required' }, { status: 400 })
    }

    const rawLimit = searchParams.get('limit')
    const limit = rawLimit ? parseInt(rawLimit, 10) : undefined
    if (limit !== undefined && !Number.isFinite(limit)) {
      return NextResponse.json({ error: 'Invalid limit parameter' }, { status: 400 })
    }
    const fromDate = searchParams.get('fromDate')
    const toDate = searchParams.get('toDate')
    const type = searchParams.get('type') as TransactionType | null

    const client = getLedgerClient()

    try {
      const response = await client.getTransactions({
        loanAccountId,
        limit,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        typeFilter: type || undefined,
      })

      // Transform transactions for frontend consumption
      const transactions = response.transactions.map((tx) => ({
        transactionId: tx.transactionId,
        loanAccountId: tx.loanAccountId,
        type: tx.type,
        typeLabel: getTransactionTypeLabel(tx.type),
        transactionDate: tx.transactionDate,
        effectiveDate: tx.effectiveDate,
        principalDelta: tx.principalDelta,
        feeDelta: tx.feeDelta,
        totalDelta: tx.totalDelta,
        principalAfter: tx.principalAfter,
        feeAfter: tx.feeAfter,
        totalAfter: tx.totalAfter,
        description: tx.description,
        referenceType: tx.referenceType,
        referenceId: tx.referenceId,
        createdBy: tx.createdBy,
        createdAt: tx.createdAt,
      }))

      return NextResponse.json({
        loanAccountId: response.loanAccountId,
        transactions,
        totalCount: response.totalCount,
      })
    } catch (grpcError: any) {
      // Handle gRPC connection errors gracefully
      if (grpcError.code === 14 || grpcError.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable, returning empty transactions')
        return NextResponse.json({
          loanAccountId,
          transactions: [],
          totalCount: 0,
          _fallback: true,
          _message: 'Ledger service unavailable - no transaction history available',
        })
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error fetching transactions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch transactions', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}

