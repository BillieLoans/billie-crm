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
