/**
 * computeReleasePartition against real Postgres (testcontainers globalSetup,
 * mirrors release-collections.int.spec.ts's bootstrap).
 *
 * Regression coverage for the waitlist sort bug: the Local API's `sort`
 * option does NOT comma-split a string like Mongo's does — passing
 * 'waitlistPosition,waitlistJoinedAt' silently resolves to nothing on the
 * drizzle adapter and the query falls back to `-createdAt`, so waitlist
 * releases would take the newest signups instead of the front of the queue.
 * The stubbed unit tests (releasePartition.test.ts) mock payload.find and so
 * can't see this — only a real adapter round-trip can.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { computeReleasePartition } from '@/lib/releases'
import type { CreateReleaseCommand } from '@/lib/schemas/releases'

let payload: Payload

const user = { id: 'staff-int-1', role: 'admin' }

describe('computeReleasePartition — waitlist ordering (real Postgres)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config })
  })

  it('returns waitlist candidates in queue order (waitlistPosition asc), not insertion order', async () => {
    // Insert position 3 first, then 1, then 2 — if the partition fell back to
    // -createdAt (the adapter's silent failure mode for an unresolvable
    // sort), the returned order would be [pos2, pos1, pos3] (newest first)
    // instead of the correct [pos1, pos2, pos3].
    const seeded = [
      { position: 3, mobile: '+61400000103' },
      { position: 1, mobile: '+61400000101' },
      { position: 2, mobile: '+61400000102' },
    ]
    for (const s of seeded) {
      await payload.create({
        collection: 'contacts',
        data: {
          contactId: `c-int-sort-${s.position}`,
          mobileE164: s.mobile,
          derivedStage: 'waitlist',
          waitlistPosition: s.position,
          waitlistJoinedAt: new Date(2026, 0, s.position).toISOString(),
        },
        overrideAccess: true,
      })
    }

    const command: CreateReleaseCommand = {
      releaseId: 'rel-int-sort-test',
      name: 'Sort regression check',
      type: 'waitlist',
      count: 3,
      expiryDays: 14,
      sendInviteSms: false,
    }

    const partition = await computeReleasePartition({ payload, user, command })

    expect(partition.candidates).toHaveLength(3)
    expect(partition.candidates.map((c) => c.mobileE164)).toEqual([
      '+61400000101', // position 1
      '+61400000102', // position 2
      '+61400000103', // position 3
    ])
  })
})
