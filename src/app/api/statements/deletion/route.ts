/**
 * /api/statements/deletion
 *
 * POST: delete a customer's bank-statement files from S3 (a delete marker per
 *   key first, so the backup bucket learns of it, then the data versions). Admin
 *   or supervisor only. The service re-resolves the scope and re-lists S3 itself;
 *   nothing from a preview (or any client-supplied key) is trusted.
 * GET ?conversationId=: the latest deletion for an application, for any role.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole, hasApprovalAuthority } from '@/lib/access'
import { DeletionRequestSchema } from '@/lib/schemas/statement-deletion'
import { rateLimit, STATEMENT_DELETION_RATE_LIMIT } from '@/lib/utils/rateLimit'
import { DeletionLogWriteError, executeDeletion, latestDeletion } from '@/server/statement-deletion'

const err = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status })

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    if (!(await rateLimit(`statement-deletion:${user.id}`, STATEMENT_DELETION_RATE_LIMIT))) {
      return err('RATE_LIMITED', 'Too many requests. Try again in a minute.', 429)
    }

    const parsed = DeletionRequestSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return err(
        'VALIDATION_ERROR',
        'A valid scope, id and reason (1-500 characters) are required.',
        400,
      )
    }
    const { reason, ...scope } = parsed.data

    const actor = {
      id: String(user.id),
      email: user.email,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
    }
    const results = await executeDeletion(payload, scope, reason, actor)
    if (results.length === 0) {
      return err('NOT_FOUND', 'No application matches that request.', 404)
    }
    return NextResponse.json({ results })
  } catch (error) {
    console.error('[StatementDeletion] Delete error:', error)
    if (error instanceof DeletionLogWriteError) {
      // S3 work ran for at least one application before its log row failed.
      return err(
        'LOG_WRITE_FAILED',
        'The deletion may have partly happened. Check again before retrying.',
        500,
      )
    }
    return err('INTERNAL_ERROR', 'An unexpected error occurred.', 500)
  }
}

// This intentionally serves the latest deletion's reason and actor to every
// staff role: the spec puts the "deleted on/by" note in the Statements section
// for all staff. The raw `statement-file-deletions` collection (keys, warnings,
// every attempt) stays approver-only.
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { payload } = auth

    const conversationId = request.nextUrl.searchParams.get('conversationId')?.trim()
    if (!conversationId) {
      return err('VALIDATION_ERROR', 'conversationId is required.', 400)
    }
    const deletion = await latestDeletion(payload, conversationId)
    return NextResponse.json({ deletion })
  } catch (error) {
    console.error('[StatementDeletion] Latest error:', error)
    return err('INTERNAL_ERROR', 'An unexpected error occurred.', 500)
  }
}
