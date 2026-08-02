/**
 * Release projections are read-only: staff can read (per role), nobody can
 * write through the Payload API — only the Python processor writes the tables.
 * Mirrors tests/int/marketing-collections.int.spec.ts (real Postgres via
 * testcontainers globalSetup).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

let payload: Payload

describe('release collections', () => {
  beforeAll(async () => {
    payload = await getPayload({ config })
  })

  it('release-batches rejects API create', async () => {
    await expect(
      payload.create({
        collection: 'release-batches',
        data: { releaseId: 'rel-x', name: 'nope' },
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('release_grants enforces the natural key', async () => {
    // Write twice via overrideAccess (processor-equivalent path) — second
    // insert with the same (releaseId, mobileE164) must violate the unique index.
    await payload.create({
      collection: 'release-grants',
      data: { releaseId: 'rel-nk', mobileE164: '+61400000001', status: 'granted' },
      overrideAccess: true,
    })
    await expect(
      payload.create({
        collection: 'release-grants',
        data: { releaseId: 'rel-nk', mobileE164: '+61400000001', status: 'granted' },
        overrideAccess: true,
      }),
    ).rejects.toThrow()
  })
})
