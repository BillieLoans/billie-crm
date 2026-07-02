/**
 * API Route: GET /api/collections/cases/[accountId]
 *
 * Single collection case detail from the `collection-cases` read-model
 * projection (BTB-199), with the same loan-account + ledger aging
 * enrichment as the list route (BTB-200 WS2).
 *
 * Row mapping is shared with the list route via
 * `@/lib/collections/case-row` (C3 review) — behaviour must stay identical
 * between the two routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { getLedgerClient } from '@/server/grpc-client'
import { buildCollectionsCaseRow } from '@/lib/collections/case-row'
import type { CollectionsCaseAging, CollectionsCaseRow } from '@/types/collections'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { payload } = auth

    const { accountId } = await params

    const result = await payload.find({
      collection: 'collection-cases',
      where: { accountId: { equals: accountId } },
      limit: 1,
      depth: 0,
    })

    const doc = result.docs[0] as any
    if (!doc) {
      return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
    }

    // loan-account enrichment — field names copied verbatim from
    // src/app/api/ledger/aging/overdue/route.ts (accountNumber / customerIdString / customerName)
    const loanAccounts = await payload.find({
      collection: 'loan-accounts',
      where: { loanAccountId: { equals: doc.accountId } },
      limit: 1,
      depth: 0,
    })
    const la = loanAccounts.docs[0] as any

    // ledger aging enrichment — filtered in memory for this account; same
    // UNAVAILABLE (code 14) fallback contract as /api/ledger/aging/overdue
    let aging: CollectionsCaseAging | null = null
    try {
      const overdue = await getLedgerClient().getOverdueAccounts({ pageSize: 1000 })
      const match = ((overdue.accounts ?? []) as any[]).find(
        (a: any) => (a.accountId ?? a.account_id) === doc.accountId,
      )
      if (match) {
        aging = {
          dpd: Number(match.dpd ?? 0),
          bucket: String(match.bucket ?? ''),
          totalOverdue: String(match.totalOverdueAmount ?? match.total_overdue_amount ?? ''),
        }
      }
    } catch (err: any) {
      if (err?.code === 14 || err?.message?.includes('UNAVAILABLE')) {
        console.warn('Ledger service unavailable for collection-case aging enrichment')
        // aging stays null — same degrade contract as the list route
      } else {
        throw err
      }
    }

    const row: CollectionsCaseRow = buildCollectionsCaseRow(doc, la, aging)

    return NextResponse.json({ case: row })
  } catch (error) {
    console.error('Error fetching collection case detail:', error)
    return NextResponse.json(
      {
        error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred. Please try again.' },
      },
      { status: 500 },
    )
  }
}
