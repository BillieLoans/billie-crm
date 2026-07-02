/**
 * API Route: GET /api/collections/cases
 *
 * List collection cases from the `collection-cases` read-model projection
 * (BTB-199), enriched with loan-account details and live ledger aging
 * (BTB-200 WS2).
 *
 * Query params:
 * - state: Filter by case state ('open' | 'awaiting_human' | 'cured')
 * - rung: Filter by current reminder rung (number)
 * - hardshipPaused: 'true' to filter to hardship-paused cases
 * - stoppedContact: 'true' to filter to stop-contact cases
 * - customerId: Filter by customer ID string (Task-4 hook interface)
 * - page: Page number (default 1)
 * - limit: Page size (default 50, max 100)
 */

import { NextRequest, NextResponse } from 'next/server'
import type { Where } from 'payload'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { getLedgerClient } from '@/server/grpc-client'
import { buildCollectionsCaseRow } from '@/lib/collections/case-row'
import type { CollectionsCaseAging, CollectionsCaseRow } from '@/types/collections'

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { payload } = auth

    const sp = req.nextUrl.searchParams
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1)
    const limit = Math.min(100, Math.max(1, Number(sp.get('limit') ?? '50') || 50))

    const where: Where[] = []
    const state = sp.get('state')
    if (state) where.push({ state: { equals: state } })
    const rungRaw = sp.get('rung')
    const rung = rungRaw === null ? null : Number(rungRaw)
    if (rung !== null && Number.isFinite(rung)) where.push({ rung: { equals: rung } })
    if (sp.get('hardshipPaused') === 'true') where.push({ hardshipPaused: { equals: true } })
    if (sp.get('stoppedContact') === 'true') where.push({ stoppedContact: { equals: true } })
    if (sp.get('customerId')) where.push({ customerId: { equals: sp.get('customerId') } })

    const result = await payload.find({
      collection: 'collection-cases',
      where: where.length ? { and: where } : undefined,
      sort: '-updatedAt',
      page,
      limit,
      depth: 0,
    })

    // loan-account enrichment — field names copied verbatim from
    // src/app/api/ledger/aging/overdue/route.ts (accountNumber / customerIdString / customerName)
    const accountIds = result.docs.map((d: any) => d.accountId)
    const loanAccounts = accountIds.length
      ? await payload.find({
          collection: 'loan-accounts',
          where: { loanAccountId: { in: accountIds } },
          limit: accountIds.length,
          depth: 0,
        })
      : { docs: [] as any[] }
    const byAccountId = new Map(loanAccounts.docs.map((a: any) => [a.loanAccountId, a]))

    // ledger aging enrichment — same UNAVAILABLE (code 14) fallback contract
    // as /api/ledger/aging/overdue
    let agingByAccount = new Map<string, CollectionsCaseAging>()
    let agingUnavailable = false
    try {
      const overdue = await getLedgerClient().getOverdueAccounts({ pageSize: 1000 })
      agingByAccount = new Map(
        (overdue.accounts ?? []).map((a: any) => [
          a.accountId ?? a.account_id,
          {
            dpd: Number(a.dpd ?? 0),
            bucket: String(a.bucket ?? ''),
            totalOverdue: String(a.totalOverdueAmount ?? a.total_overdue_amount ?? ''),
          },
        ]),
      )
    } catch (err: any) {
      if (err?.code === 14 || err?.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable for collection-cases aging enrichment')
        agingUnavailable = true
      } else {
        throw err
      }
    }

    const cases: CollectionsCaseRow[] = result.docs.map((doc: any) => {
      const la = byAccountId.get(doc.accountId)
      return buildCollectionsCaseRow(doc, la, agingByAccount.get(doc.accountId) ?? null)
    })

    return NextResponse.json({
      cases,
      totalDocs: result.totalDocs,
      page: result.page,
      totalPages: result.totalPages,
      hasNextPage: result.hasNextPage,
      agingUnavailable,
    })
  } catch (error) {
    console.error('Error fetching collection cases:', error)
    return NextResponse.json(
      {
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch collection cases' },
      },
      { status: 500 },
    )
  }
}
