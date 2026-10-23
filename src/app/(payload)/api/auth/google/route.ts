/**
 * API Route: GET /api/auth/google
 *
 * Initiates the Google OAuth flow: generates a CSRF state token,
 * stores it in an httpOnly cookie, and redirects to Google's
 * authorization endpoint. A same-origin `?redirect=` path (the login page
 * passes its own, e.g. the reporting connector's OAuth sign-in page) is kept
 * in a cookie for the callback to return to.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { safeReturnPath } from '@/lib/safeReturnPath'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function GET(request: NextRequest) {
  const state = crypto.randomBytes(32).toString('hex')

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', `${APP_URL}/api/auth/google/callback`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid email profile')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('hd', 'billie.loans')
  authUrl.searchParams.set('prompt', 'select_account')

  const response = NextResponse.redirect(authUrl.toString())

  response.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
  })

  const returnTo = safeReturnPath(request.nextUrl.searchParams.get('redirect'), APP_URL)
  if (returnTo) {
    response.cookies.set('google_oauth_redirect', returnTo, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      sameSite: 'lax',
      maxAge: 600,
    })
  } else {
    // A plain sign-in must not pick up an abandoned attempt's return path.
    response.cookies.delete('google_oauth_redirect')
  }

  return response
}
