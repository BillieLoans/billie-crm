import { describe, it, expect } from 'vitest'
import {
  alternateContacts,
  contactsOfType,
  provenanceSummary,
  sourceSentence,
  statusLabel,
  tierDescription,
  tierLabel,
  type ContactRecord,
} from '@/lib/contact-provenance'

const CONTACTS: ContactRecord[] = [
  {
    contact_type: 'EMAIL',
    value: 'rohansharp+6@gmail.com',
    tier: 'BOUND',
    source: 'ZITADEL_LOGIN',
    is_primary: true,
    last_seen_at: '2026-09-23T13:15:00Z',
    origin_customer_id: '23D47AB2',
  },
  {
    contact_type: 'EMAIL',
    value: 'old@example.com',
    tier: 'ASSERTED',
    source: 'CHAT_ASSERTED',
    is_primary: false,
    last_seen_at: '2026-08-01T00:00:00Z',
    origin_customer_id: '258DE915',
  },
  {
    contact_type: 'EMAIL',
    value: 'newer@example.com',
    tier: 'VERIFIED',
    source: 'OTP_EMAIL',
    is_primary: false,
    last_seen_at: '2026-09-10T00:00:00Z',
    origin_customer_id: '23D47AB2',
  },
  {
    contact_type: 'MOBILE',
    value: '0412345678',
    tier: 'VERIFIED',
    source: 'OTP_SMS',
    is_primary: true,
    last_seen_at: '2026-09-23T13:15:00Z',
  },
]

describe('contact provenance labels', () => {
  it('maps tiers to staff-facing labels and meanings', () => {
    expect(tierLabel('BOUND')).toBe('Login')
    expect(tierLabel('VERIFIED')).toBe('Verified')
    expect(tierLabel('ASSERTED')).toBe('Unverified')
    expect(tierLabel(null)).toBe('')
    expect(tierLabel('FUTURE_TIER')).toBe('FUTURE_TIER')
    expect(tierDescription('BOUND')).toContain('logs in')
    expect(tierDescription('FUTURE_TIER')).toBe('')
  })

  it('maps sources to sentences and falls back to a readable raw value', () => {
    expect(sourceSentence('ZITADEL_LOGIN')).toBe('portal login')
    expect(sourceSentence('CHAT_ASSERTED')).toBe('typed in chat')
    expect(sourceSentence('SOMETHING_NEW')).toBe('something new')
    expect(sourceSentence(undefined)).toBe('')
  })

  it('maps customer id statuses', () => {
    expect(statusLabel('PROVISIONAL')).toBe('Provisional')
    expect(statusLabel('LINKED')).toBe('Linked')
    expect(statusLabel(null)).toBe('')
  })

  it('builds the badge summary from whatever parts exist', () => {
    expect(
      provenanceSummary({
        tier: 'BOUND',
        source: 'ZITADEL_LOGIN',
        verifiedAtFormatted: '23 September 2026',
      }),
    ).toBe('Login · portal login · verified 23 September 2026')
    expect(provenanceSummary({ tier: 'ASSERTED' })).toBe('Unverified')
  })
})

describe('contacts by type', () => {
  it('lists one type, primary first then newest last-seen', () => {
    expect(contactsOfType(CONTACTS, 'EMAIL').map((c) => c.value)).toEqual([
      'rohansharp+6@gmail.com',
      'newer@example.com',
      'old@example.com',
    ])
  })

  it('alternates exclude the primary and are empty for legacy rows', () => {
    expect(alternateContacts(CONTACTS, 'EMAIL').map((c) => c.value)).toEqual([
      'newer@example.com',
      'old@example.com',
    ])
    expect(alternateContacts(CONTACTS, 'MOBILE')).toEqual([])
    expect(alternateContacts(null, 'EMAIL')).toEqual([])
    expect(alternateContacts(undefined, 'MOBILE')).toEqual([])
  })

  it('ignores malformed entries', () => {
    const malformed = [{ contact_type: 'EMAIL' }, null, 'x'] as unknown as ContactRecord[]
    expect(contactsOfType(malformed, 'EMAIL')).toEqual([])
  })
})
