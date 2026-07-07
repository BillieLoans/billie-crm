import { useQuery } from '@tanstack/react-query'
import { stringify } from 'qs-esm'

export interface WriteOffApproval {
  id: string
  /** Event correlation ID for the write-off request workflow */
  requestId?: string
  /** Unique event ID for polling (from cause field) */
  eventId?: string
  requestNumber: string
  loanAccountId: string
  customerId: string
  customerName?: string
  accountNumber?: string
  amount: number
  originalBalance: number
  reason: string
  notes?: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  priority: 'normal' | 'urgent' | 'low'
  requiresSeniorApproval: boolean
  requestedAt: string
  /** User who requested - can be a string ID or populated user object */
  requestedBy?:
    | string
    | { id: string | number; email?: string; firstName?: string; lastName?: string }
  requestedByName?: string
  createdAt: string
  updatedAt: string
}

interface PendingApprovalsResponse {
  docs: WriteOffApproval[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export interface PendingApprovalsOptions {
  page?: number
  limit?: number
  sort?: 'oldest' | 'newest' | 'amount-high' | 'amount-low'
  /** Enable/disable the query (default: true) */
  enabled?: boolean
}

async function fetchPendingApprovals(
  options: PendingApprovalsOptions = {},
): Promise<PendingApprovalsResponse> {
  const { page = 1, limit = 20, sort = 'oldest' } = options

  // Map sort options to Payload sort format
  const sortMap: Record<string, string> = {
    oldest: 'createdAt', // ascending (oldest first - FIFO)
    newest: '-createdAt', // descending (newest first)
    'amount-high': '-amount', // descending (highest first)
    'amount-low': 'amount', // ascending (lowest first)
  }

  const queryString = stringify(
    {
      where: {
        status: { equals: 'pending' },
      },
      limit,
      page,
      sort: sortMap[sort] || 'createdAt',
    },
    { addQueryPrefix: true },
  )

  const res = await fetch(`/api/write-off-requests${queryString}`)

  if (!res.ok) {
    throw new Error('Failed to fetch pending approvals')
  }

  return res.json()
}

/**
 * Query key for pending approvals list
 */
export const pendingApprovalsQueryKey = (options: PendingApprovalsOptions = {}) =>
  ['write-off-requests', 'pending', 'list', options] as const

/**
 * Hook to fetch all pending write-off requests for the approval queue.
 * Returns paginated results sorted by creation date (oldest first by default).
 */
export function usePendingApprovals(options: PendingApprovalsOptions = {}) {
  const { enabled = true, ...queryOptions } = options

  return useQuery({
    queryKey: pendingApprovalsQueryKey(queryOptions),
    queryFn: () => fetchPendingApprovals(queryOptions),
    staleTime: 30_000, // 30 seconds - approvals queue can be slightly stale
    refetchInterval: enabled ? 60_000 : false, // Poll every 60 seconds for new requests
    enabled,
  })
}
