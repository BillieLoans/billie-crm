/**
 * useScheduleWithStatus
 *
 * React Query hook for fetching schedule with instalment status from the Ledger service.
 * Returns typed schedule data with PENDING/PARTIAL/PAID/OVERDUE status per instalment.
 */

import { useQuery } from '@tanstack/react-query'

// =============================================================================
// Types
// =============================================================================

export interface InstalmentWithStatus {
  paymentNumber: number
  dueDate: string
  scheduledAmount: string
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE'
  amountPaid: string
  amountRemaining: string
  paidDate?: string
  linkedTransactionIds: string[]
  lastUpdated?: string
}

export interface ScheduleSummary {
  totalInstalments: number
  paidCount: number
  partialCount: number
  overdueCount: number
  pendingCount: number
  nextDueDate?: string
  nextDueAmount?: string
  totalScheduled: string
  totalPaid: string
  totalRemaining: string
}

export interface ScheduleWithStatusResponse {
  scheduleId: string
  loanAccountId: string
  customerId: string
  applicationNumber: string
  instalments: InstalmentWithStatus[]
  summary: ScheduleSummary
}

export interface UseScheduleWithStatusOptions {
  /** Whether to enable the query */
  enabled?: boolean
  /** Refetch interval in ms (defaults to disabled) */
  refetchInterval?: number
}

// =============================================================================
// Query Key
// =============================================================================

export const scheduleWithStatusQueryKey = (accountId: string) => ['schedule-with-status', accountId]

// =============================================================================
// Fetcher
// =============================================================================

async function fetchScheduleWithStatus(
  accountId: string,
): Promise<ScheduleWithStatusResponse | null> {
  const response = await fetch(`/api/ledger/schedule/${encodeURIComponent(accountId)}`)

  if (!response.ok) {
    if (response.status === 503) {
      // Service unavailable - return null to indicate fallback
      console.warn('Ledger service unavailable for schedule')
      return null
    }
    throw new Error(`Failed to fetch schedule: ${response.statusText}`)
  }

  const data = await response.json()

  // Check for fallback indicator
  if (data._fallback) {
    return null
  }

  return data
}

// =============================================================================
// Hook
// =============================================================================

export function useScheduleWithStatus(
  accountId: string | undefined,
  options: UseScheduleWithStatusOptions = {},
) {
  const { enabled = true, refetchInterval } = options

  const query = useQuery({
    queryKey: scheduleWithStatusQueryKey(accountId ?? ''),
    queryFn: () => fetchScheduleWithStatus(accountId!),
    enabled: enabled && !!accountId,
    staleTime: 30_000, // 30 seconds
    refetchInterval,
  })

  return {
    schedule: query.data ?? null,
    instalments: query.data?.instalments ?? [],
    summary: query.data?.summary ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    /** True if data came from fallback (service unavailable) */
    isFallback: query.data === null && query.isSuccess,
  }
}
