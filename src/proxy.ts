import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyAuthToken } from '@/lib/verifyAuthToken'

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
 * Proxy (the Next.js `middleware` file convention, renamed to `proxy` in Next 16)
 * to handle:
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
      {
        error: {
          code: 'CSRF_REJECTED',
          message: 'Server misconfigured — cannot verify request origin.',
        },
      },
      { status: 403 },
    )
  }

  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  // If neither header is present, block the request. Modern browsers always send
  // Origin on cross-origin requests. Missing both headers on a mutation is suspicious.
  if (!origin && !referer) {
    return NextResponse.json(
      {
        error: {
          code: 'CSRF_REJECTED',
          message: 'Missing Origin and Referer headers on mutation request.',
        },
      },
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

/**
 * Public endpoints authenticated by their own secret rather than a session
 * cookie — the marketing-site intake forms (API key + HMAC) and inbound
 * webhooks (shared secret). They are called cross-origin / server-to-server
 * (e.g. ClickSend), so the browser CSRF origin check does not apply and would
 * wrongly reject them (no Origin/Referer to match). Auth is enforced in-route.
 */
const CSRF_EXEMPT_PREFIXES = ['/api/intake/', '/api/webhooks/']

function isCsrfExemptPath(pathname: string): boolean {
  return CSRF_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))
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
  !!process.env.PAYLOAD_SECRET &&
  process.env.PAYLOAD_SECRET !== 'build-placeholder-not-for-production'

export async function proxy(request: NextRequest) {
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
  // Block cross-origin mutation requests (POST/PUT/PATCH/DELETE), except the
  // secret-authenticated public API surface (intake forms + inbound webhooks),
  // which is cross-origin/server-to-server by design and carries no session
  // cookie — see isCsrfExemptPath.
  if (pathname !== '/api/health' && !isCsrfExemptPath(pathname)) {
    const csrfBlocked = verifyCsrfOrigin(request)
    if (csrfBlocked) return csrfBlocked
  }

  // --- GraphQL + /api/access auth gate ---
  // These built-in Payload endpoints must require authentication to prevent
  // schema disclosure and unauthenticated mutations (C3, H1).
  if (pathname === '/api/graphql' || pathname === '/api/access') {
    const payloadTokenForApi = request.cookies.get('payload-token')
    if (!(await verifyAuthToken(payloadTokenForApi?.value, process.env.PAYLOAD_SECRET))) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } },
        { status: 401 },
      )
    }
  }

  // --- Admin route redirect workaround ---
  // Only /admin and /admin/login are intercepted, so verify the token (signature
  // + expiry) only for those. Using the SAME verification as payload.auth() keeps
  // this routing decision in agreement with the view/API auth gate — a token that
  // is unexpired but unverifiable (stale/rotated secret) is no longer treated as
  // "logged in" here, which is what previously bounced such sessions to the
  // dashboard while every view 403'd.
  const isAdminRoot = pathname === '/admin' || pathname === '/admin/'
  const isAdminLogin = pathname === '/admin/login' || pathname === '/admin/login/'

  if (isAdminRoot || isAdminLogin) {
    // If a protected view rejected the token, it redirects here with ?invalidate.
    // Clear the stale cookie to break the login ↔ dashboard redirect loop —
    // independent of token validity.
    if (isAdminLogin && request.nextUrl.searchParams.has('invalidate')) {
      const loginUrl = new URL('/admin/login', request.url)
      loginUrl.searchParams.delete('invalidate')
      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete('payload-token')
      return setSecurityHeaders(response)
    }

    const payloadToken = request.cookies.get('payload-token')
    const hasValidToken = await verifyAuthToken(payloadToken?.value, process.env.PAYLOAD_SECRET)

    if (hasValidToken) {
      return setSecurityHeaders(NextResponse.redirect(new URL('/admin/dashboard', request.url)))
    }
    if (isAdminRoot) {
      return setSecurityHeaders(NextResponse.redirect(new URL('/admin/login', request.url)))
    }
    // /admin/login without a valid token → fall through and render the login page.
  }

  return setSecurityHeaders(NextResponse.next())
}

// Match all routes so Cloudflare origin check applies globally.
// Health check is explicitly excluded in the handler above.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
