'use client'

import { useMemo } from 'react'
import { useTransactions } from './useTransactions'

// Fee types that are waivable/outstanding
const WAIVABLE_FEE_TYPES = ['LATE_FEE', 'DISHONOUR_FEE'] as const

/**
 * Hook to get the count of outstanding waivable fees for an account.
 * Uses the transactions query and filters for fee types with positive amounts.
 */
export function useFeesCount(loanAccountId: string | null): number {
  const { data } = useTransactions(loanAccountId, { limit: 100 })
  const transactions = data?.transactions

  const feesCount = useMemo(() => {
    if (!transactions) return 0
    return transactions.filter((tx) => {
      const feeAmount = parseFloat(tx.feeDelta || '0')
      return (
        WAIVABLE_FEE_TYPES.includes(tx.type as (typeof WAIVABLE_FEE_TYPES)[number]) &&
        feeAmount > 0
      )
    }).length
  }, [data?.transactions])

  return feesCount
}
