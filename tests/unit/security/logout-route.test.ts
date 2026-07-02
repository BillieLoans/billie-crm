// @vitest-environment node
import { describe, test, expect } from 'vitest'
import { GET } from '@/app/(payload)/api/auth/logout/route'

/**
 * Tests for src/app/(payload)/api/auth/logout/route.ts — the custom logout route.
 *
 * Login is custom (Google OAuth sets `payload-token` by hand), so logout must be
 * symmetric: explicitly expire that cookie rather than relying on Payload's
 * built-in logout, whose client `logOut()` swallows POST failures and redirects
 * regardless — leaving the session alive. This route deletes the cookie
 * server-side and redirects to the login page deterministically.
 */
describe('logout route', () => {
  test('redirects to the admin login page', () => {
    const res = GET()
    expect([302, 303, 307]).toContain(res.status)
    expect(res.headers.get('location')).toContain('/admin/login')
  })

  test('expires the payload-token cookie so the browser removes it', () => {
    const res = GET()
    const cookie = res.cookies.get('payload-token')
    expect(cookie).toBeDefined()
    expect(cookie?.value).toBe('')
    expect(cookie?.maxAge).toBe(0)
    // Path must match how the Google callback set it (host-only, path '/') for
    // the browser to actually delete it.
    expect(cookie?.path).toBe('/')
  })
})
