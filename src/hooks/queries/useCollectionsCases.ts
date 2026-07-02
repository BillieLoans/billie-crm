'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import type { CollectionsCasesListResponse } from '@/types/collections'

/**
 * Filters for the collections cases worklist (BTB-200 WS2).
 * Booleans are only serialized onto the querystring when `true` — matches
 * the `GET /api/collections/cases` route contract
 * (`src/app/api/collections/cases/route.ts`), which only filters on
 * `hardshipPaused === 'true'` / `stoppedContact === 'true'`.
 */
export interface CollectionsCasesFilters {
  state?: 'open' | 'awaiting_human' | 'cured'
  rung?: number
  hardshipPaused?: boolean
  stoppedContact?: boolean
}

async function fetchCollectionsCases(
  filters: CollectionsCasesFilters,
  page: number,
): Promise<CollectionsCasesListResponse> {
  const params = new URLSearchParams()
  if (filters.state) params.set('state', filters.state)
  if (filters.rung !== undefined) params.set('rung', String(filters.rung))
  if (filters.hardshipPaused) params.set('hardshipPaused', 'true')
  if (filters.stoppedContact) params.set('stoppedContact', 'true')
  params.set('page', String(page))

  const res = await fetch(`/api/collections/cases?${params.toString()}`, {
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Collections cases fetch failed: ${res.status}`)
  }
  return res.json()
}

/**
 * Query key for the collections cases worklist. Exported so WS5 mutations
 * can invalidate on state-changing actions (rung advance, hardship pause,
 * stop-contact, etc.).
 */
export const collectionsCasesQueryKey = (filters: CollectionsCasesFilters) =>
  ['collections-cases', filters] as const

/**
 * React Query hook for the collections case worklist.
 * Page-number pagination via `useInfiniteQuery`; polls every 30 seconds.
 *
 * BTB-200 WS2
 */
export function useCollectionsCases(filters: CollectionsCasesFilters) {
  const query = useInfiniteQuery({
    queryKey: collectionsCasesQueryKey(filters),
    queryFn: ({ pageParam }) => fetchCollectionsCases(filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasNextPage ? lastPage.page + 1 : undefined),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  })

  const pages = query.data?.pages ?? []
  const cases = pages.flatMap((p) => p.cases)
  const lastPage = pages[pages.length - 1]

  // Any fetched page degraded → flag, since its rows remain in the list (flatMap above).
  const agingUnavailable = pages.some((p) => p.agingUnavailable)

  return {
    cases,
    totalDocs: lastPage?.totalDocs ?? 0,
    agingUnavailable,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  }
}
