'use client'

import { useQuery } from '@tanstack/react-query'

export interface BatchPreflight {
  batchId: string
  memberCount: number
  willReceive: number
  skippedUnconsented: number
  skippedNeedsReview: number
  skippedErased: number
}

async function fetchBatchPreflight(batchId: string): Promise<BatchPreflight> {
  const res = await fetch(`/api/marketing/batches/${encodeURIComponent(batchId)}/preflight`, {
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Pre-flight fetch failed: ${res.status}`)
  }
  return res.json()
}

export const batchPreflightQueryKey = (batchId: string) =>
  ['marketing-batches', 'preflight', batchId] as const

/**
 * Pre-send audience summary for a campaign — who will actually receive an
 * invitation and why the rest are skipped. Fetched fresh (no stale cache)
 * whenever the send confirmation opens: the numbers ARE the decision.
 */
export function useBatchPreflight(batchId: string, enabled: boolean) {
  return useQuery({
    queryKey: batchPreflightQueryKey(batchId),
    queryFn: () => fetchBatchPreflight(batchId),
    enabled: enabled && !!batchId,
    staleTime: 0,
    gcTime: 0,
  })
}
