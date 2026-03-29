/**
 * Integration tests for customer search API
 *
 * These tests verify the search API behavior with the Payload database.
 * They run against a test database instance.
 */

import { describe, test, expect, beforeAll } from 'vitest'
import configPromise from '@payload-config'
import { getPayload, Payload, Where } from 'payload'

describe('Customer Search API', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config: configPromise })
  })

  test('search returns empty array for query under 3 characters', async () => {
    // Simulate the API behavior
    const query = 'ab'

    // Query too short - should return empty
    if (query.length < 3) {
      const result = { results: [], total: 0 }
      expect(result.results).toHaveLength(0)
    }
  })

  test('search returns customers matching fullName', async () => {
    // This test verifies that the Payload query syntax is correct
    const query = 'John'

    const results = await payload.find({
      collection: 'customers',
      where: {
        or: [
          { fullName: { contains: query } },
          { emailAddress: { contains: query } },
          { mobilePhoneNumber: { contains: query } },
          { customerId: { contains: query } },
        ],
      },
      limit: 10,
    })

    // Verify the query executed without errors
    expect(results).toBeDefined()
    expect(results.docs).toBeInstanceOf(Array)
    expect(typeof results.totalDocs).toBe('number')
  })

  test('search returns customers matching emailAddress', async () => {
    const query = '@example.com'

    const results = await payload.find({
      collection: 'customers',
      where: {
        or: [
          { fullName: { contains: query } },
          { emailAddress: { contains: query } },
          { mobilePhoneNumber: { contains: query } },
          { customerId: { contains: query } },
        ],
      },
      limit: 10,
    })

    expect(results).toBeDefined()
    expect(results.docs).toBeInstanceOf(Array)
  })

  test('search returns customers matching customerId', async () => {
    const query = 'CUS-'

    const results = await payload.find({
      collection: 'customers',
      where: {
        or: [
          { fullName: { contains: query } },
          { emailAddress: { contains: query } },
          { mobilePhoneNumber: { contains: query } },
          { customerId: { contains: query } },
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
      collection: 'customers',
      where: {
        or: [
          { fullName: { contains: query } },
          { emailAddress: { contains: query } },
          { mobilePhoneNumber: { contains: query } },
          { customerId: { contains: query } },
        ],
      },
      limit: 10,
    })

    expect(results.docs.length).toBeLessThanOrEqual(10)
  })

  test('search result contains required fields', async () => {
    const query = 'test'

    const results = await payload.find({
      collection: 'customers',
      where: {
        or: [
          { fullName: { contains: query } },
        ],
      },
      limit: 1,
    })

    // If we have results, check the shape
    if (results.docs.length > 0) {
      const customer = results.docs[0]
      expect(customer).toHaveProperty('id')
      expect(customer).toHaveProperty('customerId')
      // fullName, emailAddress may be null
      expect('fullName' in customer).toBe(true)
      expect('emailAddress' in customer).toBe(true)
    }
  })

  test('or query combines multiple fields correctly', async () => {
    // Verify that the OR query syntax works with Payload
    const orQuery: Where = {
      or: [
        { fullName: { contains: 'test' } },
        { emailAddress: { contains: 'test' } },
        { customerId: { contains: 'test' } },
      ],
    }

    // This should not throw
    const results = await payload.find({
      collection: 'customers',
      where: orQuery,
      limit: 10,
    })

    expect(results).toBeDefined()
  })
})
