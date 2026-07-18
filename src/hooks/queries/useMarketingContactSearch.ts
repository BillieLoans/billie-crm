'use client'

import { useQuery } from '@tanstack/react-query'
import { useDeferredValue } from 'react'
import type { Contact } from '@/payload-types'

export interface MarketingContactHit {
  contactId: string
  firstName: string | null
  email: string | null
  mobileE164: string | null
  derivedStage: string | null
}

async function searchMarketingContacts(query: string): Promise<MarketingContactHit[]> {
  if (query.length < 3) return []
  const res = await fetch(`/api/marketing/contacts?q=${encodeURIComponent(query)}`, {
    credentials: 'include',
  })
  // Quietly return nothing for users without marketing access — the palette
  // simply omits the group rather than toasting an error at every keystroke.
  if (res.status === 401 || res.status === 403) return []
  if (!res.ok) throw new Error('Contact search failed')
  const data = (await res.json()) as { docs?: Contact[] }
  return (data.docs ?? []).slice(0, 8).map((c) => ({
    contactId: c.contactId,
    firstName: c.firstName ?? null,
    email: c.email ?? null,
    mobileE164: c.mobileE164 ?? null,
    derivedStage: c.derivedStage ?? null,
  }))
}

/**
 * Marketing-contact source for the global command palette — leads and
 * waitlisted people are findable from Cmd+K just like customers.
 */
export function useMarketingContactSearch(query: string) {
  const deferredQuery = useDeferredValue(query)

  return useQuery({
    queryKey: ['marketing-contact-search', deferredQuery],
    queryFn: () => searchMarketingContacts(deferredQuery),
    enabled: deferredQuery.length >= 3,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  })
}
