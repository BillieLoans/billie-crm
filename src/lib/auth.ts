/**
 * Authentication and authorization utility for API routes.
 *
 * Usage:
 *   import { requireAuth } from '@/lib/auth'
 *   import { canService } from '@/lib/access'
 *
 *   export async function POST(request: NextRequest) {
 *     const auth = await requireAuth(canService)
 *     if ('error' in auth) return auth.error
 *     const { user, payload } = auth
 *     // ...
 *   }
 */

import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import configPromise from '@payload-config'
import type { User } from '@/payload-types'

type AuthSuccess = { user: User; payload: Payload }
type AuthError = { error: NextResponse }

export async function requireAuth(
  accessCheck?: (user: unknown) => boolean,
): Promise<AuthSuccess | AuthError> {
  const payload = await getPayload({ config: configPromise })
  const headersList = await headers()

  // Forward the full incoming request headers (not just `cookie`). Payload 3.85's
  // extractJWT enforces a CSRF check on cookie-based auth: it only honours the
  // payload-token cookie when the request carries an allowlisted `Origin` or a
  // `Sec-Fetch-Site` of same-origin/same-site/none. A cookie-only Headers object
  // (which worked pre-3.85) now fails that check, returning user: null → 401.
  const authHeaders = new Headers()
  headersList.forEach((value, key) => {
    authHeaders.append(key, value)
  })

  const { user } = await payload.auth({ headers: authHeaders })

  if (!user) {
    return {
      error: NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } },
        { status: 401 },
      ),
    }
  }

  if (accessCheck && !accessCheck(user)) {
    return {
      error: NextResponse.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to perform this action.',
          },
        },
        { status: 403 },
      ),
    }
  }

  return { user: user as User, payload }
}
