'use client'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type {
  ConversationSummary,
  ConversationsListResponse,
  ConversationsQuery,
} from '@/lib/schemas/conversations'

async function fetchConversations(
  params: Partial<ConversationsQuery>,
): Promise<ConversationsListResponse> {
  const searchParams = new URLSearchParams()
  if (params.status) searchParams.set('status', params.status)
  if (params.decision) searchParams.set('decision', params.decision)
  if (params.from) searchParams.set('from', params.from)
  if (params.to) searchParams.set('to', params.to)
  if (params.q) searchParams.set('q', params.q)
  if (params.limit) searchParams.set('limit', String(params.limit))
  if (params.cursor) searchParams.set('cursor', params.cursor)

  const res = await fetch(`/api/conversations?${searchParams.toString()}`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Conversations fetch failed: ${res.status}`)
  }
  return res.json()
}

interface UseConversationsOptions {
  filters?: Partial<ConversationsQuery>
  enabled?: boolean
}

export interface UseConversationsResult {
  data: {
    conversations: ConversationSummary[]
    hasMore: boolean
    total: number
  }
  isLoading: boolean
  isError: boolean
  error: Error | null
  dataUpdatedAt: number
  fetchNextPage: () => Promise<unknown>
  isFetchingNextPage: boolean
}

/**
 * React Query hook for the conversation monitoring grid.
 * Polls every 5 seconds; pauses when tab is not focused (NFR4).
 * Uses infinite query for cursor-based "Load more" pagination.
 */
export function useConversations({
  filters = {},
  enabled = true,
}: UseConversationsOptions = {}): UseConversationsResult {
  const query = useInfiniteQuery({
    queryKey: ['conversations', filters],
    queryFn: ({ pageParam }) => fetchConversations({ ...filters, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.cursor : undefined),
    enabled,
    staleTime: 4_000,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  })

  const pages = query.data?.pages ?? []
  const conversations = pages.flatMap((p) => p.conversations)
  const lastPage = pages[pages.length - 1]

  return {
    data: {
      conversations,
      hasMore: lastPage?.hasMore ?? false,
      total: pages[0]?.total ?? 0,
    },
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
    dataUpdatedAt: query.dataUpdatedAt,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  }
}

/**
 * React Query hook for conversations belonging to a specific customer.
 * Used in the ServicingView ApplicationsPanel. Polls every 30 seconds.
 *
 * Story 4.1: ApplicationsPanel in ServicingView
 */
export function useCustomerConversations(customerIdString: string | undefined) {
  return useQuery({
    queryKey: ['conversations', 'customer', customerIdString],
    queryFn: () => fetchConversations({ q: customerIdString, limit: 20 }),
    enabled: !!customerIdString,
    staleTime: 25_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  })
}
