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
import type { BasePayload } from 'payload'

/** Payload user ids are UUIDs; "system" marks an automated ledger write. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ActorSource = { createdBy?: string; metadata?: Record<string, string> }

/**
 * Map the actor ids on a batch of transactions to display names.
 *
 * The ledger only knows ids, and a raw GUID in the servicing UI tells an
 * operator nothing. Resolving here keeps it to one query per request instead of
 * one per row. Best-effort by design: an id that does not resolve is simply
 * absent from the map and the client falls back to showing the raw value, and a
 * failed lookup must never cost the operator their transaction history.
 */
async function resolveActors(
  payload: BasePayload,
  transactions: ActorSource[],
): Promise<Record<string, string>> {
  const ids = new Set<string>()
  for (const tx of transactions) {
    for (const candidate of [tx.createdBy, tx.metadata?.approved_by]) {
      if (candidate && UUID_PATTERN.test(candidate)) ids.add(candidate)
    }
  }
  if (ids.size === 0) return {}

  try {
    const { docs } = await payload.find({
      collection: 'users',
      where: { id: { in: Array.from(ids) } },
      limit: ids.size,
      depth: 0,
    })

    const actors: Record<string, string> = {}
    for (const doc of docs) {
      const name = [doc.firstName, doc.lastName].filter(Boolean).join(' ').trim()
      const display = name || doc.email
      if (display) actors[String(doc.id)] = display
    }
    return actors
  } catch (error) {
    console.warn('Failed to resolve transaction actors:', error)
    return {}
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { payload } = auth

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
        // The operator's reason/notes live in metadata (stamped per type by
        // the ledger's command layer) and, for the types that take a free-text
        // note, in `notes`. Both feed the Transactions tab detail panel.
        metadata: tx.metadata ?? {},
        notes: tx.notes,
        createdBy: tx.createdBy,
        createdAt: tx.createdAt,
      }))

      return NextResponse.json({
        loanAccountId: response.loanAccountId,
        transactions,
        totalCount: response.totalCount,
        actors: await resolveActors(payload, response.transactions),
      })
    } catch (grpcError: any) {
      // Handle gRPC connection errors gracefully
      if (grpcError.code === 14 || grpcError.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable, returning empty transactions')
        return NextResponse.json({
          loanAccountId,
          transactions: [],
          totalCount: 0,
          actors: {},
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

