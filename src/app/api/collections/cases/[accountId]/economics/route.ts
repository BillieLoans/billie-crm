/**
 * API Route: GET /api/collections/cases/[accountId]/economics
 *
 * Per-account cost-of-recovery economics from the headless collections
 * engine (BTB-198 WS5). Phase 2 (BTB-194) is unspecified/undeployed —
 * until then the provider returns `gate_result = NOT_APPLICABLE` and
 * empty economics rather than erroring (see proto/collections_service.proto).
 *
 * Same UNAVAILABLE (gRPC code 14) graceful-degrade contract as the ledger
 * reads elsewhere in this app (e.g. /api/ledger/aging/overdue): the UI
 * gets a 200 with `unavailable: true` instead of a hard failure.
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
    const economics = await getCollectionsServiceClient().getCaseEconomics(accountId)
    return NextResponse.json({ economics })
  } catch (err: any) {
    if (isNotFound(err))
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'unknown account' } }, { status: 404 })
    if (isUnavailable(err)) return NextResponse.json({ economics: null, unavailable: true })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'collections service error' } },
      { status: 502 },
    )
  }
}
