/**
 * POST /api/statements/deletion/preview
 *
 * Lists what a statement deletion would remove, without deleting anything.
 * Admin or supervisor only. Body is a DeletionScope.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'
import { DeletionScopeSchema } from '@/lib/schemas/statement-deletion'
import { rateLimit, STATEMENT_DELETION_RATE_LIMIT } from '@/lib/utils/rateLimit'
import { previewDeletion } from '@/server/statement-deletion'

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

    const parsed = DeletionScopeSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return err('VALIDATION_ERROR', 'A valid scope and id are required.', 400)
    }

    const applications = await previewDeletion(payload, parsed.data)
    if (applications.length === 0) {
      return err('NOT_FOUND', 'No application matches that request.', 404)
    }
    return NextResponse.json({ applications })
  } catch (error) {
    console.error('[StatementDeletion] Preview error:', error)
    return err('INTERNAL_ERROR', 'An unexpected error occurred.', 500)
  }
}
