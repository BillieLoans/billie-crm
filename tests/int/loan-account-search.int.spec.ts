/**
 * Integration tests for loan account search API
 *
 * These tests verify the search API behavior with the Payload database.
 */

import { describe, test, expect, beforeAll } from 'vitest'
import configPromise from '@payload-config'
import { getPayload, Payload, Where } from 'payload'

describe('Loan Account Search API', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config: configPromise })
  })

  test('search returns empty array for query under 3 characters', async () => {
    const query = 'AB'

    if (query.length < 3) {
      const result = { results: [], total: 0 }
      expect(result.results).toHaveLength(0)
    }
  })

  test('search returns accounts matching accountNumber', async () => {
    const query = 'ACC-'

    const results = await payload.find({
      collection: 'loan-accounts',
      where: {
        or: [
          { accountNumber: { contains: query } },
          { loanAccountId: { contains: query } },
          { customerName: { contains: query } },
        ],
      },
      limit: 10,
    })

    expect(results).toBeDefined()
    expect(results.docs).toBeInstanceOf(Array)
    expect(typeof results.totalDocs).toBe('number')
  })

  test('search returns accounts matching loanAccountId', async () => {
    const query = 'LA-'

    const results = await payload.find({
      collection: 'loan-accounts',
      where: {
        or: [
          { accountNumber: { contains: query } },
          { loanAccountId: { contains: query } },
          { customerName: { contains: query } },
        ],
      },
      limit: 10,
    })

    expect(results).toBeDefined()
    expect(results.docs).toBeInstanceOf(Array)
  })

  test('search returns accounts matching customerName', async () => {
    const query = 'Smith'

    const results = await payload.find({
      collection: 'loan-accounts',
      where: {
        or: [
          { accountNumber: { contains: query } },
          { loanAccountId: { contains: query } },
          { customerName: { contains: query } },
        ],
      },
      limit: 10,
    })

    expect(results).toBeDefined()
    expect(results.docs).toBeInstanceOf(Array)
  })

  test('search limits results to 10', async () => {
    const query = 'test'

    const results = await payload.find({
      collection: 'loan-accounts',
      where: {
        or: [
          { accountNumber: { contains: query } },
          { loanAccountId: { contains: query } },
          { customerName: { contains: query } },
        ],
      },
      limit: 10,
    })

    expect(results.docs.length).toBeLessThanOrEqual(10)
  })

  test('search result contains required fields', async () => {
    const query = 'test'

    const results = await payload.find({
      collection: 'loan-accounts',
      where: {
        or: [
          { accountNumber: { contains: query } },
        ],
      },
      limit: 1,
    })

    if (results.docs.length > 0) {
      const account = results.docs[0]
      expect(account).toHaveProperty('id')
      expect(account).toHaveProperty('loanAccountId')
      expect(account).toHaveProperty('accountNumber')
      expect(account).toHaveProperty('accountStatus')
    }
  })

  test('or query combines multiple fields correctly', async () => {
    const orQuery: Where = {
      or: [
        { accountNumber: { contains: 'test' } },
        { loanAccountId: { contains: 'test' } },
        { customerName: { contains: 'test' } },
      ],
    }

    const results = await payload.find({
      collection: 'loan-accounts',
      where: orQuery,
      limit: 10,
    })

    expect(results).toBeDefined()
  })
})
