'use client'

import { useQuery } from '@tanstack/react-query'
import type { CollectionsCaseRow, CollectionsCasesListResponse } from '@/types/collections'

async function fetchCollectionsCasesByCustomer(customerId: string): Promise<CollectionsCaseRow[]> {
  const params = new URLSearchParams()
  params.set('customerId', customerId)
  params.set('limit', '100')

  const res = await fetch(`/api/collections/cases?${params.toString()}`, {
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Collections cases fetch failed: ${res.status}`)
  }
  const data: CollectionsCasesListResponse = await res.json()
  return data.cases
}

/**
 * Query key for the per-customer collections cases list. Exported so WS5
 * mutations can invalidate on state-changing actions.
 */
export const collectionsCasesByCustomerQueryKey = (customerId: string | null) =>
  ['collections-cases', 'customer', customerId] as const

/**
 * React Query hook for collections cases belonging to a specific customer.
 * Used in customer/servicing views. Polls every 30 seconds.
 *
 * BTB-200 WS2
 */
export function useCollectionsCasesByCustomer(customerId: string | null) {
  const query = useQuery({
    queryKey: collectionsCasesByCustomerQueryKey(customerId),
    queryFn: () => fetchCollectionsCasesByCustomer(customerId as string),
    enabled: !!customerId,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  })

  return {
    cases: query.data ?? [],
    isLoading: query.isLoading,
  }
}
