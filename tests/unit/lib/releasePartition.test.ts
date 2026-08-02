import { describe, test, expect, vi } from 'vitest'
import { computeReleasePartition } from '@/lib/releases'

type Doc = Record<string, unknown>
/** Plain array (totalDocs defaults to array length) or an explicit page shape
 *  — the latter lets a test report a `totalDocs` that diverges from the
 *  fetched page, to simulate a bulk read hitting its limit. */
type CollectionStub = Doc[] | { docs: Doc[]; totalDocs: number }

function normaliseStub(input: CollectionStub | undefined): { docs: Doc[]; totalDocs: number } {
  if (!input) return { docs: [], totalDocs: 0 }
  if (Array.isArray(input)) return { docs: input, totalDocs: input.length }
  return input
}

/** Payload.find stub keyed by collection. */
function payloadWith(docs: {
  contacts?: CollectionStub
  grants?: CollectionStub
  batches?: CollectionStub
}) {
  return {
    find: vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'contacts') return normaliseStub(docs.contacts)
      if (collection === 'release-grants') return normaliseStub(docs.grants)
      if (collection === 'release-batches') return normaliseStub(docs.batches)
      return { docs: [], totalDocs: 0 }
    }),
  } as never
}

const consented = { marketing: { granted: true } }

describe('computeReleasePartition — waitlist', () => {
  test('takes eligible contacts in order and buckets correctly', async () => {
    const payload = payloadWith({
      contacts: [
        {
          contactId: 'c1',
          mobileE164: '+61400000001',
          consent: consented,
          needsReview: false,
          customerId: null,
        },
        {
          contactId: 'c2',
          mobileE164: '+61400000002',
          consent: null,
          needsReview: false,
          customerId: null,
        },
        {
          contactId: 'c3',
          mobileE164: '+61400000003',
          consent: consented,
          needsReview: true,
          customerId: null,
        },
        {
          contactId: 'c4',
          mobileE164: '+61400000004',
          consent: consented,
          needsReview: false,
          customerId: 'cust-1',
        },
      ],
    })
    const { counts } = await computeReleasePartition({
      payload,
      user: { id: 'staff-1' } as never,
      command: {
        releaseId: 'rel_12345678',
        name: 'w',
        type: 'waitlist',
        count: 4,
        expiryDays: 14,
        sendInviteSms: true,
      },
    })
    expect(counts.granted_sms).toBe(1) // c1
    expect(counts.granted_no_sms).toBe(1) // c2 (no consent)
    expect(counts.skipped_needs_review).toBe(1) // c3
    expect(counts.skipped_already_customer).toBe(1) // c4
  })

  test('already-released mobiles are skipped', async () => {
    const payload = payloadWith({
      contacts: [
        {
          contactId: 'c1',
          mobileE164: '+61400000001',
          consent: consented,
          needsReview: false,
          customerId: null,
        },
      ],
      grants: [{ releaseId: 'rel-old', mobileE164: '+61400000001', status: 'granted' }],
      batches: [{ releaseId: 'rel-old', status: 'active', expiresAt: '2099-01-01T00:00:00Z' }],
    })
    const { counts } = await computeReleasePartition({
      payload,
      user: { id: 'staff-1' } as never,
      command: {
        releaseId: 'rel_12345678',
        name: 'w',
        type: 'waitlist',
        count: 1,
        expiryDays: 14,
        sendInviteSms: false,
      },
    })
    expect(counts.skipped_already_released).toBe(1)
  })

  test('take-until-count: skips do not consume the count, so the next eligible contact is still granted', async () => {
    const payload = payloadWith({
      contacts: [
        {
          contactId: 'c1',
          mobileE164: '+61400000001',
          consent: consented,
          needsReview: false,
          customerId: 'cust-1',
        },
        {
          contactId: 'c2',
          mobileE164: '+61400000002',
          consent: consented,
          needsReview: false,
          customerId: null,
        },
        {
          contactId: 'c3',
          mobileE164: '+61400000003',
          consent: consented,
          needsReview: false,
          customerId: null,
        },
      ],
    })
    const { candidates, counts } = await computeReleasePartition({
      payload,
      user: { id: 'staff-1' } as never,
      command: {
        releaseId: 'rel_12345678',
        name: 'w',
        type: 'waitlist',
        count: 1,
        expiryDays: 14,
        sendInviteSms: true,
      },
    })
    // c1 skipped as already-customer (doesn't consume the count), c2 is the
    // first GRANTED candidate and satisfies count=1, so c3 is never reached.
    expect(counts.skipped_already_customer).toBe(1)
    expect(counts.granted_sms).toBe(1)
    expect(counts.granted_no_sms).toBe(0)
    expect(candidates).toHaveLength(2)
    expect(candidates.map((c) => c.mobileE164)).toEqual(['+61400000001', '+61400000002'])
  })
})

describe('computeReleasePartition — phone_list', () => {
  test('normalises, dedupes, flags invalid; unknown numbers grant without SMS', async () => {
    const payload = payloadWith({ contacts: [] })
    const { candidates, counts } = await computeReleasePartition({
      payload,
      user: { id: 'staff-1' } as never,
      command: {
        releaseId: 'rel_12345678',
        name: 'p',
        type: 'phone_list',
        mobiles: ['0400 000 001', '400000001', 'garbage', '0400000002'],
        expiryDays: 14,
        sendInviteSms: true,
      },
    })
    expect(counts.skipped_invalid_number).toBe(1)
    expect(counts.granted_no_sms).toBe(2) // deduped +61400000001, +61400000002 — no contact → no consent → no SMS
    expect(
      candidates.filter((c) => c.bucket === 'granted_no_sms').map((c) => c.mobileE164),
    ).toEqual(['+61400000001', '+61400000002'])
  })

  test('a pasted number matching a consented contact is granted with SMS', async () => {
    const payload = payloadWith({
      contacts: [
        {
          contactId: 'c9',
          mobileE164: '+61400000009',
          consent: consented,
          needsReview: false,
          customerId: null,
        },
      ],
    })
    const { candidates, counts } = await computeReleasePartition({
      payload,
      user: { id: 'staff-1' } as never,
      command: {
        releaseId: 'rel_12345678',
        name: 'p',
        type: 'phone_list',
        mobiles: ['0400000009'],
        expiryDays: 14,
        sendInviteSms: true,
      },
    })
    expect(counts.granted_sms).toBe(1)
    expect(candidates).toEqual([
      { mobileE164: '+61400000009', contactId: 'c9', sendSms: true, bucket: 'granted_sms' },
    ])
  })
})

describe('computeReleasePartition — truncation guard', () => {
  test('signals truncated when a bulk read reports totalDocs beyond its limit', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const payload = payloadWith({
      contacts: {
        docs: [
          {
            contactId: 'c1',
            mobileE164: '+61400000001',
            consent: consented,
            needsReview: false,
            customerId: null,
          },
        ],
        // Reports more waitlist rows exist than the 10k-row page fetched.
        totalDocs: 10_001,
      },
    })
    const { counts, truncated } = await computeReleasePartition({
      payload,
      user: { id: 'staff-1' } as never,
      command: {
        releaseId: 'rel_12345678',
        name: 'w',
        type: 'waitlist',
        count: 1,
        expiryDays: 14,
        sendInviteSms: true,
      },
    })
    expect(truncated).toBe(true)
    expect(counts.granted_sms).toBe(1) // counts are still computed from the fetched page
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('waitlist contacts'))
    warnSpy.mockRestore()
  })

  test('normal case leaves truncated falsy', async () => {
    const payload = payloadWith({
      contacts: [
        {
          contactId: 'c1',
          mobileE164: '+61400000001',
          consent: consented,
          needsReview: false,
          customerId: null,
        },
      ],
    })
    const { truncated } = await computeReleasePartition({
      payload,
      user: { id: 'staff-1' } as never,
      command: {
        releaseId: 'rel_12345678',
        name: 'w',
        type: 'waitlist',
        count: 1,
        expiryDays: 14,
        sendInviteSms: false,
      },
    })
    expect(truncated).toBeFalsy()
  })
})

describe('computeReleasePartition — open_quota', () => {
  test('returns empty partition', async () => {
    const { candidates, counts } = await computeReleasePartition({
      payload: payloadWith({}),
      user: { id: 'staff-1' } as never,
      command: {
        releaseId: 'rel_12345678',
        name: 'q',
        type: 'open_quota',
        count: 150,
        expiryDays: 14,
        sendInviteSms: false,
      },
    })
    expect(candidates).toEqual([])
    expect(Object.values(counts).every((n) => n === 0)).toBe(true)
  })
})
