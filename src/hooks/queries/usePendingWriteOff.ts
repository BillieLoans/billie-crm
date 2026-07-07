import { useQuery } from '@tanstack/react-query'
import { stringify } from 'qs-esm'

export interface PendingWriteOffData {
  id: string
  requestNumber: string
  amount: number
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  requiresSeniorApproval: boolean
  createdAt: string
  requestedByName?: string
}

interface WriteOffRequestsResponse {
  docs: PendingWriteOffData[]
  totalDocs: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

async function fetchPendingWriteOff(loanAccountId: string): Promise<PendingWriteOffData | null> {
  // Use qs-esm to properly serialize Payload REST API where queries
  const queryString = stringify(
    {
      where: {
        and: [{ loanAccountId: { equals: loanAccountId } }, { status: { equals: 'pending' } }],
      },
      limit: 1,
      sort: '-createdAt',
    },
    { addQueryPrefix: true },
  )

  const res = await fetch(`/api/write-off-requests${queryString}`)

  if (!res.ok) {
    throw new Error('Failed to fetch write-off requests')
  }

  const data: WriteOffRequestsResponse = await res.json()
  return data.docs[0] || null
}

/**
 * Query key for pending write-off by account
 */
export const pendingWriteOffQueryKey = (loanAccountId: string) =>
  ['write-off-requests', 'pending', loanAccountId] as const

/**
 * Hook to check if there's a pending write-off request for an account.
 */
export function usePendingWriteOff(loanAccountId: string | null) {
  return useQuery({
    queryKey: pendingWriteOffQueryKey(loanAccountId ?? ''),
    queryFn: () => fetchPendingWriteOff(loanAccountId!),
    enabled: !!loanAccountId,
    staleTime: 60_000, // 1 minute
  })
}
