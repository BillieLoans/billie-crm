/**
 * useCarryingAmountBreakdown
 *
 * React Query hook for fetching carrying amount breakdown from the Ledger service.
 * Provides detailed calculation inputs for audit verification.
 */

import { useQuery } from '@tanstack/react-query'

// =============================================================================
// Types
// =============================================================================

export interface CarryingAmountBreakdownResponse {
  accountId: string
  principalBalance: string
  accruedYield: string
  carryingAmount: string
  feeBalance: string
  disbursedPrincipal: string
  establishmentFee: string
  totalPaid: string
  lastAccrualDate: string
  daysAccrued: number
  termDays: number
  dailyAccrualRate: string
  calculationTimestamp: string
}

export interface UseCarryingAmountBreakdownOptions {
  /** Whether to enable the query */
  enabled?: boolean
}

// =============================================================================
// Query Key
// =============================================================================

export const carryingAmountBreakdownQueryKey = (accountId: string) => [
  'carrying-amount-breakdown',
  accountId,
]

// =============================================================================
// Fetcher
// =============================================================================

async function fetchCarryingAmountBreakdown(
  accountId: string,
): Promise<CarryingAmountBreakdownResponse | null> {
  const response = await fetch(
    `/api/investigation/carrying-amount/${encodeURIComponent(accountId)}`,
  )

  if (!response.ok) {
    if (response.status === 503) {
      console.warn('Ledger service unavailable for carrying amount breakdown')
      return null
    }
    throw new Error(`Failed to fetch carrying amount breakdown: ${response.statusText}`)
  }

  const data = await response.json()

  if (data._fallback || data.error) {
    return null
  }

  return data
}

// =============================================================================
// Hook
// =============================================================================

export function useCarryingAmountBreakdown(
  accountId: string | undefined,
  options: UseCarryingAmountBreakdownOptions = {},
) {
  const { enabled = true } = options

  const query = useQuery({
    queryKey: carryingAmountBreakdownQueryKey(accountId ?? ''),
    queryFn: () => fetchCarryingAmountBreakdown(accountId!),
    enabled: enabled && !!accountId,
    staleTime: 60_000, // 1 minute
  })

  return {
    breakdown: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isFallback: query.data === null && query.isSuccess,
  }
}
