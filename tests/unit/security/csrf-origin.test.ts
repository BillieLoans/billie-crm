import { describe, test, expect } from 'vitest'

/**
 * Tests for the CSRF origin validation logic in src/proxy.ts.
 *
 * The proxy verifies that mutation requests (POST, PUT, PATCH, DELETE)
 * originate from the expected application URL (Origin/Referer), and fails
 * closed — a missing appUrl or missing BOTH headers is blocked. The
 * secret-authenticated public API surface (`/api/intake/*`, `/api/webhooks/*`)
 * is exempt: it's cross-origin/server-to-server by design and self-authenticates
 * in-route, so the browser CSRF check doesn't apply.
 *
 * We mirror the logic in isolation (same pattern as middleware-env-check.test.ts);
 * keep these mirrors in lockstep with src/proxy.ts.
 */

type CsrfResult = 'allow' | 'block'

/** Mirrors verifyCsrfOrigin from src/proxy.ts (fails closed). */
const verifyCsrfOrigin = (opts: {
  method: string
  appUrl?: string
  origin?: string
  referer?: string
}): CsrfResult => {
  const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
  if (!mutationMethods.has(opts.method)) return 'allow'
  if (!opts.appUrl) return 'block' // fail closed — cannot verify origin
  if (!opts.origin && !opts.referer) return 'block' // missing both is suspicious

  const allowedOrigin = new URL(opts.appUrl).origin

  if (opts.origin && opts.origin !== allowedOrigin) return 'block'

  if (!opts.origin && opts.referer) {
    try {
      if (new URL(opts.referer).origin !== allowedOrigin) return 'block'
    } catch {
      return 'block'
    }
  }

  return 'allow'
}

/** Mirrors isCsrfExemptPath from src/proxy.ts. */
const CSRF_EXEMPT_PREFIXES = ['/api/intake/', '/api/webhooks/']
const isCsrfExemptPath = (pathname: string): boolean =>
  CSRF_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))

/** Mirrors the proxy() gate: exempt public paths skip the CSRF check entirely. */
const csrfGate = (opts: {
  pathname: string
  method: string
  appUrl?: string
  origin?: string
  referer?: string
}): CsrfResult => (isCsrfExemptPath(opts.pathname) ? 'allow' : verifyCsrfOrigin(opts))

describe('CSRF Origin Validation', () => {
  const appUrl = 'https://crm.billie.loans'

  test('GET requests always pass (not a mutation)', () => {
    expect(verifyCsrfOrigin({ method: 'GET', appUrl, origin: 'https://evil.com' })).toBe('allow')
  })

  test('POST with matching origin passes', () => {
    expect(verifyCsrfOrigin({ method: 'POST', appUrl, origin: 'https://crm.billie.loans' })).toBe(
      'allow',
    )
  })

  test('POST with mismatched origin is blocked', () => {
    expect(verifyCsrfOrigin({ method: 'POST', appUrl, origin: 'https://evil.com' })).toBe('block')
  })

  test('POST with no origin AND no referer is blocked (fail closed)', () => {
    expect(verifyCsrfOrigin({ method: 'POST', appUrl })).toBe('block')
  })

  test('POST with matching referer (no origin) passes', () => {
    expect(
      verifyCsrfOrigin({
        method: 'POST',
        appUrl,
        referer: 'https://crm.billie.loans/admin/accounts',
      }),
    ).toBe('allow')
  })

  test('POST with mismatched referer is blocked', () => {
    expect(verifyCsrfOrigin({ method: 'POST', appUrl, referer: 'https://evil.com/phish' })).toBe(
      'block',
    )
  })

  test('POST with malformed referer is blocked', () => {
    expect(verifyCsrfOrigin({ method: 'POST', appUrl, referer: 'not-a-valid-url' })).toBe('block')
  })

  test('PUT, PATCH, DELETE are also checked (not just POST)', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(verifyCsrfOrigin({ method, appUrl, origin: 'https://evil.com' })).toBe('block')
      expect(verifyCsrfOrigin({ method, appUrl, origin: 'https://crm.billie.loans' })).toBe('allow')
    }
  })

  test('no appUrl configured is blocked (fail closed — cannot verify)', () => {
    expect(
      verifyCsrfOrigin({ method: 'POST', appUrl: undefined, origin: 'https://evil.com' }),
    ).toBe('block')
  })

  test('origin matches even if appUrl has a path', () => {
    expect(
      verifyCsrfOrigin({
        method: 'POST',
        appUrl: 'https://crm.billie.loans/admin',
        origin: 'https://crm.billie.loans',
      }),
    ).toBe('allow')
  })
})

describe('CSRF exemption for the public API surface', () => {
  const appUrl = 'https://crm.billie.loans'

  test('inbound webhooks are exempt (no Origin/Referer — server-to-server)', () => {
    expect(isCsrfExemptPath('/api/webhooks/clicksend')).toBe(true)
    // …so the gate lets them through even with no origin (which verifyCsrfOrigin blocks).
    expect(csrfGate({ pathname: '/api/webhooks/clicksend', method: 'POST', appUrl })).toBe('allow')
  })

  test('public intake forms are exempt (cross-origin marketing site)', () => {
    expect(isCsrfExemptPath('/api/intake/waitlist')).toBe(true)
    expect(isCsrfExemptPath('/api/intake/feedback')).toBe(true)
    // Exempt even with a mismatched origin — auth is API-key + HMAC in-route.
    expect(
      csrfGate({
        pathname: '/api/intake/feedback',
        method: 'POST',
        appUrl,
        origin: 'https://billie.loans',
      }),
    ).toBe('allow')
  })

  test('non-exempt routes are still CSRF-checked (no free pass)', () => {
    expect(isCsrfExemptPath('/api/marketing/contacts')).toBe(false)
    expect(isCsrfExemptPath('/admin/accounts')).toBe(false)
    // A cookie-authed route with no origin is blocked as before.
    expect(csrfGate({ pathname: '/api/marketing/contacts', method: 'POST', appUrl })).toBe('block')
    expect(
      csrfGate({
        pathname: '/api/marketing/contacts',
        method: 'POST',
        appUrl,
        origin: 'https://evil.com',
      }),
    ).toBe('block')
  })

  test('a lookalike prefix is NOT exempt (exact segment boundary)', () => {
    expect(isCsrfExemptPath('/api/intake-notes')).toBe(false)
    expect(isCsrfExemptPath('/api/webhooksX/y')).toBe(false)
  })
})
