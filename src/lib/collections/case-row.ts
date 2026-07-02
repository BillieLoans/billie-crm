/**
 * Shared mapping helper for the Collections read APIs (BTB-200 WS2).
 *
 * Both `GET /api/collections/cases` and `GET /api/collections/cases/[accountId]`
 * build an identical `CollectionsCaseRow` from a `collection-cases` projection
 * doc, its matching `loan-accounts` doc, and its (optional) ledger aging
 * result. This was previously copy-pasted between the two routes; extracted
 * here so the mapping only lives in one place (C3 review).
 */

import type { CollectionsCaseAging, CollectionsCaseRow } from '@/types/collections'

/**
 * Build a `CollectionsCaseRow` from a collection-cases projection doc,
 * enriched with the matching loan-account row and ledger aging (if any).
 *
 * Field names on `loanAccount` are copied verbatim from
 * `src/app/api/ledger/aging/overdue/route.ts` (accountNumber /
 * customerIdString / customerName).
 */
export function buildCollectionsCaseRow(
  doc: any,
  loanAccount: any,
  aging: CollectionsCaseAging | null,
): CollectionsCaseRow {
  return {
    accountId: doc.accountId,
    customerId: doc.customerId ?? loanAccount?.customerIdString ?? null,
    customerName: loanAccount?.customerName ?? null,
    accountNumber: loanAccount?.accountNumber ?? null,
    // `state` is nullable on the projection (out-of-order flag-event rows
    // with no prior `opened`) — normalise `undefined` to `null` so callers
    // get the documented `'open' | 'awaiting_human' | 'cured' | null` shape
    // rather than leaking Mongo/Payload's `undefined` (final-review Fix 1).
    state: doc.state ?? null,
    rung: doc.rung ?? null,
    hardshipPaused: Boolean(doc.hardshipPaused),
    stoppedContact: Boolean(doc.stoppedContact),
    overdueAmount: doc.overdueAmount ?? null,
    daysOverdue: doc.daysOverdue ?? null,
    lastStep: doc.lastStep ?? null,
    openedAt: doc.openedAt ?? null,
    curedAt: doc.curedAt ?? null,
    exhaustedAt: doc.exhaustedAt ?? null,
    pausedAt: doc.pausedAt ?? null,
    resumedAt: doc.resumedAt ?? null,
    stopContactAt: doc.stopContactAt ?? null,
    updatedAt: doc.updatedAt,
    aging: aging ?? null,
  }
}
