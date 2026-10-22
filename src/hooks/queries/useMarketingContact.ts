'use client'

import { useQuery } from '@tanstack/react-query'
import type { Contact, ContactAuditLog, Interaction } from '@/payload-types'

export interface MarketingContactDetailResponse {
  contact: Contact
  interactions: Interaction[]
  audit: ContactAuditLog[]
}

export async function fetchMarketingContact(contactId: string): Promise<MarketingContactDetailResponse> {
  const res = await fetch(`/api/marketing/contacts/${encodeURIComponent(contactId)}`, {
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Marketing contact fetch failed: ${res.status}`)
  }
  return res.json()
}

/**
 * Query key for a single marketing contact detail (contact + interactions +
 * audit). Exported so command mutations (consent, interactions, erase) can
 * invalidate on state-changing actions.
 */
export const marketingContactQueryKey = (contactId: string) =>
  ['marketing-contacts', 'detail', contactId] as const

/**
 * React Query hook for the marketing contact detail view (Task C6). Polls
 * every 30 seconds; disabled until a contactId is available.
 */
export function useMarketingContact(contactId: string) {
  return useQuery({
    queryKey: marketingContactQueryKey(contactId),
    queryFn: () => fetchMarketingContact(contactId),
    enabled: !!contactId,
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  })
}
