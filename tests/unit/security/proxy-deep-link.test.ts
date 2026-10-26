// @vitest-environment node
// jose's HS256 sign/verify relies on `instanceof Uint8Array`, which breaks under
// jsdom (cross-realm Uint8Array) — see verifyAuthToken.test.ts.
import { createHash } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import { SignJWT } from 'jose'
import { NextRequest } from 'next/server'

/**
 * A signed-out visit to an admin screen must come back to that screen after
 * sign-in. src/proxy.ts sends it to /admin/login?redirect=<screen>, which
 * Payload's login form and the Google sign-in honour; a signed-in visit to
 * /admin/login follows a safe ?redirect= or falls back to the dashboard.
 */

const SECRET = 'test-secret-value-1234567890-abcdef'
const APP = 'https://crm.billie.loans'

// proxy.ts reads PAYLOAD_SECRET at import time.
vi.hoisted(() => {
  process.env.PAYLOAD_SECRET = 'test-secret-value-1234567890-abcdef'
  process.env.DISABLE_CF_SECRET_CHECK = 'true'
  process.env.NEXT_PUBLIC_APP_URL = 'https://crm.billie.loans'
})

import { isDeepLinkAdminPath, postLoginPath, proxy } from '@/proxy'

/** A session token as Payload's login and the Google callback issue it. */
async function sessionToken(): Promise<string> {
  const key = createHash('sha256').update(SECRET).digest('hex').slice(0, 32)
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ id: 'user-1', collection: 'users', email: 'test@billie.loans' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(new TextEncoder().encode(key))
}

async function visit(path: string, token?: string) {
  const headers = token ? { cookie: `payload-token=${token}` } : undefined
  return proxy(new NextRequest(`${APP}${path}`, { headers }))
}

function location(response: Response): string | null {
  const value = response.headers.get('location')
  if (!value) return null
  const url = new URL(value)
  return `${url.pathname}${url.search}`
}

const APPLICATION = '/admin/applications/66b92e96-b4c8-48a8-976d-fbb9a24910f1'

describe('signed out', () => {
  test('a deep link goes to the login page, remembering the screen', async () => {
    const response = await visit(APPLICATION)
    expect(location(response)).toBe(`/admin/login?redirect=${encodeURIComponent(APPLICATION)}`)
  })

  test('the query string is remembered too', async () => {
    const response = await visit('/admin/servicing/C123?tab=transactions')
    expect(location(response)).toBe(
      `/admin/login?redirect=${encodeURIComponent('/admin/servicing/C123?tab=transactions')}`,
    )
  })

  test('the login page itself renders', async () => {
    const response = await visit(`/admin/login?redirect=${encodeURIComponent(APPLICATION)}`)
    expect(location(response)).toBeNull()
  })

  test('/admin goes to a bare login page', async () => {
    expect(location(await visit('/admin'))).toBe('/admin/login')
  })

  test('a stale session is cleared and the return path kept', async () => {
    const response = await visit(
      `/admin/login?invalidate&redirect=${encodeURIComponent(APPLICATION)}`,
    )
    expect(location(response)).toBe(`/admin/login?redirect=${encodeURIComponent(APPLICATION)}`)
    expect(response.headers.get('set-cookie')).toMatch(/payload-token=;/)
  })
})

describe('signed in', () => {
  test('a deep link renders', async () => {
    expect(location(await visit(APPLICATION, await sessionToken()))).toBeNull()
  })

  test('the login page follows ?redirect=', async () => {
    const response = await visit(
      `/admin/login?redirect=${encodeURIComponent(APPLICATION)}`,
      await sessionToken(),
    )
    expect(location(response)).toBe(APPLICATION)
  })

  test('the login page without ?redirect= goes to the dashboard', async () => {
    expect(location(await visit('/admin/login', await sessionToken()))).toBe('/admin/dashboard')
  })

  test('an off-site ?redirect= goes to the dashboard', async () => {
    const response = await visit(
      `/admin/login?redirect=${encodeURIComponent('//evil.example/x')}`,
      await sessionToken(),
    )
    expect(location(response)).toBe('/admin/dashboard')
  })

  test('a token signed with another secret counts as signed out', async () => {
    const forged = await new SignJWT({ id: 'user-1', collection: 'users' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(new TextEncoder().encode('another-secret-another-secret-12'))
    expect(location(await visit(APPLICATION, forged))).toBe(
      `/admin/login?redirect=${encodeURIComponent(APPLICATION)}`,
    )
  })
})

describe('isDeepLinkAdminPath', () => {
  test.each([APPLICATION, '/admin/dashboard', '/admin/collections/users/abc', '/admin/reports'])(
    '%s needs a session',
    (path) => expect(isDeepLinkAdminPath(path)).toBe(true),
  )

  test.each([
    '/admin',
    '/admin/',
    '/admin/login',
    '/admin/logout',
    '/admin/logout-inactivity',
    '/admin/forgot',
    '/admin/reset/token123',
    '/admin/create-first-user',
    '/admin/unauthorized',
    '/admin/users/verify/token123',
    '/api/customers',
    '/oauth/authorize',
  ])('%s is not a deep link', (path) => expect(isDeepLinkAdminPath(path)).toBe(false))
})

describe('postLoginPath', () => {
  test.each([
    [APPLICATION, APPLICATION],
    ['/oauth/authorize?req=abc', '/oauth/authorize?req=abc'],
    [null, '/admin/dashboard'],
    ['', '/admin/dashboard'],
    ['https://evil.example/', '/admin/dashboard'],
    ['/admin', '/admin/dashboard'],
    ['/admin/login?redirect=/admin/login', '/admin/dashboard'],
  ])('%s → %s', (redirect, expected) => {
    expect(postLoginPath(redirect, APP)).toBe(expected)
  })
})
