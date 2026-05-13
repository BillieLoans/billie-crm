import { useQuery } from '@tanstack/react-query'
import type { LoanAccount } from '@/payload-types'
import { filtersToQueryString, type FiltersInput } from '@/lib/account-filters'

/**
 * Payload's canonical list response shape. Mirrors what
 * `payload.find({...})` returns and is identical to the shape used by
 * `usePendingApprovals`.
 */
export interface AccountsBrowserResponse {
  docs: LoanAccount[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

async function fetchAccountsBrowser(filters: FiltersInput): Promise<AccountsBrowserResponse> {
  const qs = filtersToQueryString(filters)
  const res = await fetch(`/api/loan-accounts/browse${qs ? `?${qs}` : ''}`)

  if (!res.ok) {
    let message = 'Failed to load accounts'
    try {
      const body = await res.json()
      message = body?.error?.message || message
    } catch {
      // body was not JSON — keep the default message
    }
    throw new Error(message)
  }

  return res.json()
}

/** Query key. Tuple form so changing any filter invalidates cache cleanly. */
export const accountsBrowserQueryKey = (filters: FiltersInput) =>
  ['accounts', 'browse', filters] as const

export interface UseAccountsBrowserOptions {
  filters: FiltersInput
  /** Enable/disable the query (default: true). */
  enabled?: boolean
}

/**
 * Fetch the Browse Accounts page for the given filters. Returns Payload's
 * list shape plus query state. Uses the global QueryClient defaults
 * (10s staleTime, refetch on focus).
 */
export function useAccountsBrowser(options: UseAccountsBrowserOptions) {
  const { filters, enabled = true } = options

  const query = useQuery({
    queryKey: accountsBrowserQueryKey(filters),
    queryFn: () => fetchAccountsBrowser(filters),
    enabled,
  })

  return {
    accounts: query.data?.docs ?? [],
    totalDocs: query.data?.totalDocs ?? 0,
    page: query.data?.page ?? 1,
    totalPages: query.data?.totalPages ?? 0,
    hasNextPage: query.data?.hasNextPage ?? false,
    hasPrevPage: query.data?.hasPrevPage ?? false,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  }
}
