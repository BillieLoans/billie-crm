/**
 * API Route: PATCH /api/contact-notes/[id]/amend
 *
 * Marks a contact note's status as `amended` via a direct database write.
 *
 * Payload v3's `payload.update()` validates ALL required fields on the incoming
 * `data` before merging with the existing document, so a sparse update like
 * `{ status: 'amended' }` always fails required-field validation. Instead we
 * use `payload.db.updateOne()` which bypasses Payload hooks and field
 * validation — safe here because we perform our own auth, permission, existence,
 * and state checks before writing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { canService } from '@/lib/access'

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const payload = await getPayload({ config: configPromise })

    const headersList = await headers()
    const cookieHeader = headersList.get('cookie') || ''
    const { user } = await payload.auth({
      headers: new Headers({ cookie: cookieHeader }),
    })

    if (!user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } },
        { status: 401 },
      )
    }

    if (!canService(user)) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'You do not have permission to amend notes.' } },
        { status: 403 },
      )
    }

    const existing = await payload.findByID({
      collection: 'contact-notes',
      id,
      depth: 0,
    })

    if (!existing) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Contact note not found.' } },
        { status: 404 },
      )
    }

    if (existing.status === 'amended') {
      return NextResponse.json(
        { error: { code: 'INVALID_STATE', message: 'Note is already amended.' } },
        { status: 400 },
      )
    }

    await payload.db.updateOne({
      collection: 'contact-notes',
      id,
      data: {
        status: 'amended',
        updatedAt: new Date().toISOString(),
      },
    })

    return NextResponse.json({ doc: { id, status: 'amended' } })
  } catch (error) {
    console.error('[Contact Notes Amend] Error:', error)
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'An unexpected error occurred.',
        },
      },
      { status: 500 },
    )
  }
}
