/**
 * Unit tests for the reporting MCP connector's helpers (BTB-509). The
 * endpoint itself is covered in tests/int/report-mcp.int.spec.ts.
 */
import { describe, test, expect } from 'vitest'
import { apiKeyIndex, fitRows, MCP_MAX_RESULT_CHARS } from '@/server/reporting/mcp'

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
