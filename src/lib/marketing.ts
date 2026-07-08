import type { Contact } from '@/payload-types'

/** Best-effort read of `consent.marketing.granted` from the untyped JSON column. */
export function getMarketingConsentGranted(consent: Contact['consent']): boolean | null {
  if (consent && typeof consent === 'object' && !Array.isArray(consent)) {
    const marketing = (consent as Record<string, unknown>).marketing
    if (marketing && typeof marketing === 'object' && !Array.isArray(marketing)) {
      const granted = (marketing as Record<string, unknown>).granted
      if (typeof granted === 'boolean') return granted
    }
  }
  return null
}

export type SiblingBasis = 'same_customer' | 'same_mobile' | 'same_email'

interface NaturalKeys {
  customerId?: string | null
  mobileE164?: string | null
  email?: string | null
}

/**
 * Why two contact records are considered the same person. Order is the
 * display order: customer link is the strongest signal, then mobile, then
 * email. Empty result means "not the same person" — callers should have
 * pre-filtered, but the helper stays honest about it.
 */
export function siblingBases(contact: NaturalKeys, candidate: NaturalKeys): SiblingBasis[] {
  const bases: SiblingBasis[] = []
  if (contact.customerId && candidate.customerId === contact.customerId) bases.push('same_customer')
  if (contact.mobileE164 && candidate.mobileE164 === contact.mobileE164) bases.push('same_mobile')
  if (contact.email && candidate.email === contact.email) bases.push('same_email')
  return bases
}
