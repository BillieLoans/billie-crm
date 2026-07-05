'use client'

import { useQuery } from '@tanstack/react-query'

export interface ContactReferrals {
  referrer: { contactId: string; firstName: string | null } | null
  referred: Array<{ contactId: string; firstName: string | null; derivedStage: string | null }>
  referredCount: number
}

async function fetchContactReferrals(contactId: string): Promise<ContactReferrals> {
  const res = await fetch(`/api/marketing/contacts/${encodeURIComponent(contactId)}/referrals`, {
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Referrals fetch failed: ${res.status}`)
  }
  return res.json()
}

/** Query key for a contact's referral graph. */
export const contactReferralsQueryKey = (contactId: string) =>
  ['marketing-contacts', 'referrals', contactId] as const

/** React Query hook for the contact-detail Referrals panel (B6). */
export function useContactReferrals(contactId: string) {
  return useQuery({
    queryKey: contactReferralsQueryKey(contactId),
    queryFn: () => fetchContactReferrals(contactId),
    enabled: !!contactId,
  })
}
