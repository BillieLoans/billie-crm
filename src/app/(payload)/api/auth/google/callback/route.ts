/**
 * API Route: GET /api/auth/google/callback
 *
 * Handles the Google OAuth callback: validates state, exchanges the
 * authorization code for tokens, verifies the ID token, looks up the
 * user in Payload, issues a payload-token JWT, and redirects to the
 * admin dashboard.
 */

import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { getPayload } from 'payload'
import config from '@payload-config'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

interface GoogleTokenResponse {
  access_token: string
  id_token: string
  token_type: string
  expires_in: number
}

interface GoogleIdTokenPayload {
  iss: string
  sub: string
  aud: string
  email: string
  email_verified: boolean
  hd?: string
  name?: string
  given_name?: string
  family_name?: string
  exp: number
  iat: number
}

/**
 * Decode a JWT payload without verifying the signature.
 * We trust the ID token because it was just received directly from Google's
 * token endpoint over HTTPS — not from a client.
 */
function decodeJwtPayload(jwt: string): GoogleIdTokenPayload {
  const parts = jwt.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT structure')
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8')
  return JSON.parse(payload)
}

/** Token expiration in seconds (2 hours) */
const TOKEN_EXPIRATION = 7200

/**
 * Sign a Payload-compatible JWT using jose (same library Payload uses internally).
 * Uses payload.secret directly to guarantee compatibility.
 */
async function signPayloadToken(
  user: { id: string; email: string; collection: string },
  secret: string,
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret)
  const now = Math.floor(Date.now() / 1000)

  return new SignJWT({
    id: user.id,
    collection: user.collection,
    email: user.email,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_EXPIRATION)
    .sign(secretKey)
}

function redirectWithError(_request: NextRequest, error: string): NextResponse {
  const url = new URL('/admin/login', APP_URL)
  url.searchParams.set('error', error)
  const response = NextResponse.redirect(url)
  response.cookies.delete('google_oauth_state')
  return response
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  // 1. Validate state parameter
  const state = searchParams.get('state')
  const storedState = request.cookies.get('google_oauth_state')?.value

  if (!state || !storedState || state !== storedState) {
    return redirectWithError(request, 'invalid-state')
  }

  // Check for error from Google
  const errorParam = searchParams.get('error')
  if (errorParam) {
    console.error('Google OAuth error:', errorParam)
    return redirectWithError(request, 'oauth-denied')
  }

  const code = searchParams.get('code')
  if (!code) {
    return redirectWithError(request, 'missing-code')
  }

  try {
    // 2. Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${APP_URL}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text()
      console.error('Google token exchange failed:', errorBody)
      return redirectWithError(request, 'token-exchange-failed')
    }

    const tokens: GoogleTokenResponse = await tokenResponse.json()

    // 3. Verify the ID token
    const claims = decodeJwtPayload(tokens.id_token)

    if (claims.hd !== 'billie.loans') {
      console.error('Domain mismatch:', claims.hd)
      return redirectWithError(request, 'invalid-domain')
    }

    if (!claims.email_verified) {
      console.error('Email not verified:', claims.email)
      return redirectWithError(request, 'email-not-verified')
    }

    // 4. Look up user by email in Payload
    const payload = await getPayload({ config })
    const { docs } = await payload.find({
      collection: 'users',
      where: { email: { equals: claims.email } },
      limit: 1,
    })

    const user = docs[0]

    // 5. User not found — must be pre-provisioned
    if (!user) {
      return redirectWithError(request, 'not-provisioned')
    }

    // 6. Generate payload-token JWT and set as cookie
    const payloadToken = await signPayloadToken(
      { id: String(user.id), email: user.email, collection: 'users' },
      payload.secret,
    )

    const response = NextResponse.redirect(new URL('/admin/dashboard', APP_URL))

    response.cookies.set('payload-token', payloadToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      sameSite: 'lax',
      maxAge: 7200, // 2 hours
    })

    // Clean up the state cookie
    response.cookies.delete('google_oauth_state')

    return response
  } catch (error) {
    console.error('Google OAuth callback error:', error)
    return redirectWithError(request, 'callback-failed')
  }
}
