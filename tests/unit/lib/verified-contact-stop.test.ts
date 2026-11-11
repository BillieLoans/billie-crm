// tests/unit/lib/verified-contact-stop.test.ts
import { describe, it, expect } from 'vitest'
import {
  describeClearRejection,
  formatMatchedContactKinds,
  isVerifiedContactStop,
} from '@/lib/reapplicationBlock'
import {
  CLEARABLE_REASONS,
  DIFFERENT_PERSON_CLEAR_REASON,
  REASONS_REQUIRING_APPROVAL,
  VERIFIED_CONTACT_BAND,
} from '@/lib/events/config'
import {
  BlockClearRequestCommandSchema,
  DifferentPersonClearCommandSchema,
} from '@/lib/events/schemas'

describe('isVerifiedContactStop (BTB-569)', () => {
  it('is keyed on recognition.band, the value billieChat sets', () => {
    expect(VERIFIED_CONTACT_BAND).toBe('verified_contact')
    expect(isVerifiedContactStop({ recognition: { band: 'verified_contact' } })).toBe(true)
  })

  it('is false for every other kind of halt', () => {
    expect(isVerifiedContactStop(null)).toBe(false)
    expect(isVerifiedContactStop(undefined)).toBe(false)
    expect(isVerifiedContactStop({})).toBe(false)
    expect(isVerifiedContactStop({ recognition: null })).toBe(false)
    expect(isVerifiedContactStop({ recognition: { band: null } })).toBe(false)
    expect(isVerifiedContactStop({ recognition: { band: 'review' } })).toBe(false)
  })
})

describe('formatMatchedContactKinds', () => {
  it('names the contact staff would recognise', () => {
    expect(formatMatchedContactKinds(['phone'])).toBe('mobile')
    expect(formatMatchedContactKinds(['email'])).toBe('email')
    expect(formatMatchedContactKinds(['email', 'phone'])).toBe('email and mobile')
  })

  it('shows a kind it has no wording for as received', () => {
    expect(formatMatchedContactKinds(['carrier_pigeon'])).toBe('carrier_pigeon')
  })

  it('falls back to "contact" when the event names none', () => {
    expect(formatMatchedContactKinds([])).toBe('contact')
    expect(formatMatchedContactKinds(null)).toBe('contact')
    expect(formatMatchedContactKinds(undefined)).toBe('contact')
  })
})

describe('describeClearRejection', () => {
  it("words billieChat's codes for a different-person clear", () => {
    expect(
      describeClearRejection(
        'UNKNOWN_STOPPED_CONVERSATION: no verified-contact stop is recorded for that conversation against this customer',
      ),
    ).toBe('no contact match is on record for this application against that customer')
    expect(describeClearRejection('MISSING_FIELDS: stopped_conversation_id is required')).toBe(
      'details were missing',
    )
  })

  it('shows a code it has no wording for exactly as received', () => {
    expect(describeClearRejection('SOMETHING_NEW: with detail')).toBe('SOMETHING_NEW: with detail')
    expect(describeClearRejection('constructor')).toBe('constructor')
  })

  it('says so when there is no reason', () => {
    expect(describeClearRejection(null)).toBe('no reason given')
    expect(describeClearRejection('  ')).toBe('no reason given')
  })
})

describe('DIFFERENT_PERSON clear reason', () => {
  it('is not a block reason: the ordinary clear and the approvals queue never carry it', () => {
    expect(DIFFERENT_PERSON_CLEAR_REASON).toBe('DIFFERENT_PERSON')
    expect(CLEARABLE_REASONS as readonly string[]).not.toContain(DIFFERENT_PERSON_CLEAR_REASON)
    expect(REASONS_REQUIRING_APPROVAL as readonly string[]).not.toContain(
      DIFFERENT_PERSON_CLEAR_REASON,
    )
    expect(
      BlockClearRequestCommandSchema.safeParse({
        canonicalCustomerId: 'c1',
        reasons: ['DIFFERENT_PERSON'],
        justification: 'a long enough justification',
      }).success,
    ).toBe(false)
  })
})

describe('DifferentPersonClearCommandSchema', () => {
  it('accepts a conversation and a justification, trimmed', () => {
    const parsed = DifferentPersonClearCommandSchema.parse({
      conversationId: ' conv-1 ',
      justification: '  Recycled number, different person  ',
    })
    expect(parsed).toEqual({
      conversationId: 'conv-1',
      justification: 'Recycled number, different person',
    })
  })

  it('refuses a short or missing justification and a missing conversation', () => {
    expect(
      DifferentPersonClearCommandSchema.safeParse({ conversationId: 'c', justification: 'short' })
        .success,
    ).toBe(false)
    expect(DifferentPersonClearCommandSchema.safeParse({ conversationId: 'c' }).success).toBe(false)
    expect(
      DifferentPersonClearCommandSchema.safeParse({
        justification: 'Recycled number, different person',
      }).success,
    ).toBe(false)
  })
})
