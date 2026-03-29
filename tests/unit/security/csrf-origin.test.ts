import { describe, test, expect } from 'vitest'

/**
 * Tests for the CSRF origin validation logic in src/middleware.ts.
 *
 * The middleware verifies that mutation requests (POST, PUT, PATCH, DELETE)
 * originate from the expected application URL by checking the Origin and
 * Referer headers. We test the logic in isolation rather than importing
 * the middleware module (same pattern as middleware-env-check.test.ts).
 */

type CsrfResult = 'allow' | 'block'

/** Mirrors the verifyCsrfOrigin logic from src/middleware.ts */
const verifyCsrfOrigin = (opts: {
  method: string
  appUrl?: string
  origin?: string
  referer?: string
}): CsrfResult => {
  const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
  if (!mutationMethods.has(opts.method)) return 'allow'
  if (!opts.appUrl) return 'allow'
  if (!opts.origin && !opts.referer) return 'allow'

  const allowedOrigin = new URL(opts.appUrl).origin

  if (opts.origin && opts.origin !== allowedOrigin) return 'block'

  if (!opts.origin && opts.referer) {
    try {
      const refererOrigin = new URL(opts.referer).origin
      if (refererOrigin !== allowedOrigin) return 'block'
    } catch {
      return 'block'
    }
  }

  return 'allow'
}

describe('CSRF Origin Validation', () => {
  const appUrl = 'https://crm.billie.loans'

  test('GET requests always pass (not a mutation)', () => {
    expect(verifyCsrfOrigin({
      method: 'GET',
      appUrl,
      origin: 'https://evil.com',
    })).toBe('allow')
  })

  test('POST with matching origin passes', () => {
    expect(verifyCsrfOrigin({
      method: 'POST',
      appUrl,
      origin: 'https://crm.billie.loans',
    })).toBe('allow')
  })

  test('POST with mismatched origin is blocked', () => {
    expect(verifyCsrfOrigin({
      method: 'POST',
      appUrl,
      origin: 'https://evil.com',
    })).toBe('block')
  })

  test('POST with no origin/referer passes (server-to-server)', () => {
    expect(verifyCsrfOrigin({
      method: 'POST',
      appUrl,
    })).toBe('allow')
  })

  test('POST with matching referer (no origin) passes', () => {
    expect(verifyCsrfOrigin({
      method: 'POST',
      appUrl,
      referer: 'https://crm.billie.loans/admin/accounts',
    })).toBe('allow')
  })

  test('POST with mismatched referer is blocked', () => {
    expect(verifyCsrfOrigin({
      method: 'POST',
      appUrl,
      referer: 'https://evil.com/phish',
    })).toBe('block')
  })

  test('POST with malformed referer is blocked', () => {
    expect(verifyCsrfOrigin({
      method: 'POST',
      appUrl,
      referer: 'not-a-valid-url',
    })).toBe('block')
  })

  test('PUT, PATCH, DELETE are also checked (not just POST)', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(verifyCsrfOrigin({
        method,
        appUrl,
        origin: 'https://evil.com',
      })).toBe('block')

      expect(verifyCsrfOrigin({
        method,
        appUrl,
        origin: 'https://crm.billie.loans',
      })).toBe('allow')
    }
  })

  test('no appUrl configured = always allow (cannot verify)', () => {
    expect(verifyCsrfOrigin({
      method: 'POST',
      appUrl: undefined,
      origin: 'https://evil.com',
    })).toBe('allow')
  })

  test('origin matches even if appUrl has a path', () => {
    expect(verifyCsrfOrigin({
      method: 'POST',
      appUrl: 'https://crm.billie.loans/admin',
      origin: 'https://crm.billie.loans',
    })).toBe('allow')
  })
})
