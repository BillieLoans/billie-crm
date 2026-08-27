'use client'

import { useQuery } from '@tanstack/react-query'
import type { LlmCostsResponse } from '@/lib/llm-costs'

async function fetchLlmCosts(conversationId: string): Promise<LlmCostsResponse> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/llm-costs`, {
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `LLM costs fetch failed: ${res.status}`)
  }
  return res.json()
}

/**
 * React Query hook for the per-conversation LLM cost roll-up (BTB-302).
 * Supervisor/admin only — callers gate rendering on hasApprovalAuthority so
 * the request is never issued for other roles.
 *
 * Costs keep accruing while a conversation is live, so refetch gently (30s)
 * rather than at the transcript's 3s cadence.
 */
export function useLlmCosts(conversationId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['llm-costs', conversationId],
    queryFn: () => fetchLlmCosts(conversationId!),
    enabled: !!conversationId && enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
    retry: 1,
  })
}
