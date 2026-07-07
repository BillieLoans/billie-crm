import { useQuery } from '@tanstack/react-query'

/**
 * Overdue account from API response
 */
export interface OverdueAccount {
  accountId: string // GUID from ledger service
  accountNumber: string | null // Business account number from Payload
  customerIdString: string | null // Customer ID for navigation
  customerName: string | null // Customer name for display
  dpd: number
  bucket: string
  daysUntilOverdue: number
  totalOverdueAmount: string
  lastUpdated: string
  /**
   * Authoritative arrears flag from the aging service (aging-v1.1.0+).
   * Defaults to `false` when the ledger version doesn't supply it.
   */
  isInArrears?: boolean
}

/**
 * Overdue accounts response
 */
export interface OverdueAccountsResponse {
  accounts: OverdueAccount[]
  totalCount: number
  nextPageToken?: string
  _fallback?: boolean
}

/**
 * Filter options for overdue accounts query
 */
export interface OverdueAccountsFilters {
  /** Filter by aging bucket (e.g., "current", "early_arrears", "late_arrears", "default") */
  bucket?: string
  /** Minimum days past due */
  minDpd?: number
  /** Maximum days past due */
  maxDpd?: number
  /** Results per page (default: 100, max: 1000) */
  pageSize?: number
  /** Pagination token for next page */
  pageToken?: string
}

/**
 * Options for useOverdueAccounts hook
 */
export interface UseOverdueAccountsOptions extends OverdueAccountsFilters {
  /** Enable/disable the query (default: true) */
  enabled?: boolean
}

/**
 * Fetch overdue accounts from the API
 */
async function fetchOverdueAccounts(
  filters: OverdueAccountsFilters,
): Promise<OverdueAccountsResponse> {
  const params = new URLSearchParams()

  if (filters.bucket) params.set('bucket', filters.bucket)
  if (filters.minDpd !== undefined) params.set('minDpd', filters.minDpd.toString())
  if (filters.maxDpd !== undefined) params.set('maxDpd', filters.maxDpd.toString())
  if (filters.pageSize) params.set('pageSize', filters.pageSize.toString())
  if (filters.pageToken) params.set('pageToken', filters.pageToken)

  const queryString = params.toString()
  const url = `/api/ledger/aging/overdue${queryString ? `?${queryString}` : ''}`

  const response = await fetch(url)

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || 'Failed to fetch overdue accounts')
  }

  return response.json()
}

/**
 * Query key for overdue accounts
 */
export const overdueAccountsQueryKey = (filters: OverdueAccountsFilters) =>
  ['overdue-accounts', filters] as const

/**
 * Hook to fetch overdue accounts with filtering and pagination.
 *
 * Features:
 * - Filterable by bucket and DPD range
 * - Supports pagination via pageToken
 * - Auto-refreshes every 30 seconds
 * - Refetches on window focus
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useOverdueAccounts({
 *   bucket: 'late_arrears',
 *   minDpd: 30,
 *   pageSize: 50,
 * })
 *
 * if (isLoading) return <Skeleton />
 *
 * return (
 *   <Table>
 *     {data.accounts.map(account => (
 *       <Row key={account.accountId}>
 *         {account.accountId} - {account.dpd} DPD
 *       </Row>
 *     ))}
 *   </Table>
 * )
 * ```
 */
export function useOverdueAccounts(options: UseOverdueAccountsOptions = {}) {
  const { enabled = true, ...filters } = options

  const query = useQuery({
    queryKey: overdueAccountsQueryKey(filters),
    queryFn: () => fetchOverdueAccounts(filters),
    enabled,
    staleTime: 10_000, // 10 seconds
    refetchOnWindowFocus: true,
    refetchInterval: 30_000, // Refresh every 30s
  })

  return {
    /** Overdue accounts list */
    accounts: query.data?.accounts ?? [],
    /** Total count of matching accounts */
    totalCount: query.data?.totalCount ?? 0,
    /** Token for next page (if more results) */
    nextPageToken: query.data?.nextPageToken,
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
