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
/**
 * Natural-key normalisation — exact TS mirror of the platform's
 * marketingService `normalise_mobile`/`normalise_email` (commands.py). The
 * duplicate pre-check in the New-contact flow must agree with the platform's
 * UpsertContact resolution, or the warning and the actual upsert diverge.
 */
const AU_MOBILE = /^\+61\d{9}$/

export function normaliseAuMobile(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/[^\d+]/g, '')
  let candidate: string
  if (digits.startsWith('+')) candidate = digits
  else if (digits.startsWith('61')) candidate = `+${digits}`
  else if (digits.startsWith('0') && digits.length === 10) candidate = `+61${digits.slice(1)}`
  else return null
  return AU_MOBILE.test(candidate) ? candidate : null
}

export function normaliseEmail(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim()
  return trimmed ? trimmed.toLowerCase() : null
}
