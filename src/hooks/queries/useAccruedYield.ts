import { useQuery } from '@tanstack/react-query'

/**
 * Accrued yield response from API
 */
export interface AccruedYieldResponse {
  accountId: string
  /** Total accrued yield to date */
  accruedAmount: string
  /** Remaining yield to be recognized */
  remainingAmount: string
  /** Total fee amount from disbursement */
  totalFeeAmount: string
  /** Loan term in days */
  termDays: number
  /** Days accrued so far */
  daysAccrued: number
  /** Daily accrual rate */
  dailyRate: string
  /** Date of last accrual event */
  lastAccrualDate?: string
  /** Accrual start date (disbursement date) */
  accrualStartDate: string
  /** Accrual end date (maturity date) */
  accrualEndDate: string
  /** Calculation breakdown for audit */
  calculationBreakdown?: AccrualCalculationBreakdown
  updatedAt: string
  _fallback?: boolean
}

/**
 * Detailed accrual calculation breakdown
 */
export interface AccrualCalculationBreakdown {
  feeAmount: string
  termDays: number
  dailyRate: string
  daysAccrued: number
  accruedAmount: string
  formula: string
}

/**
 * Accrual event from history
 */
export interface AccrualEvent {
  eventId: string
  eventType: string
  timestamp: string
  accrualDate: string // Date of the accrual (YYYY-MM-DD format)
  amount: string
  cumulativeAmount: string
  dayNumber: number
}

/**
 * Accrual history response
 */
export interface AccrualHistoryResponse {
  accountId: string
  events: AccrualEvent[]
  totalEvents: number
  /** Dates where accruals are missing (gaps in sequence) */
  missingDates?: string[]
  /** Whether gaps exist in the accrual sequence */
  hasGaps?: boolean
  /** Number of events excluded by date filters (e.g., future events) */
  filteredCount?: number
  _fallback?: boolean
}

/**
 * Options for useAccruedYield hook
 */
export interface UseAccruedYieldOptions {
  /** Account ID to fetch accrued yield for */
  accountId: string
  /** Enable/disable the query (default: true) */
  enabled?: boolean
}

/**
 * Options for useAccrualHistory hook
 */
export interface UseAccrualHistoryOptions {
  /** Account ID to fetch history for */
  accountId: string
  /** Maximum number of events to return */
  limit?: number
  /** Enable/disable the query (default: true) */
  enabled?: boolean
}

/**
 * Fetch accrued yield from the API
 */
async function fetchAccruedYield(accountId: string): Promise<AccruedYieldResponse> {
  const response = await fetch(`/api/ledger/accrual/${accountId}`)

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || 'Failed to fetch accrued yield')
  }

  return response.json()
}

/**
 * Fetch accrual event history from the API
 */
async function fetchAccrualHistory(
  accountId: string,
  limit?: number,
): Promise<AccrualHistoryResponse> {
  const url = limit
    ? `/api/ledger/accrual/${accountId}/history?limit=${limit}`
    : `/api/ledger/accrual/${accountId}/history`

  const response = await fetch(url)

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || 'Failed to fetch accrual history')
  }

  return response.json()
}

/**
 * Query key for accrued yield
 */
export const accruedYieldQueryKey = (accountId: string) =>
  ['accrued-yield', accountId] as const

/**
 * Query key for accrual history
 */
export const accrualHistoryQueryKey = (accountId: string, limit?: number) =>
  ['accrual-history', accountId, limit] as const

/**
 * Hook to fetch accrued yield (revenue recognition) for an account.
 *
 * Features:
 * - Returns current accrued yield and remaining
 * - Includes calculation breakdown for audit
 * - Progress tracking (days accrued / term days)
 * - Auto-refreshes every 60 seconds
 *
 * @example
 * ```tsx
 * const { accruedAmount, remainingAmount, progress, isLoading } = useAccruedYield({
 *   accountId: 'LA-00123456',
 * })
 *
 * if (isLoading) return <Skeleton />
 *
 * return (
 *   <div>
 *     <div>Accrued: {formatCurrency(accruedAmount)}</div>
 *     <div>Remaining: {formatCurrency(remainingAmount)}</div>
 *     <ProgressBar value={progress} />
 *   </div>
 * )
 * ```
 *
 * Story E2-S2: Create useAccruedYield Query Hook
 */
export function useAccruedYield(options: UseAccruedYieldOptions) {
  const { accountId, enabled = true } = options

  const query = useQuery({
    queryKey: accruedYieldQueryKey(accountId),
    queryFn: () => fetchAccruedYield(accountId),
    enabled: enabled && !!accountId,
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchInterval: 60_000, // Refresh every 60s
  })

  // Calculate progress percentage
  const daysAccrued = query.data?.daysAccrued ?? 0
  const termDays = query.data?.termDays ?? 1
  const progress = Math.min((daysAccrued / termDays) * 100, 100)

  return {
    /** Total accrued yield amount */
    accruedAmount: query.data?.accruedAmount ?? '0',
    /** Remaining yield to be recognized */
    remainingAmount: query.data?.remainingAmount ?? '0',
    /** Total fee amount from disbursement */
    totalFeeAmount: query.data?.totalFeeAmount ?? '0',
    /** Loan term in days */
    termDays: query.data?.termDays ?? 1,
    /** Days accrued so far */
    daysAccrued: query.data?.daysAccrued ?? 0,
    /** Daily accrual rate */
    dailyRate: query.data?.dailyRate ?? '0',
    /** Progress percentage (0-100) */
    progress,
    /** Date of last accrual event */
    lastAccrualDate: query.data?.lastAccrualDate,
    /** Accrual start date */
    accrualStartDate: query.data?.accrualStartDate,
    /** Accrual end date */
    accrualEndDate: query.data?.accrualEndDate,
    /** Calculation breakdown for audit */
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

/**
 * Hook to fetch accrual event history for an account.
 *
 * @example
 * ```tsx
 * const { events, isLoading } = useAccrualHistory({
 *   accountId: 'LA-00123456',
 *   limit: 10,
 * })
 *
 * if (isLoading) return <Skeleton />
 *
 * return (
 *   <Timeline>
 *     {events.map(event => (
 *       <TimelineEvent key={event.eventId}>
 *         Day {event.dayNumber}: {formatCurrency(event.amount)}
 *       </TimelineEvent>
 *     ))}
 *   </Timeline>
 * )
 * ```
 */
export function useAccrualHistory(options: UseAccrualHistoryOptions) {
  const { accountId, limit, enabled = true } = options

  const query = useQuery({
    queryKey: accrualHistoryQueryKey(accountId, limit),
    queryFn: () => fetchAccrualHistory(accountId, limit),
    enabled: enabled && !!accountId,
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: true,
  })

  return {
    /** Accrual events */
    events: query.data?.events ?? [],
    /** Total number of events */
    totalEvents: query.data?.totalEvents ?? 0,
    /** Dates where accruals are missing (gaps in sequence) */
    missingDates: query.data?.missingDates ?? [],
    /** Whether gaps exist in the accrual sequence */
    hasGaps: query.data?.hasGaps ?? false,
    /** Number of events excluded by date filters */
    filteredCount: query.data?.filteredCount ?? 0,
    /** Whether data is from fallback */
    isFallback: query.data?._fallback ?? false,
    /** Whether the initial load is in progress */
    isLoading: query.isLoading,
    /** Whether a refetch is in progress */
    isFetching: query.isFetching,
    /** Error if the fetch failed */
    error: query.error,
    /** Force a refetch */
    refetch: query.refetch,
    /** Full query result */
    query,
  }
}
