/**
 * Unit tests for the sign-in request's browser binding and sealing
 * (`src/server/reporting/mcp-oauth.ts`): the nonce cookie, the request id,
 * tamper and expiry handling, and the consent page's CSP. The endpoints
 * are covered in tests/int/mcp-oauth.int.spec.ts.
 */
import { describe, test, expect } from 'vitest'
import {
  bindAuthorizationRequest,
  newBrowserNonce,
  openAuthorizationRequest,
  requestMatchesBrowser,
  sealAuthorizationRequest,
  type AuthorizationRequest,
} from '@/server/reporting/mcp-oauth'
import { contentSecurityPolicyFor, isCsrfExemptPath } from '@/proxy'

const request: AuthorizationRequest = {
  clientId: 'bcrmcl_x',
  clientName: 'Claude',
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  state: 's',
  codeChallenge: 'c'.repeat(43),
  resource: 'http://localhost:3000/api/mcp',
}

describe('browser binding', () => {
  test('a bound request matches only the nonce it was bound to', () => {
    const nonce = newBrowserNonce()
    const bound = bindAuthorizationRequest(request, nonce)
    expect(bound.jti).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(bound.browser).not.toContain(nonce)
    expect(requestMatchesBrowser(bound, nonce)).toBe(true)
    expect(requestMatchesBrowser(bound, newBrowserNonce())).toBe(false)
    expect(requestMatchesBrowser(bound, undefined)).toBe(false)
    expect(requestMatchesBrowser(bound, '')).toBe(false)
  })

  test('an unbound request (no browser hash) never matches', () => {
    expect(requestMatchesBrowser(request, newBrowserNonce())).toBe(false)
  })

  test('every binding gets its own request id', () => {
    const nonce = newBrowserNonce()
    expect(bindAuthorizationRequest(request, nonce).jti).not.toBe(
      bindAuthorizationRequest(request, nonce).jti,
    )
  })

  test('the binding survives sealing and opening', () => {
    const nonce = newBrowserNonce()
    const bound = bindAuthorizationRequest(request, nonce)
    const opened = openAuthorizationRequest('secret', sealAuthorizationRequest('secret', bound))
    expect(opened).toEqual(bound)
    expect(requestMatchesBrowser(opened!, nonce)).toBe(true)
  })

  test('a sealed request altered to another browser hash is refused', () => {
    const bound = bindAuthorizationRequest(request, newBrowserNonce())
    const sealed = sealAuthorizationRequest('secret', bound)
    const [, signature] = sealed.split('.')
    const altered = Buffer.from(
      JSON.stringify({ ...bound, browser: 'other', exp: Date.now() + 60_000 }),
    ).toString('base64url')
    expect(openAuthorizationRequest('secret', `${altered}.${signature}`)).toBeNull()
  })
})

describe('proxy policy for OAuth paths', () => {
  test('the revocation endpoint is exempt from the browser CSRF check, the consent form is not', () => {
    expect(isCsrfExemptPath('/api/oauth/revoke')).toBe(true)
    expect(isCsrfExemptPath('/api/oauth/token')).toBe(true)
    expect(isCsrfExemptPath('/api/oauth/authorize')).toBe(false)
  })

  test('the consent page gets a strict CSP; the admin keeps its own', () => {
    const consent = contentSecurityPolicyFor('/oauth/authorize')
    // Scripts from this origin only: no inline and no eval.
    expect(consent).toMatch(/script-src 'self';/)
    expect(consent).not.toContain('unsafe-eval')
    expect(consent).toContain("form-action 'self'")
    expect(contentSecurityPolicyFor('/admin/reports')).toContain("'unsafe-eval'")
  })
})
