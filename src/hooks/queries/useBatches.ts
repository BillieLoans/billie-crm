'use client'

import { useQuery } from '@tanstack/react-query'
import type { Batch } from '@/payload-types'

export interface BatchesFilters {
  page?: number
}

export interface BatchesResponse {
  docs: Batch[]
  totalDocs: number
  totalPages: number
  page: number
  hasNextPage: boolean
  hasPrevPage: boolean
  limit: number
}

function buildQueryString(filters: BatchesFilters): string {
  const params = new URLSearchParams()
  if (filters.page) params.set('page', String(filters.page))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function fetchBatches(filters: BatchesFilters): Promise<BatchesResponse> {
  const res = await fetch(`/api/marketing/batches${buildQueryString(filters)}`, {
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Batches fetch failed: ${res.status}`)
  }
  return res.json()
}

/**
 * Query key for the marketing batches list. Exported so the create/assign
 * mutations can invalidate the batch picker.
 */
export const batchesQueryKey = (filters: BatchesFilters) =>
  ['marketing-batches', 'list', filters] as const

/** React Query hook for the marketing batches list (B6 batch picker). */
export function useBatches(filters: BatchesFilters = {}) {
  return useQuery({
    queryKey: batchesQueryKey(filters),
    queryFn: () => fetchBatches(filters),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  })
}
