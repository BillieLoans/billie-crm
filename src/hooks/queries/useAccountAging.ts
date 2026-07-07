import { useQuery } from '@tanstack/react-query'

/**
 * Account aging response from API
 */
export interface AccountAgingResponse {
  accountId: string
  dpd: number
  bucket: string
  daysUntilOverdue: number
  totalOverdueAmount: string
  lastPaymentDate?: string
  lastPaymentAmount?: string
  nextDueDate?: string
  nextDueAmount?: string
  bucketHistory?: BucketTransition[]
  updatedAt: string
  /**
   * From aging-v1.1.0: `bucket not in {"current","closed"}` AND not terminal.
   * The single source of truth for the "in arrears" badge — prefer this over
   * recomputing from `bucket` + account status.
   */
  isInArrears?: boolean
  _fallback?: boolean
}

/**
 * Bucket transition history entry
 */
export interface BucketTransition {
  fromBucket: string
  toBucket: string
  transitionDate: string
  reason: string
}

/**
 * Options for useAccountAging hook
 */
export interface UseAccountAgingOptions {
  /** Account ID to fetch aging for */
  accountId: string
  /** Enable/disable the query (default: true) */
  enabled?: boolean
}

/**
 * Fetch account aging from the API
 */
async function fetchAccountAging(accountId: string): Promise<AccountAgingResponse> {
  const response = await fetch(`/api/ledger/aging/${accountId}`)

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || 'Failed to fetch account aging')
  }

  return response.json()
}

/**
 * Query key for account aging
 */
export const accountAgingQueryKey = (accountId: string) => ['account-aging', accountId] as const

/**
 * Hook to fetch account aging status (DPD, bucket, overdue amounts).
 *
 * Features:
 * - Returns current aging status with bucket and DPD
 * - Includes bucket transition history
 * - Auto-refreshes every 30 seconds
 * - Handles service unavailability gracefully
 *
 * @example
 * ```tsx
 * const { dpd, bucket, isLoading } = useAccountAging({
 *   accountId: 'LA-00123456',
 * })
 *
 * if (isLoading) return <Skeleton />
 *
 * return (
 *   <Badge variant={getBucketVariant(bucket)}>
 *     {bucket} ({dpd} DPD)
 *   </Badge>
 * )
 * ```
 *
 * Story E2-S1: Create useAccountAging Query Hook
 */
export function useAccountAging(options: UseAccountAgingOptions) {
  const { accountId, enabled = true } = options

  const query = useQuery({
    queryKey: accountAgingQueryKey(accountId),
    queryFn: () => fetchAccountAging(accountId),
    enabled: enabled && !!accountId,
    staleTime: 10_000, // 10 seconds
    refetchOnWindowFocus: true,
    refetchInterval: 30_000, // Refresh every 30s
  })

  return {
    /** Days past due */
    dpd: query.data?.dpd ?? 0,
    /** Current aging bucket (current, early_arrears, late_arrears, default) */
    bucket: query.data?.bucket ?? 'current',
    /** Days until account becomes overdue (negative if already overdue) */
    daysUntilOverdue: query.data?.daysUntilOverdue ?? 0,
    /** Total overdue amount as string */
    totalOverdueAmount: query.data?.totalOverdueAmount ?? '0',
    /** Last payment date */
    lastPaymentDate: query.data?.lastPaymentDate,
    /** Last payment amount */
    lastPaymentAmount: query.data?.lastPaymentAmount,
    /** Next due date */
    nextDueDate: query.data?.nextDueDate,
    /** Next due amount */
    nextDueAmount: query.data?.nextDueAmount,
    /** History of bucket transitions */
    bucketHistory: query.data?.bucketHistory ?? [],
    /** When the aging was last updated */
    updatedAt: query.data?.updatedAt,
    /**
     * True when the account is currently in arrears (per aging-v1.1.0).
     * Equivalent to `bucket not in {"current","closed"}` and not terminal,
     * but computed authoritatively by the aging service.
     */
    isInArrears: query.data?.isInArrears ?? false,
    /** Whether data is from fallback (service unavailable) */
    isFallback: query.data?._fallback ?? false,
    /** Whether the initial load is in progress */
    isLoading: query.isLoading,
    /** Whether a refetch is in progress */
    isFetching: query.isFetching,
    /** Error if the fetch failed */
    error: query.error,
    /** Force a refetch */
    refetch: query.refetch,
    /** Full query result for advanced usage */
    query,
  }
}
