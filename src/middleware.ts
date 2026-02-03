import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware to handle admin route redirects and break the redirect loop.
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
 * TODO: Remove this workaround when upgrading to a Payload version that fixes
 * the built-in route authentication issue.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const payloadToken = request.cookies.get('payload-token')
  
  // Handle /admin root - redirect based on auth state
  if (pathname === '/admin' || pathname === '/admin/') {
    if (payloadToken?.value) {
      // User has token → redirect to dashboard (bypass Payload's broken /admin)
      return NextResponse.redirect(new URL('/admin/dashboard', request.url))
    } else {
      // No token → redirect to login
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }
  }
  
  // Handle /admin/login - redirect authenticated users to dashboard
  if (pathname === '/admin/login' || pathname === '/admin/login/') {
    if (payloadToken?.value) {
      // User has token but is on login page → redirect to dashboard
      return NextResponse.redirect(new URL('/admin/dashboard', request.url))
    }
    // No token → let login page render
  }
  
  return NextResponse.next()
}

// Run on admin routes
export const config = {
  matcher: ['/admin', '/admin/', '/admin/login', '/admin/login/'],
}
