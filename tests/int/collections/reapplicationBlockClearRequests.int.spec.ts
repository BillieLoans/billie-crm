import { describe, it, expect, beforeAll } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'

let payload: Payload
beforeAll(async () => {
  payload = await getPayload({ config })
})

describe('reapplication-block-clear-requests collection', () => {
  it('round-trips a request row with status + reasons', async () => {
    const created = await payload.create({
      collection: 'reapplication-block-clear-requests',
      data: {
        requestId: 'req-int-1',
        canonicalCustomerId: 'c-int-1',
        reasons: ['SERVICEABILITY'],
        justification: 'int test',
        status: 'pending',
      },
      overrideAccess: true,
    })
    expect(created.requestNumber).toMatch(/^RBC-/)
    const found = await payload.find({
      collection: 'reapplication-block-clear-requests',
      where: { requestId: { equals: 'req-int-1' } },
      overrideAccess: true,
    })
    expect(found.docs[0].status).toBe('pending')
  })
})
