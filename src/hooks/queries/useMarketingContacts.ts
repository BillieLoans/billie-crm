'use client'

import { useQuery } from '@tanstack/react-query'
import type { Contact } from '@/payload-types'

export interface MarketingContactsFilters {
  q?: string
  stage?: string
  source?: string
  city?: string
  batch?: string
  needs_review?: string
  advisory_council?: string
  loan_status?: string
  page?: number
}

export interface MarketingContactsResponse {
  docs: Contact[]
  totalDocs: number
  totalPages: number
  page: number
  hasNextPage: boolean
  hasPrevPage: boolean
  limit: number
}

function buildQueryString(filters: MarketingContactsFilters): string {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.stage) params.set('stage', filters.stage)
  if (filters.source) params.set('source', filters.source)
  if (filters.city) params.set('city', filters.city)
  if (filters.batch) params.set('batch', filters.batch)
  if (filters.needs_review) params.set('needs_review', filters.needs_review)
  if (filters.advisory_council) params.set('advisory_council', filters.advisory_council)
  if (filters.loan_status) params.set('loan_status', filters.loan_status)
  if (filters.page) params.set('page', String(filters.page))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function fetchMarketingContacts(
  filters: MarketingContactsFilters,
): Promise<MarketingContactsResponse> {
  const res = await fetch(`/api/marketing/contacts${buildQueryString(filters)}`, {
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Marketing contacts fetch failed: ${res.status}`)
  }
  return res.json()
}

/**
 * Query key for the marketing contacts list. Exported so filter changes and
 * command mutations (consent, interactions) can invalidate the grid.
 */
export const marketingContactsQueryKey = (filters: MarketingContactsFilters) =>
  ['marketing-contacts', 'list', filters] as const

/**
 * React Query hook for the marketing contacts grid (Task C6). Polls every 30
 * seconds and keeps the previous page's rows visible while a new page loads
 * (`placeholderData`) so filter/pagination changes don't flash empty.
 */
export function useMarketingContacts(filters: MarketingContactsFilters = {}) {
  return useQuery({
    queryKey: marketingContactsQueryKey(filters),
    queryFn: () => fetchMarketingContacts(filters),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  })
}
