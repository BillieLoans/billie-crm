/**
 * API Route: GET /api/auth/logout
 *
 * Custom logout for the CRM's custom (Google OAuth) authentication.
 *
 * Login sets the `payload-token` cookie by hand (see
 * src/app/(payload)/api/auth/google/callback/route.ts), so logout must be
 * symmetric: explicitly expire that cookie. We do NOT rely on Payload's built-in
 * `/admin/logout`, whose client `logOut()` swallows any failure of the
 * `POST /api/users/logout` call and redirects regardless — which can leave the
 * session cookie intact while reporting "logged out".
 *
 * Clearing the cookie here is deterministic: the response carries a Set-Cookie
 * that expires `payload-token` (matching the attributes it was set with, so the
 * browser actually removes it), then redirects to the login page. The proxy's
 * CSRF check only guards mutating methods, so a GET navigation passes cleanly.
 */

import { NextResponse } from 'next/server'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export function GET(): NextResponse {
  const response = NextResponse.redirect(new URL('/admin/login', APP_URL), { status: 303 })

  // Expire the cookie using the same attributes the Google callback set it with
  // (host-only, path '/', SameSite=Lax, Secure in prod). Cookie deletion matches
  // on name + path + domain, so path '/' is what matters here.
  response.cookies.set('payload-token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    sameSite: 'lax',
    maxAge: 0,
    expires: new Date(0),
  })

  return response
}
