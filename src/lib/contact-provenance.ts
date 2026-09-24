/**
 * Contact provenance — what the platform customerService says about a
 * customer's contact values (customers SDK 3.x, projected by the event
 * processor onto `customers`; BTB-392).
 *
 * The CRM renders provenance; it never decides which value is right. The
 * survivorship tier ranks a value's proof (BOUND > VERIFIED > ASSERTED), the
 * source says how it got there, and `contacts` lists every known value with
 * exactly one primary per type (the primary equals the flat email / mobile).
 */

export type ContactTier = 'BOUND' | 'VERIFIED' | 'ASSERTED'
export type ContactType = 'EMAIL' | 'MOBILE'

/** One entry of the SDK's `ContactRecord` list, stored verbatim. */
export interface ContactRecord {
  contact_type: ContactType | string
  value: string
  tier: ContactTier | string
  source?: string | null
  is_primary?: boolean | null
  verified_at?: string | null
  first_seen_at?: string | null
  last_seen_at?: string | null
  origin_customer_id?: string | null
  evidence_event_id?: string | null
}

/** The provenance columns the customer API returns beside the flat contacts. */
export interface ContactProvenanceFields {
  canonicalId?: string | null
  customerIdStatus?: string | null
  emailTier?: string | null
  emailSource?: string | null
  emailVerifiedAt?: string | null
  mobilePhoneTier?: string | null
  mobilePhoneSource?: string | null
  mobilePhoneVerifiedAt?: string | null
  contacts?: ContactRecord[] | null
  contactsChangedBy?: string | null
  contactsChangedAt?: string | null
  mergedReason?: string | null
}

const TIER_LABELS: Record<ContactTier, string> = {
  BOUND: 'Login',
  VERIFIED: 'Verified',
  ASSERTED: 'Unverified',
}

const TIER_DESCRIPTIONS: Record<ContactTier, string> = {
  BOUND: 'the address the customer logs in with',
  VERIFIED: 'proved by a one-time code or an identity check',
  ASSERTED: 'given by the customer, not yet proved',
}

const SOURCE_SENTENCES: Record<string, string> = {
  ZITADEL_LOGIN: 'portal login',
  OTP_EMAIL: 'one-time code by email',
  OTP_SMS: 'one-time code by SMS',
  EKYC: 'identity check',
  CHAT_ASSERTED: 'typed in chat',
  STAFF: 'entered by staff',
  MIGRATION: 'migrated from earlier records',
}

const STATUS_LABELS: Record<string, string> = {
  PROVISIONAL: 'Provisional',
  ADMITTED: 'Admitted',
  LINKED: 'Linked',
}

export function isContactTier(value: unknown): value is ContactTier {
  return value === 'BOUND' || value === 'VERIFIED' || value === 'ASSERTED'
}

/** Short badge text for a tier; the raw value when unknown, empty when absent. */
export function tierLabel(tier: string | null | undefined): string {
  if (!tier) return ''
  return isContactTier(tier) ? TIER_LABELS[tier] : tier
}

/** One-line meaning of a tier for tooltips and screen readers. */
export function tierDescription(tier: string | null | undefined): string {
  if (!tier) return ''
  return isContactTier(tier) ? TIER_DESCRIPTIONS[tier] : ''
}

/** How a contact value got there, as a short sentence fragment. */
export function sourceSentence(source: string | null | undefined): string {
  if (!source) return ''
  return SOURCE_SENTENCES[source] ?? source.toLowerCase().replace(/_/g, ' ')
}

/** Customer id status chip text; the raw value when unknown, empty when absent. */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return ''
  return STATUS_LABELS[status] ?? status
}

/**
 * "Login · portal login · verified 23 Sep 2026" — the badge's full meaning,
 * built from the parts the caller has (a date already formatted).
 */
export function provenanceSummary(parts: {
  tier?: string | null
  source?: string | null
  verifiedAtFormatted?: string | null
}): string {
  const bits = [tierLabel(parts.tier), sourceSentence(parts.source)]
  if (parts.verifiedAtFormatted) bits.push(`verified ${parts.verifiedAtFormatted}`)
  return bits.filter(Boolean).join(' · ')
}

/** The `contacts` entries of one type, primaries first, then by last seen (newest first). */
export function contactsOfType(
  contacts: ContactRecord[] | null | undefined,
  type: ContactType,
): ContactRecord[] {
  if (!Array.isArray(contacts)) return []
  return contacts
    .filter((c) => c && c.contact_type === type && typeof c.value === 'string')
    .sort((a, b) => {
      if (Boolean(a.is_primary) !== Boolean(b.is_primary)) return a.is_primary ? -1 : 1
      return (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? '')
    })
}

/** The non-primary values of one type — what the survivorship policy declined to promote. */
export function alternateContacts(
  contacts: ContactRecord[] | null | undefined,
  type: ContactType,
): ContactRecord[] {
  return contactsOfType(contacts, type).filter((c) => !c.is_primary)
}
