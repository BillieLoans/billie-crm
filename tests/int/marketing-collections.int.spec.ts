import { describe, it, expect, beforeAll } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

let payload: Payload

describe('marketing projection collections', () => {
  beforeAll(async () => {
    payload = await getPayload({ config })
  })

  it('contacts collection exists and rejects API writes', async () => {
    await expect(
      payload.create({
        collection: 'contacts',
        data: { contactId: 'c-test-1' },
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('processor-style raw insert then read via payload.find', async () => {
    await payload.db.drizzle.execute(
      `INSERT INTO contacts (contact_id, source, derived_stage, observed_at, updated_at, created_at)
       VALUES ('c-int-1', 'campus', 'lead', now(), now(), now())`,
    )
    const res = await payload.find({ collection: 'contacts', where: { contactId: { equals: 'c-int-1' } } })
    expect(res.docs).toHaveLength(1)
    expect(res.docs[0].derivedStage).toBe('lead')
  })
})
