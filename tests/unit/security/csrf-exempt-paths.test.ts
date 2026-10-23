/**
 * The CSRF exemptions in src/proxy.ts itself (the mirror in
 * csrf-origin.test.ts covers the origin check): only endpoints that
 * authenticate with their own secret, never a session cookie, skip it.
 */
import { describe, test, expect } from 'vitest'
import { isCsrfExemptPath } from '@/proxy'

describe('isCsrfExemptPath', () => {
  test('exempts the secret-authenticated endpoints', () => {
    expect(isCsrfExemptPath('/api/intake/waitlist')).toBe(true)
    expect(isCsrfExemptPath('/api/webhooks/clicksend')).toBe(true)
    expect(isCsrfExemptPath('/api/reports/jobs/scheduled')).toBe(true)
    // The reporting MCP connector authenticates by bearer key only (BTB-509).
    expect(isCsrfExemptPath('/api/mcp')).toBe(true)
  })

  test('checks everything else, including look-alike paths', () => {
    expect(isCsrfExemptPath('/api/mcp-tools')).toBe(false)
    expect(isCsrfExemptPath('/api/mcp/other')).toBe(false)
    expect(isCsrfExemptPath('/api/reports/ask')).toBe(false)
    expect(isCsrfExemptPath('/api/report-definitions')).toBe(false)
  })
})
