/**
 * Unit tests for the MCP result guard (ADR 0002): identifier-bearing results
 * are capped, and the in-flight slot admits one query per actor. The
 * restricted columns are kept out by the database role, not here: see
 * tests/int/reporting-mcp-role.int.spec.ts.
 */
import { describe, test, expect } from 'vitest'
import {
  MCP_IDENTIFIER_ROW_CAP,
  acquireQuerySlot,
  checkMcpResult,
  isIdentifierColumn,
  releaseQuerySlot,
} from '@/server/reporting/mcp-guard'

const cols = (...names: string[]) => names.map((name) => ({ name }))
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }))

describe('column classes', () => {
  test('identifiers: *_id, id and the application and identity keys', () => {
    for (const name of [
      'customer_id',
      'conversation_id',
      'id',
      'loan_account_ID',
      'application_number',
      'canonical_id',
      'merged_into',
    ]) {
      expect([name, isIdentifierColumn(name)]).toEqual([name, true])
    }
    for (const name of ['decided', 'idle_days', 'paid', 'n']) {
      expect([name, isIdentifierColumn(name)]).toEqual([name, false])
    }
  })
})

describe('checkMcpResult', () => {
  test('passes an aggregate through untouched', () => {
    const result = checkMcpResult(cols('decided_on', 'pep_hits', 'n'), rows(3))
    expect(result).toMatchObject({ cut: false, identifiers: [] })
  })

  test('passes identifiers beside any other column (ADR 0002)', () => {
    const result = checkMcpResult(cols('customer_id', 'postcode', 'age_at_application'), rows(1))
    expect(result).toMatchObject({ cut: false, identifiers: ['customer_id'] })
  })

  test('caps an identifier-bearing result and says so', () => {
    const result = checkMcpResult(
      cols('conversation_id', 'decided'),
      rows(MCP_IDENTIFIER_ROW_CAP + 5),
    )
    expect(result.rows).toHaveLength(MCP_IDENTIFIER_ROW_CAP)
    expect(result.cut).toBe(true)
    expect(result.identifiers).toEqual(['conversation_id'])
    const small = checkMcpResult(cols('conversation_id'), rows(MCP_IDENTIFIER_ROW_CAP))
    expect(small.cut).toBe(false)
  })
})

describe('query slots', () => {
  test('one in flight per actor; released slots can be taken again', () => {
    expect(acquireQuerySlot('personal:k1')).toBe(true)
    expect(acquireQuerySlot('personal:k1')).toBe(false)
    expect(acquireQuerySlot('personal:k2')).toBe(true)
    releaseQuerySlot('personal:k1')
    expect(acquireQuerySlot('personal:k1')).toBe(true)
    releaseQuerySlot('personal:k1')
    releaseQuerySlot('personal:k2')
  })
})
