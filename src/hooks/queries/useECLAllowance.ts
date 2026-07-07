import { useQuery } from '@tanstack/react-query'

/**
 * ECL allowance response from API
 */
export interface ECLAllowanceResponse {
  accountId: string
  /** Current ECL allowance amount */
  eclAmount: string
  /** Prior ECL amount (for comparison) */
  priorEclAmount?: string
  /** Change from prior ECL */
  eclChange?: string
  /** Carrying amount (principal + accrued) */
  carryingAmount: string
  /** Current aging bucket */
  bucket: string
  /** PD rate applied */
  pdRate: string
  /** Overlay multiplier applied */
  overlayMultiplier: string
  /** Loss given default rate */
  lgdRate: string
  /** Calculation timestamp */
  calculatedAt: string
  /** Event that triggered this calculation */
  triggeredBy?: ECLTrigger
  /** Recent ECL calculation history */
  history?: ECLHistoryEntry[]
  /** Full calculation breakdown */
  calculationBreakdown?: ECLCalculationBreakdown
  updatedAt: string
  _fallback?: boolean
}

/**
 * ECL trigger information
 */
export interface ECLTrigger {
  eventId: string
  eventType: string
  timestamp: string
  description: string
}

/**
 * ECL history entry
 */
export interface ECLHistoryEntry {
  calculatedAt: string
  eclAmount: string
  bucket: string
  pdRate: string
  carryingAmount: string
  triggeredBy: string
}

/**
 * Full ECL calculation breakdown for audit
 */
export interface ECLCalculationBreakdown {
  carryingAmount: string
  bucket: string
  pdRate: string
  overlayMultiplier: string
  lgdRate: string
  formula: string
  eclAmount: string
  calculatedAt: string
}

/**
 * Options for useECLAllowance hook
 */
export interface UseECLAllowanceOptions {
  /** Account ID to fetch ECL for */
  accountId: string
  /** Enable/disable the query (default: true) */
  enabled?: boolean
}

/**
 * Fetch ECL allowance from the API
 */
async function fetchECLAllowance(accountId: string): Promise<ECLAllowanceResponse> {
  const response = await fetch(`/api/ledger/ecl/${accountId}`)

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || 'Failed to fetch ECL allowance')
  }

  return response.json()
}

/**
 * Query key for ECL allowance
 */
export const eclAllowanceQueryKey = (accountId: string) => ['ecl-allowance', accountId] as const

/**
 * Hook to fetch ECL (Expected Credit Loss) allowance for an account.
 *
 * Features:
 * - Returns current ECL with calculation breakdown
 * - Includes prior ECL for delta comparison
 * - Shows trigger event information
 * - Provides recent ECL history
 * - Auto-refreshes every 60 seconds
 *
 * @example
 * ```tsx
 * const {
 *   eclAmount,
 *   eclChange,
 *   bucket,
 *   calculationBreakdown,
 *   isLoading,
 * } = useECLAllowance({ accountId: 'LA-00123456' })
 *
 * if (isLoading) return <Skeleton />
 *
 * return (
 *   <div>
 *     <h3>ECL Allowance</h3>
 *     <div className="ecl-amount">{formatCurrency(eclAmount)}</div>
 *     {eclChange && (
 *       <div className={parseFloat(eclChange) > 0 ? 'increase' : 'decrease'}>
 *         {formatCurrency(eclChange)} from prior
 *       </div>
 *     )}
 *     <div>Bucket: {bucket}</div>
 *   </div>
 * )
 * ```
 *
 * Story E2-S3: Create useECLAllowance Query Hook
 */
export function useECLAllowance(options: UseECLAllowanceOptions) {
  const { accountId, enabled = true } = options

  const query = useQuery({
    queryKey: eclAllowanceQueryKey(accountId),
    queryFn: () => fetchECLAllowance(accountId),
    enabled: enabled && !!accountId,
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchInterval: 60_000, // Refresh every 60s
  })

  // Calculate change direction for UI
  const eclChange = query.data?.eclChange
  const changeDirection =
    eclChange && parseFloat(eclChange) !== 0
      ? parseFloat(eclChange) > 0
        ? 'increase'
        : 'decrease'
      : 'unchanged'

  return {
    /** Current ECL allowance amount */
    eclAmount: query.data?.eclAmount ?? '0',
    /** Prior ECL amount */
    priorEclAmount: query.data?.priorEclAmount,
    /** Change from prior ECL */
    eclChange: query.data?.eclChange,
    /** Direction of change: 'increase', 'decrease', or 'unchanged' */
    changeDirection,
    /** Carrying amount used in calculation */
    carryingAmount: query.data?.carryingAmount ?? '0',
    /** Current aging bucket */
    bucket: query.data?.bucket ?? 'current',
    /** PD rate applied */
    pdRate: query.data?.pdRate ?? '0',
    /** Overlay multiplier applied */
    overlayMultiplier: query.data?.overlayMultiplier ?? '1',
    /** LGD rate applied */
    lgdRate: query.data?.lgdRate ?? '1',
    /** When ECL was calculated */
    calculatedAt: query.data?.calculatedAt,
    /** Event that triggered calculation */
    triggeredBy: query.data?.triggeredBy,
    /** Recent ECL history */
    history: query.data?.history ?? [],
    /** Full calculation breakdown */
    calculationBreakdown: query.data?.calculationBreakdown,
    /** When the data was last updated */
    updatedAt: query.data?.updatedAt,
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
