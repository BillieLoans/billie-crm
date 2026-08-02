/** GET /api/marketing/releases/gate-status — projected billieChat gate mode. */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canReadMarketing } from '@/lib/access'

export async function GET() {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth

  const rows = await payload.find({
    collection: 'release-gate-status',
    where: { gateId: { equals: 'gate' } } as never,
    limit: 1,
    overrideAccess: false,
    user,
  })
  const row = rows.docs[0] as { mode?: string; setBy?: string; changedAt?: string } | undefined
  return NextResponse.json({
    mode: row?.mode ?? 'open',
    setBy: row?.setBy ?? null,
    changedAt: row?.changedAt ?? null,
  })
}
