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
/**
 * Check if a JWT is structurally valid and not expired.
 *
 * This does NOT verify the signature (we don't have PAYLOAD_SECRET in edge
 * runtime for crypto). It only decodes the payload and checks the `exp` claim.
 * Full signature verification happens later in `payload.auth()` at the route level.
 */
function isJwtNotExpired(token: string | undefined): boolean {
  if (!token) return false
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const payload = JSON.parse(atob(parts[1]))
    if (typeof payload.exp !== 'number') return false
    return payload.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

/**
 * CSRF protection via Origin header validation.
 *
 * For state-changing requests (POST, PUT, PATCH, DELETE), verify that the
 * Origin or Referer header matches the expected app URL. Browsers always
 * send Origin on cross-origin requests, so a mismatch indicates CSRF.
 */
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function verifyCsrfOrigin(request: NextRequest): NextResponse | null {
  if (!MUTATION_METHODS.has(request.method)) return null

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    // Fail closed: block mutations if we can't verify the origin
    return NextResponse.json(
      { error: { code: 'CSRF_REJECTED', message: 'Server misconfigured — cannot verify request origin.' } },
      { status: 403 },
    )
  }

  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  // If neither header is present, block the request. Modern browsers always send
  // Origin on cross-origin requests. Missing both headers on a mutation is suspicious.
  if (!origin && !referer) {
    return NextResponse.json(
      { error: { code: 'CSRF_REJECTED', message: 'Missing Origin and Referer headers on mutation request.' } },
      { status: 403 },
    )
  }

  const allowedOrigin = new URL(appUrl).origin

  if (origin && origin !== allowedOrigin) {
    return NextResponse.json(
      { error: { code: 'CSRF_REJECTED', message: 'Cross-origin request blocked.' } },
      { status: 403 },
    )
  }

  if (!origin && referer) {
    try {
      const refererOrigin = new URL(referer).origin
      if (refererOrigin !== allowedOrigin) {
        return NextResponse.json(
          { error: { code: 'CSRF_REJECTED', message: 'Cross-origin request blocked.' } },
          { status: 403 },
        )
      }
    } catch {
      // Malformed referer — block
      return NextResponse.json(
        { error: { code: 'CSRF_REJECTED', message: 'Cross-origin request blocked.' } },
        { status: 403 },
      )
    }
  }

  return null
}

function setSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.gravatar.com; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  )
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

  // --- CSRF origin validation ---
  // Block cross-origin mutation requests (POST/PUT/PATCH/DELETE)
  if (pathname !== '/api/health') {
    const csrfBlocked = verifyCsrfOrigin(request)
    if (csrfBlocked) return csrfBlocked
  }

  // --- GraphQL + /api/access auth gate ---
  // These built-in Payload endpoints must require authentication to prevent
  // schema disclosure and unauthenticated mutations (C3, H1).
  if (pathname === '/api/graphql' || pathname === '/api/access') {
    const payloadTokenForApi = request.cookies.get('payload-token')
    if (!isJwtNotExpired(payloadTokenForApi?.value)) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } },
        { status: 401 },
      )
    }
  }

  // --- Admin route redirect workaround ---
  const payloadToken = request.cookies.get('payload-token')
  const hasValidToken = isJwtNotExpired(payloadToken?.value)

  if (pathname === '/admin' || pathname === '/admin/') {
    if (hasValidToken) {
      return setSecurityHeaders(NextResponse.redirect(new URL('/admin/dashboard', request.url)))
    } else {
      return setSecurityHeaders(NextResponse.redirect(new URL('/admin/login', request.url)))
    }
  }

  if (pathname === '/admin/login' || pathname === '/admin/login/') {
    // If a protected view rejected the token (Payload auth failed despite valid JWT structure),
    // clear the stale cookie to break the login ↔ dashboard redirect loop.
    if (request.nextUrl.searchParams.has('invalidate')) {
      const loginUrl = new URL('/admin/login', request.url)
      loginUrl.searchParams.delete('invalidate')
      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete('payload-token')
      return setSecurityHeaders(response)
    }
    if (hasValidToken) {
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
