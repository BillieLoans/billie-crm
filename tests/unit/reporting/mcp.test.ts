/**
 * Unit tests for the reporting MCP connector's helpers (BTB-509). The
 * endpoint itself is covered in tests/int/report-mcp.int.spec.ts.
 */
import { describe, test, expect } from 'vitest'
import {
  apiKeyIndex,
  fitRows,
  MCP_MAX_RESULT_CHARS,
  OUTSIDE_SCHEMA_MESSAGE,
  permissionMessage,
  RESTRICTED_MESSAGE,
} from '@/server/reporting/mcp'

describe('fitRows', () => {
  test('keeps every row that fits', () => {
    const rows = [{ a: 1 }, { a: 2 }]
    expect(fitRows(rows)).toEqual({ rows, cut: false })
  })

  test('drops the rows past the size limit and says so', () => {
    const big = 'x'.repeat(1000)
    const rows = Array.from({ length: 500 }, (_, i) => ({ i, big }))
    const fitted = fitRows(rows)
    expect(fitted.cut).toBe(true)
    expect(JSON.stringify(fitted.rows).length).toBeLessThanOrEqual(MCP_MAX_RESULT_CHARS + 1)
    expect(fitted.rows.length).toBeGreaterThan(100)
  })
})

describe('apiKeyIndex', () => {
  test('is a stable HMAC of the key under the app secret', () => {
    expect(apiKeyIndex('s', 'k')).toBe(apiKeyIndex('s', 'k'))
    expect(apiKeyIndex('s', 'k')).not.toBe(apiKeyIndex('t', 'k'))
    expect(apiKeyIndex('s', 'k')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('permissionMessage (ADR 0002)', () => {
  test('a refusal on a reporting view or table is a restricted column', () => {
    expect(permissionMessage('permission denied for view application')).toBe(RESTRICTED_MESSAGE)
    expect(permissionMessage('permission denied for table decision_event')).toBe(RESTRICTED_MESSAGE)
    expect(permissionMessage('permission denied for view reporting.customer')).toBe(
      RESTRICTED_MESSAGE,
    )
  })

  test('a refusal on anything else is outside the reporting schema', () => {
    expect(permissionMessage('permission denied for table users')).toBe(OUTSIDE_SCHEMA_MESSAGE)
    expect(permissionMessage('permission denied for schema public')).toBe(OUTSIDE_SCHEMA_MESSAGE)
  })

  test('without the database text, it names both', () => {
    expect(permissionMessage(undefined)).toContain('outside the reporting schema')
    expect(permissionMessage(undefined)).toContain(RESTRICTED_MESSAGE)
  })
})
