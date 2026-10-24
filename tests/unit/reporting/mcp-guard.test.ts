/**
 * Unit tests for the MCP result guard (ADR 0001): identifier plus sensitive
 * columns are refused, identifier-bearing results are capped, and the
 * in-flight slot admits one query per actor.
 */
import { describe, test, expect } from 'vitest'
import {
  MCP_IDENTIFIER_ROW_CAP,
  SENSITIVE_COLUMNS,
  acquireQuerySlot,
  checkMcpResult,
  isIdentifierColumn,
  isSensitiveColumn,
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

  test('sensitive: every screening, vulnerability, fraud, age and postcode column in the views', () => {
    for (const name of [
      'pep_result',
      'sanctions_result',
      'vulnerable_flag',
      'fraud_risk_score',
      'age',
      'age_at_application',
      'postcode',
      'fraud_would_halt',
    ]) {
      expect(SENSITIVE_COLUMNS.has(name)).toBe(true)
      expect(isSensitiveColumn(name.toUpperCase())).toBe(true)
    }
    expect(isSensitiveColumn('state')).toBe(false)
    expect(isSensitiveColumn('decline_category')).toBe(false)
  })
})

describe('checkMcpResult', () => {
  test('passes an aggregate through untouched', () => {
    const result = checkMcpResult(cols('decided_on', 'pep_hits', 'n'), rows(3))
    expect(result).toMatchObject({ ok: true, cut: false, identifiers: [] })
  })

  test('refuses a sensitive column per identifier, naming both', () => {
    const result = checkMcpResult(cols('customer_id', 'postcode', 'vulnerable_flag'), rows(1))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('ROW_LEVEL')
      expect(result.message).toContain('postcode, vulnerable_flag')
      expect(result.message).toContain('customer_id')
    }
  })

  test('refuses even an empty result, so the shape is never confirmed', () => {
    expect(checkMcpResult(cols('conversation_id', 'age_at_application'), []).ok).toBe(false)
  })

  test('caps an identifier-bearing result and says so', () => {
    const result = checkMcpResult(
      cols('conversation_id', 'decided'),
      rows(MCP_IDENTIFIER_ROW_CAP + 5),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows).toHaveLength(MCP_IDENTIFIER_ROW_CAP)
      expect(result.cut).toBe(true)
      expect(result.identifiers).toEqual(['conversation_id'])
    }
    const small = checkMcpResult(cols('conversation_id'), rows(MCP_IDENTIFIER_ROW_CAP))
    expect(small.ok && !small.cut).toBe(true)
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
