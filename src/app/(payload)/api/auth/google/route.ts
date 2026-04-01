/**
 * API Route: GET /api/auth/google
 *
 * Initiates the Google OAuth flow: generates a CSRF state token,
 * stores it in an httpOnly cookie, and redirects to Google's
 * authorization endpoint.
 */

import { NextResponse } from 'next/server'
import crypto from 'node:crypto'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function GET() {
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

  return response
}
