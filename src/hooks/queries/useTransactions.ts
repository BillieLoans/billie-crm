import { useQuery, keepPreviousData } from '@tanstack/react-query'

/**
 * Transaction data from the ledger API.
 */
export interface Transaction {
  transactionId: string
  loanAccountId: string
  type: string
  typeLabel: string
  transactionDate: string
  effectiveDate: string
  principalDelta: string
  feeDelta: string
  totalDelta: string
  principalAfter: string
  feeAfter: string
  totalAfter: string
  description: string
  referenceType: string
  referenceId: string
  createdBy: string
  createdAt: string
}

/**
 * Response from /api/ledger/transactions
 */
export interface TransactionsResponse {
  loanAccountId: string
  transactions: Transaction[]
  totalCount: number
  _fallback?: boolean
  _message?: string
}

/**
 * Filter options for transactions
 */
export interface TransactionFilters {
  type?: string
  fromDate?: string
  toDate?: string
  limit?: number
}

/**
 * Transaction types available for filtering
 */
export const TRANSACTION_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'DISBURSEMENT', label: 'Disbursement' },
  { value: 'ESTABLISHMENT_FEE', label: 'Establishment Fee' },
  { value: 'REPAYMENT', label: 'Repayment' },
  { value: 'LATE_FEE', label: 'Late Fee' },
  { value: 'DISHONOUR_FEE', label: 'Dishonour Fee' },
  { value: 'FEE_WAIVER', label: 'Fee Waiver' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
  { value: 'WRITE_OFF', label: 'Write Off' },
] as const

async function fetchTransactions(
  loanAccountId: string,
  filters: TransactionFilters,
): Promise<TransactionsResponse> {
  const params = new URLSearchParams()
  params.set('loanAccountId', loanAccountId)

  if (filters.limit) params.set('limit', filters.limit.toString())
  if (filters.type) params.set('type', filters.type)
  if (filters.fromDate) params.set('fromDate', filters.fromDate)
  if (filters.toDate) params.set('toDate', filters.toDate)

  const res = await fetch(`/api/ledger/transactions?${params.toString()}`)

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to fetch transactions' }))
    throw new Error(error.error || 'Failed to fetch transactions')
  }

  return res.json()
}

/**
 * Query key factory for transactions
 */
export const transactionsQueryKey = (loanAccountId: string, filters: TransactionFilters) =>
  ['transactions', loanAccountId, filters] as const

/**
 * Hook to fetch transactions for a loan account with filtering.
 */
export function useTransactions(loanAccountId: string | null, filters: TransactionFilters = {}) {
  return useQuery({
    queryKey: transactionsQueryKey(loanAccountId ?? '', filters),
    queryFn: () => fetchTransactions(loanAccountId!, filters),
    enabled: !!loanAccountId,
    staleTime: 30_000, // 30 seconds
    placeholderData: keepPreviousData,
  })
}
