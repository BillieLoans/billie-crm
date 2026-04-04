'use client'

import { useQuery } from '@tanstack/react-query'

async function fetchAssessment(conversationId: string, type: 'account-conduct' | 'serviceability') {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/assessments/${type}`,
    { cache: 'no-store' },
  )
  if (res.status === 404) return null
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Assessment fetch failed: ${res.status}`)
  }
  const data = await res.json()
  return data.assessment as Record<string, unknown>
}

/**
 * Hook for account conduct assessment detail.
 * staleTime: Infinity — assessment data is immutable once stored.
 *
 * Story 3.4: Credit Assessment Detail Pages (FR17)
 */
export function useAccountConductAssessment(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['assessment', 'account-conduct', conversationId],
    queryFn: () => fetchAssessment(conversationId!, 'account-conduct'),
    enabled: !!conversationId,
    staleTime: Infinity,
    retry: false,
  })
}

/**
 * Hook for serviceability assessment detail.
 * staleTime: Infinity — assessment data is immutable once stored.
 *
 * Story 3.4: Credit Assessment Detail Pages (FR18)
 */
export function useServiceabilityAssessment(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['assessment', 'serviceability', conversationId],
    queryFn: () => fetchAssessment(conversationId!, 'serviceability'),
    enabled: !!conversationId,
    staleTime: Infinity,
    retry: false,
  })
}
