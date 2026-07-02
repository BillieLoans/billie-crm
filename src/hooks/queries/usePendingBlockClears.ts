import { useQuery } from '@tanstack/react-query'
import { stringify } from 'qs-esm'

export interface BlockClearRequest {
  id: string
  /** Event correlation ID for the block-clear request workflow */
  requestId?: string
  requestNumber: string
  canonicalCustomerId: string
  customerName?: string
  conversationId?: string
  reasons: string[]
  justification: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  requestedAt?: string
  /** User who requested — can be a string ID or populated user object */
  requestedBy?:
    | string
    | { id: string | number; email?: string; firstName?: string; lastName?: string }
  requestedByName?: string
  createdAt: string
  updatedAt: string
}

interface PendingBlockClearsResponse {
  docs: BlockClearRequest[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export interface PendingBlockClearsOptions {
  page?: number
  limit?: number
  sort?: 'oldest' | 'newest'
  /** Enable/disable the query (default: true) */
  enabled?: boolean
}

async function fetchPendingBlockClears(
  options: PendingBlockClearsOptions = {},
): Promise<PendingBlockClearsResponse> {
  const { page = 1, limit = 20, sort = 'oldest' } = options

  // Map sort options to Payload sort format
  const sortMap: Record<string, string> = {
    oldest: 'createdAt', // ascending (oldest first - FIFO)
    newest: '-createdAt', // descending (newest first)
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

  const res = await fetch(`/api/reapplication-block-clear-requests${queryString}`)

  if (!res.ok) {
    throw new Error('Failed to fetch pending block-clear requests')
  }

  return res.json()
}

/**
 * Hook to fetch all pending reapplication block-clear requests for the approval queue.
 * Returns paginated results sorted by creation date (oldest first by default).
 * Auto-refreshes every 60 seconds.
 */
export function usePendingBlockClears(options: PendingBlockClearsOptions = {}) {
  const { enabled = true, ...queryOptions } = options

  return useQuery({
    queryKey: ['pending-block-clears', queryOptions],
    queryFn: () => fetchPendingBlockClears(queryOptions),
    staleTime: 30_000, // 30 seconds
    refetchInterval: enabled ? 60_000 : false, // Poll every 60 seconds for new requests
    enabled,
  })
}
