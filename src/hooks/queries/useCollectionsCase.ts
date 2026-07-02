'use client'

import { useQuery } from '@tanstack/react-query'
import type { CollectionsCaseRow } from '@/types/collections'

async function fetchCollectionsCase(accountId: string): Promise<CollectionsCaseRow | null> {
  const res = await fetch(`/api/collections/cases/${encodeURIComponent(accountId)}`, {
    credentials: 'include',
  })
  // 404 means "no collections case for this account" — a normal, non-error
  // state (most accounts are never delinquent), so resolve to null rather
  // than surfacing a query error.
  if (res.status === 404) return null
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Collections case fetch failed: ${res.status}`)
  }
  const data = await res.json()
  return data.case
}

/**
 * Query key for a single collections case detail. Exported so WS5 mutations
 * can invalidate on state-changing actions.
 */
export const collectionsCaseQueryKey = (accountId: string | null) =>
  ['collections-cases', 'detail', accountId] as const

/**
 * React Query hook for a single collections case detail.
 * Polls every 30 seconds. Returns `null` (not an error) when the account
 * has no collections case (404).
 *
 * BTB-200 WS2
 */
export function useCollectionsCase(accountId: string | null) {
  return useQuery({
    queryKey: collectionsCaseQueryKey(accountId),
    queryFn: () => fetchCollectionsCase(accountId as string),
    enabled: !!accountId,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  })
}
