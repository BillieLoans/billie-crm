import { describe, test, expect, vi } from 'vitest'
import { computeReleasePartition } from '@/lib/releases'

type Doc = Record<string, unknown>

/** Payload.find stub keyed by collection. */
function payloadWith(docs: { contacts?: Doc[]; grants?: Doc[]; batches?: Doc[] }) {
  return {
    find: vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'contacts')
        return { docs: docs.contacts ?? [], totalDocs: (docs.contacts ?? []).length }
      if (collection === 'release-grants')
        return { docs: docs.grants ?? [], totalDocs: (docs.grants ?? []).length }
      if (collection === 'release-batches')
        return { docs: docs.batches ?? [], totalDocs: (docs.batches ?? []).length }
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
