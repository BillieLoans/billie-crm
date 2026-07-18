'use client'

import { useQuery } from '@tanstack/react-query'

export interface MarketingOverview {
  totalContacts: number
  funnel: Array<{ stage: string; count: number }>
  consented: number
  openFeedback: number
  overdueComplaints: number
}

async function fetchMarketingOverview(): Promise<MarketingOverview> {
  const res = await fetch('/api/marketing/overview', { credentials: 'include' })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Marketing overview fetch failed: ${res.status}`)
  }
  return res.json()
}

export const marketingOverviewQueryKey = ['marketing-overview'] as const

/**
 * Aggregate counts for the marketing landing strip and the sub-nav's feedback
 * badge. One shared query so the strip and every tab bar reuse the same
 * cache entry.
 */
export function useMarketingOverview() {
  return useQuery({
    queryKey: marketingOverviewQueryKey,
    queryFn: fetchMarketingOverview,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
