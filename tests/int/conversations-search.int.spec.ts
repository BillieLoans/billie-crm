/**
 * Integration tests for the Applications view search — email / phone matching.
 *
 * Replicates the GET /api/conversations customer-resolution composition:
 * customerSearchOrClauses(term) → customerIds → conversations.customerIdString IN (…),
 * against the real Postgres test container.
 */

import { describe, test, expect, beforeAll } from 'vitest'
import configPromise from '@payload-config'
import { getPayload, Payload } from 'payload'
import { conversationSearchOrClauses } from '@/lib/conversation-search'
import { customerSearchOrClauses } from '@/lib/customer-search'

const CUSTOMER_E164 = {
  customerId: 'TEST-CSRCH-E164',
  fullName: 'Csrch Emilia Onesix-Four',
  emailAddress: 'csrch-emilia@example.test',
  mobilePhoneNumber: '+61499887761',
}

const CUSTOMER_LOCAL = {
  customerId: 'TEST-CSRCH-LOCAL',
  fullName: 'Csrch Liam Localform',
  emailAddress: 'csrch-liam@example.test',
  mobilePhoneNumber: '0455001122',
}

async function seedCustomer(payload: Payload, data: typeof CUSTOMER_E164) {
  const existing = await payload.find({
    collection: 'customers',
    where: { customerId: { equals: data.customerId } },
    limit: 1,
    depth: 0,
  })
  if (existing.docs.length === 0) {
    await payload.create({ collection: 'customers', data })
  }
}

async function seedConversation(
  payload: Payload,
  conversationId: string,
  customerId: string,
  statementAccountHolders?: string,
) {
  const existing = await payload.find({
    collection: 'conversations',
    where: { conversationId: { equals: conversationId } },
    limit: 1,
    depth: 0,
  })
  if (existing.docs.length === 0) {
    await payload.create({
      collection: 'conversations',
      data: {
        conversationId,
        applicationNumber: `APP-${conversationId}`,
        customerIdString: customerId,
        startedAt: new Date().toISOString(),
        ...(statementAccountHolders ? { statementAccountHolders } : {}),
      },
    })
  }
}

/** Mirrors the where-clause composition in GET /api/conversations for a search term. */
async function searchConversations(payload: Payload, term: string) {
  const customerMatches = await payload.find({
    collection: 'customers',
    where: { or: customerSearchOrClauses(term, 'like') },
    limit: 200,
    select: { customerId: true },
    depth: 0,
  })
  const matchedCustomerIds = customerMatches.docs
    .map((c) => (c as { customerId?: string }).customerId)
    .filter((v): v is string => Boolean(v))

  const result = await payload.find({
    collection: 'conversations',
    where: { or: conversationSearchOrClauses(term, matchedCustomerIds) },
    depth: 0,
  })
  return result.docs.map((d) => (d as { conversationId?: string }).conversationId)
}

describe('Conversations search by email and phone', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config: configPromise })
    await seedCustomer(payload, CUSTOMER_E164)
    await seedCustomer(payload, CUSTOMER_LOCAL)
    await seedConversation(payload, 'CONV-CSRCH-E164', CUSTOMER_E164.customerId)
    await seedConversation(payload, 'CONV-CSRCH-LOCAL', CUSTOMER_LOCAL.customerId)
    await seedConversation(
      payload,
      'CONV-CSRCH-HOLDERS',
      'TEST-CSRCH-NOCUST',
      'Jane Citizen | J & K STHOLDER',
    )
  })

  test('finds conversation by exact customer email', async () => {
    const ids = await searchConversations(payload, 'csrch-emilia@example.test')
    expect(ids).toContain('CONV-CSRCH-E164')
    expect(ids).not.toContain('CONV-CSRCH-LOCAL')
  })

  test('finds conversation by partial email', async () => {
    const ids = await searchConversations(payload, 'csrch-liam@')
    expect(ids).toContain('CONV-CSRCH-LOCAL')
  })

  test('finds E.164-stored phone from spaced local input', async () => {
    const ids = await searchConversations(payload, '0499 887 761')
    expect(ids).toContain('CONV-CSRCH-E164')
  })

  test('finds local-stored phone from E.164 input', async () => {
    const ids = await searchConversations(payload, '+61 455 001 122')
    expect(ids).toContain('CONV-CSRCH-LOCAL')
  })

  test('finds phone stored in the same format as typed', async () => {
    const ids = await searchConversations(payload, '+61499887761')
    expect(ids).toContain('CONV-CSRCH-E164')
  })

  test('still finds conversation by customer name', async () => {
    const ids = await searchConversations(payload, 'Emilia')
    expect(ids).toContain('CONV-CSRCH-E164')
  })

  test('non-matching term returns neither seeded conversation', async () => {
    const ids = await searchConversations(payload, 'zzz-no-such-customer-zzz')
    expect(ids).not.toContain('CONV-CSRCH-E164')
    expect(ids).not.toContain('CONV-CSRCH-LOCAL')
  })

  test('finds conversation by statement account holder, case-insensitively', async () => {
    const ids = await searchConversations(payload, 'jane citizen')
    expect(ids).toContain('CONV-CSRCH-HOLDERS')
  })

  test('finds conversation by a single word of a joint-account holder string', async () => {
    const ids = await searchConversations(payload, 'stholder')
    expect(ids).toContain('CONV-CSRCH-HOLDERS')
  })

  test('holder match does not leak into unrelated conversations', async () => {
    const ids = await searchConversations(payload, 'stholder')
    expect(ids).not.toContain('CONV-CSRCH-E164')
    expect(ids).not.toContain('CONV-CSRCH-LOCAL')
  })
})
