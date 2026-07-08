'use client'

import { useQuery } from '@tanstack/react-query'

export type SiblingBasis = 'same_customer' | 'same_mobile' | 'same_email'

export interface IdentitySibling {
  contactId: string
  firstName: string | null
  mobileE164: string | null
  email: string | null
  derivedStage: string | null
  customerId: string | null
  bases: SiblingBasis[]
}

export interface ContactIdentity {
  contactId: string
  customerId: string | null
  siblings: IdentitySibling[]
}

async function fetchContactIdentity(contactId: string): Promise<ContactIdentity> {
  const res = await fetch(`/api/marketing/contacts/${encodeURIComponent(contactId)}/identity`, {
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Identity fetch failed: ${res.status}`)
  }
  return res.json()
}

/** Query key for a contact's identity graph (sibling records). */
export const contactIdentityQueryKey = (contactId: string) =>
  ['marketing-contacts', 'identity', contactId] as const

/** React Query hook for the contact-detail "Same person" panel. */
export function useContactIdentity(contactId: string) {
  return useQuery({
    queryKey: contactIdentityQueryKey(contactId),
    queryFn: () => fetchContactIdentity(contactId),
    enabled: !!contactId,
  })
}
