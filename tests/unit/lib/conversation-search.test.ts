/**
 * Unit tests for the conversations search OR-clause builder shared by
 * GET /api/conversations and the integration tests.
 */

import { describe, test, expect } from 'vitest'
import { conversationSearchOrClauses } from '@/lib/conversation-search'

describe('conversationSearchOrClauses', () => {
  test('matches customerIdString, applicationNumber and statement account holders', () => {
    expect(conversationSearchOrClauses('smith', [])).toEqual([
      { customerIdString: { like: 'smith' } },
      { applicationNumber: { like: 'smith' } },
      { statementAccountHolders: { like: 'smith' } },
    ])
  })

  test('appends an IN clause when customer IDs were resolved from the term', () => {
    const clauses = conversationSearchOrClauses('smith', ['CUS-1', 'CUS-2'])
    expect(clauses).toContainEqual({ customerIdString: { in: ['CUS-1', 'CUS-2'] } })
  })

  test('omits the IN clause when no customer IDs matched', () => {
    const clauses = conversationSearchOrClauses('smith', [])
    expect(clauses.some((c) => 'in' in ((c as { customerIdString?: object }).customerIdString ?? {}))).toBe(false)
  })
})
