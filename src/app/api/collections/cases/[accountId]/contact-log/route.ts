/**
 * API Route: GET /api/collections/cases/[accountId]/contact-log
 *
 * Per-account contact log + cap status from the headless collections
 * engine (BTB-198 WS5), backed by `collections.send_log` on the provider
 * side.
 *
 * Same UNAVAILABLE (gRPC code 14) graceful-degrade contract as the ledger
 * reads elsewhere in this app: the UI gets a 200 with `unavailable: true`
 * instead of a hard failure.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { getCollectionsServiceClient, isNotFound } from '@/server/collections-service-client'

function isUnavailable(err: any): boolean {
  return err?.code === 14 || (typeof err?.message === 'string' && err.message.includes('UNAVAILABLE'))
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error

  const { accountId } = await params

  try {
    const contactLog = await getCollectionsServiceClient().getContactLog(accountId)
    return NextResponse.json({ contactLog })
  } catch (err: any) {
    if (isNotFound(err))
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'unknown account' } }, { status: 404 })
    if (isUnavailable(err)) return NextResponse.json({ contactLog: null, unavailable: true })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'collections service error' } },
      { status: 502 },
    )
  }
}
