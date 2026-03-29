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
  const cookieHeader = headersList.get('cookie') || ''

  const { user } = await payload.auth({
    headers: new Headers({ cookie: cookieHeader }),
  })

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
