/**
 * POST /api/pending-disbursements/access-log
 *
 * Records that an operator revealed or copied a customer's payout bank details
 * from the disbursement queue. `docs/ux-standards.md` §4 requires full
 * identifiers to be hidden by default and every reveal to be audited; copying
 * counts, because putting an account number on the clipboard discloses it just
 * as surely as displaying it.
 *
 * The entry is written server-side from the authenticated session, so the actor
 * cannot be spoofed by the client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'

const BodySchema = z.object({
  loanAccountId: z.string().min(1).max(200),
  accountNumber: z.string().max(200).nullish(),
  action: z.enum(['reveal', 'copy']),
  field: z.enum(['accountNumber', 'bsb', 'holder', 'all']),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Body must be JSON.' } },
        { status: 400 },
      )
    }

    const parsed = BodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid access-log entry.' } },
        { status: 400 },
      )
    }

    await payload.create({
      collection: 'disbursement-access-log',
      data: {
        loanAccountId: parsed.data.loanAccountId,
        accountNumber: parsed.data.accountNumber ?? null,
        action: parsed.data.action,
        field: parsed.data.field,
        // Actor comes from the session, never from the request body.
        actor: user.id,
        actorEmail: user.email ?? null,
        occurredAt: new Date().toISOString(),
      },
      overrideAccess: false,
      user,
    })

    return NextResponse.json({ recorded: true })
  } catch (error) {
    console.error('[Disbursement Access Log] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to record access.' } },
      { status: 500 },
    )
  }
}
