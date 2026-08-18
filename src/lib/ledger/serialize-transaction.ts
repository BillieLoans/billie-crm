/**
 * Shared serializer for ledger transactions returned by the money-movement API
 * routes (repayment, waive-fee, adjustment, late-fee, dishonour-fee).
 *
 * The same ~15-line mapping used to be copy-pasted into every route. The proto
 * amounts are decimal strings, so they are parseFloat()'d for the client; an
 * unset proto3 string is '', and parseFloat('') is NaN, which JSON.stringify
 * emits as null — clients already defend against that (see useWaiveFee).
 *
 * Which delta fields a route reports is part of its contract, so the extra
 * groups are opt-in rather than always emitted:
 *  - principal deltas: repayment, waive-fee, adjustment
 *  - totalDelta:       repayment, waive-fee, adjustment
 */

import { timestampToDate, getTransactionTypeLabel } from '@/server/grpc-client'
import type { Transaction } from '@/server/grpc-client'

export interface SerializeTransactionOptions {
  /** Include principalDelta / principalAfter. */
  includePrincipal?: boolean
  /** Include totalDelta. */
  includeTotalDelta?: boolean
}

export interface SerializedTransaction {
  id: string
  accountId: string
  type: string
  typeLabel: string
  date: string
  feeDelta: number
  feeAfter: number
  totalAfter: number
  description: string
  principalDelta?: number
  principalAfter?: number
  totalDelta?: number
}

export function serializeTransaction(
  tx: Transaction,
  options: SerializeTransactionOptions = {},
): SerializedTransaction {
  return {
    id: tx.transactionId,
    accountId: tx.loanAccountId,
    type: tx.type,
    typeLabel: getTransactionTypeLabel(tx.type),
    date: timestampToDate(tx.transactionDate).toISOString(),
    ...(options.includePrincipal && { principalDelta: parseFloat(tx.principalDelta) }),
    feeDelta: parseFloat(tx.feeDelta),
    ...(options.includeTotalDelta && { totalDelta: parseFloat(tx.totalDelta) }),
    ...(options.includePrincipal && { principalAfter: parseFloat(tx.principalAfter) }),
    feeAfter: parseFloat(tx.feeAfter),
    totalAfter: parseFloat(tx.totalAfter),
    description: tx.description,
  }
}
