import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Cloudflare origin verification.
 *
 * Ensures requests arrive via Cloudflare by checking a shared secret header.
 * - CF_SECRET: the expected value of the x-origin-secret header (set on both
 *   Cloudflare and Fly.io as a secret).
 * - DISABLE_CF_SECRET_CHECK: set to "true" to bypass the check (e.g. local dev).
 *
 * Health check is excluded so Fly.io's internal probes continue to work.
 */
function verifyCloudflareOrigin(request: NextRequest): NextResponse | null {
  if (process.env.DISABLE_CF_SECRET_CHECK === 'true') {
    return null
  }

  const cfSecret = process.env.CF_SECRET
  if (!cfSecret) {
    // In production, fail closed — deny requests if CF_SECRET is not configured.
    // In non-production (dev/staging), allow through for flexibility.
    if (process.env.NODE_ENV === 'production') {
      console.error('[Middleware] CF_SECRET is not set in production — blocking request')
      return new NextResponse('Forbidden', { status: 403 })
    }
    return null
  }

  const originSecret = request.headers.get('x-origin-secret')
  if (originSecret !== cfSecret) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  return null
}

/**
 * Middleware to handle:
 * 1. Cloudflare origin verification (all routes except health check)
 * 2. Admin route redirects to break Payload 3.45.0 redirect loop
 *
 * ISSUE: Payload CMS 3.45.0 has a bug where the built-in /admin and /admin/login
 * routes have inconsistent authentication checking, causing a 307 redirect loop:
 *   - /admin thinks the user is NOT authenticated → redirects to /admin/login
 *   - /admin/login thinks the user IS authenticated → redirects to /admin
 *   - Loop continues even though payload-token cookie is valid
 *
 * This issue only affects Payload's built-in routes. Custom views using
 * initPageResult?.req?.user or payload.auth({ headers }) work correctly.
 *
 * SOLUTION: Intercept /admin and /admin/login in Next.js middleware (which runs
 * BEFORE Payload's routing) and redirect based on payload-token cookie presence.
 *
 * TODO: Remove the admin redirect workaround when upgrading to a Payload version
 * that fixes the built-in route authentication issue.
 */
function setSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  return response
}

const hasPayloadSecret =
  !!process.env.PAYLOAD_SECRET && process.env.PAYLOAD_SECRET !== 'build-placeholder-not-for-production'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // --- Runtime env validation ---
  // Block all non-health requests if PAYLOAD_SECRET is missing (misconfigured deploy)
  if (!hasPayloadSecret && pathname !== '/api/health') {
    return new NextResponse('Service misconfigured', { status: 503 })
  }

  // --- Cloudflare origin verification ---
  // Skip for health check (Fly.io internal probes don't go through Cloudflare)
  if (pathname !== '/api/health') {
    const blocked = verifyCloudflareOrigin(request)
    if (blocked) return blocked
  }

  // --- Admin route redirect workaround ---
  const payloadToken = request.cookies.get('payload-token')

  if (pathname === '/admin' || pathname === '/admin/') {
    if (payloadToken?.value) {
      return setSecurityHeaders(NextResponse.redirect(new URL('/admin/dashboard', request.url)))
    } else {
      return setSecurityHeaders(NextResponse.redirect(new URL('/admin/login', request.url)))
    }
  }

  if (pathname === '/admin/login' || pathname === '/admin/login/') {
    if (payloadToken?.value) {
      return setSecurityHeaders(NextResponse.redirect(new URL('/admin/dashboard', request.url)))
    }
  }

  return setSecurityHeaders(NextResponse.next())
}

// Match all routes so Cloudflare origin check applies globally.
// Health check is explicitly excluded in the handler above.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
