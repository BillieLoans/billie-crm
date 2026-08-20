/**
 * Unit tests for customer search helpers (phone-format-tolerant matching).
 *
 * phoneSearchVariants: expands a phone-like search term into the storage
 * formats seen off the event stream (local 04…, E.164 +61…), so staff can
 * paste a number in any common AU format and still match.
 *
 * customerSearchOrClauses: shared OR-clause builder used by the conversations
 * list route and the command-palette customer search.
 */

import { describe, test, expect } from 'vitest'
import { phoneSearchVariants, customerSearchOrClauses } from '@/lib/customer-search'

describe('phoneSearchVariants', () => {
  test('returns no variants for a name', () => {
    expect(phoneSearchVariants('Marcus Korff')).toEqual([])
  })

  test('returns no variants for an email address', () => {
    expect(phoneSearchVariants('marcus@example.com')).toEqual([])
  })

  test('returns no variants for an application number', () => {
    expect(phoneSearchVariants('DB5674F5-CD3')).toEqual([])
  })

  test('returns no variants for short digit runs', () => {
    expect(phoneSearchVariants('12345')).toEqual([])
  })

  test('spaced local mobile matches both stored formats', () => {
    expect(phoneSearchVariants('0412 345 678')).toEqual(
      expect.arrayContaining(['0412345678', '+61412345678']),
    )
  })

  test('E.164 input also produces the local form', () => {
    expect(phoneSearchVariants('+61 412 345 678')).toEqual(
      expect.arrayContaining(['+61412345678', '0412345678']),
    )
  })

  test('61-prefixed digits produce both canonical forms', () => {
    expect(phoneSearchVariants('61412345678')).toEqual(
      expect.arrayContaining(['+61412345678', '0412345678']),
    )
  })

  test('9-digit mobile without leading zero produces both canonical forms', () => {
    expect(phoneSearchVariants('412 345 678')).toEqual(
      expect.arrayContaining(['0412345678', '+61412345678']),
    )
  })

  test('partial local number produces the partial E.164 prefix', () => {
    expect(phoneSearchVariants('0412 345')).toEqual(
      expect.arrayContaining(['0412345', '+61412345']),
    )
  })

  test('variants are unique and exclude the trimmed input term', () => {
    const variants = phoneSearchVariants('0412345678')
    expect(new Set(variants).size).toBe(variants.length)
    expect(variants).not.toContain('0412345678')
  })
})

describe('customerSearchOrClauses', () => {
  test('name term produces name, email and phone clauses only', () => {
    expect(customerSearchOrClauses('Marcus', 'like')).toEqual([
      { fullName: { like: 'Marcus' } },
      { emailAddress: { like: 'Marcus' } },
      { mobilePhoneNumber: { like: 'Marcus' } },
    ])
  })

  test('phone term appends a clause per phone variant', () => {
    const clauses = customerSearchOrClauses('0412 345 678', 'contains')
    expect(clauses).toEqual(
      expect.arrayContaining([
        { fullName: { contains: '0412 345 678' } },
        { emailAddress: { contains: '0412 345 678' } },
        { mobilePhoneNumber: { contains: '0412 345 678' } },
        { mobilePhoneNumber: { contains: '0412345678' } },
        { mobilePhoneNumber: { contains: '+61412345678' } },
      ]),
    )
  })
})
