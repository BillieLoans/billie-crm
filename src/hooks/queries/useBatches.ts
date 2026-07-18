'use client'

import { useQuery } from '@tanstack/react-query'
import type { Batch } from '@/payload-types'

export interface BatchesFilters {
  page?: number
  /** Single-batch lookup (campaign detail page). */
  batch_id?: string
}

/** Batch enriched server-side with its contact member count. */
export type BatchWithCount = Batch & { memberCount?: number }

export interface BatchesResponse {
  docs: BatchWithCount[]
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
  if (filters.batch_id) params.set('batch_id', filters.batch_id)
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

/**
 * Single campaign lookup for the detail page. Polls faster while the batch is
 * missing — a just-created campaign's projection may not have landed yet, and
 * the detail page shows a syncing state until it does.
 */
export function useBatch(batchId: string) {
  return useQuery({
    queryKey: batchesQueryKey({ batch_id: batchId }),
    queryFn: () => fetchBatches({ batch_id: batchId }),
    enabled: !!batchId,
    select: (res) => res.docs[0] ?? null,
    refetchInterval: (query) => (query.state.data?.docs?.length ? 30_000 : 3_000),
  })
}
