'use client'

import { useQuery } from '@tanstack/react-query'
import type { ConversationDetail } from '@/lib/schemas/conversations'

async function fetchConversation(conversationId: string): Promise<ConversationDetail> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
    cache: 'no-store',
  })
  if (res.status === 404) throw new Error('NOT_FOUND')
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Conversation fetch failed: ${res.status}`)
  }
  const data = await res.json()
  return data.conversation
}

/**
 * React Query hook for conversation detail.
 * Polls every 3 seconds; pauses when tab is not focused (FR15).
 *
 * Story 3.1: ConversationDetailView with Split-Panel Layout
 */
export function useConversation(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => fetchConversation(conversationId!),
    enabled: !!conversationId,
    staleTime: 2_000,
    refetchInterval: 3_000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message === 'NOT_FOUND') return false
      return failureCount < 2
    },
  })
}
