'use client'

import { useQuery } from '@tanstack/react-query'
import type { Feedback } from '@/payload-types'

export interface FeedbackQueueFilters {
  /** Triage status — includes the synthetic `open` (= not resolved). */
  status?: string
  /** Feedback type substring match (e.g. `complaint`). */
  type?: string
  /** Unresolved complaints older than the IDR threshold. */
  overdue?: string
  product_area?: string
  contact_id?: string
  page?: number
}

/** Feedback row enriched server-side with the contact's name (GET route). */
export type FeedbackWithContact = Feedback & { contactName?: string | null }

export interface FeedbackQueueResponse {
  docs: FeedbackWithContact[]
  totalDocs: number
  totalPages: number
  page: number
  hasNextPage: boolean
  hasPrevPage: boolean
  limit: number
}

function buildQueryString(filters: FeedbackQueueFilters): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.type) params.set('type', filters.type)
  if (filters.overdue) params.set('overdue', filters.overdue)
  if (filters.product_area) params.set('product_area', filters.product_area)
  if (filters.contact_id) params.set('contact_id', filters.contact_id)
  if (filters.page) params.set('page', String(filters.page))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function fetchFeedbackQueue(filters: FeedbackQueueFilters): Promise<FeedbackQueueResponse> {
  const res = await fetch(`/api/marketing/feedback${buildQueryString(filters)}`, {
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Feedback fetch failed: ${res.status}`)
  }
  return res.json()
}

/**
 * Query key for the marketing feedback queue. Exported so the status mutation
 * can invalidate the queue.
 */
export const feedbackQueueQueryKey = (filters: FeedbackQueueFilters) =>
  ['marketing-feedback', 'list', filters] as const

/** React Query hook for the marketing feedback queue (B6). */
export function useFeedbackQueue(filters: FeedbackQueueFilters = {}) {
  return useQuery({
    queryKey: feedbackQueueQueryKey(filters),
    queryFn: () => fetchFeedbackQueue(filters),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  })
}
