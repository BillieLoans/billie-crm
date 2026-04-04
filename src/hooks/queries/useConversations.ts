'use client'

import { useQuery } from '@tanstack/react-query'
import type { ConversationsListResponse, ConversationsQuery } from '@/lib/schemas/conversations'

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
  cursor?: string
  enabled?: boolean
}

/**
 * React Query hook for the conversation monitoring grid.
 * Polls every 5 seconds; pauses when tab is not focused (NFR4).
 *
 * Story 2.3: Monitoring Grid with Real-Time Polling (FR3)
 */
export function useConversations({ filters = {}, cursor, enabled = true }: UseConversationsOptions = {}) {
  return useQuery({
    queryKey: ['conversations', filters, cursor],
    queryFn: () => fetchConversations({ ...filters, cursor }),
    enabled,
    staleTime: 4_000,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false, // Stop polling when tab is not focused
    placeholderData: (prev) => prev,
  })
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
    queryFn: () =>
      fetchConversations({ q: customerIdString, limit: 20 }),
    enabled: !!customerIdString,
    staleTime: 25_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  })
}
