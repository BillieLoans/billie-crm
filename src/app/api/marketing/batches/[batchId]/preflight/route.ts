/**
 * API Route: GET /api/marketing/batches/[batchId]/preflight
 *
 * Pre-send summary for a campaign: how many members it has, how many will
 * actually receive an invitation, and why the rest are skipped (no marketing
 * consent / parked for review). Computed entirely from the read-only
 * `contacts` projection — the same partition MarketingService applies at send
 * time — so staff confirm a send knowing its reach, not on faith.
 *
 * Gated on `canReadMarketing` (it's a read; the send itself is `canMarketing`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canReadMarketing } from '@/lib/access'
import { getMarketingConsentGranted } from '@/lib/marketing'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth
  const { batchId } = await params

  // One page-through of the batch's members (assign is capped at 10k ids, so
  // a batch can't exceed that). Consent lives in an untyped JSON column, so
  // the partition is computed here rather than in the DB.
  const members = await payload.find({
    collection: 'contacts',
    where: { batchId: { equals: batchId }, mergedInto: { exists: false } } as never,
    limit: 10_000,
    depth: 0,
    select: { contactId: true, consent: true, needsReview: true, erased: true },
    overrideAccess: false,
    user,
  })

  let willReceive = 0
  let skippedUnconsented = 0
  let skippedNeedsReview = 0
  let skippedErased = 0
  for (const m of members.docs) {
    if (m.erased) {
      skippedErased += 1
    } else if (m.needsReview) {
      skippedNeedsReview += 1
    } else if (getMarketingConsentGranted(m.consent) === true) {
      willReceive += 1
    } else {
      skippedUnconsented += 1
    }
  }

  return NextResponse.json({
    batchId,
    memberCount: members.totalDocs,
    willReceive,
    skippedUnconsented,
    skippedNeedsReview,
    skippedErased,
  })
}
