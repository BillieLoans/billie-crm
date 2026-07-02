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
    state: doc.state,
    rung: doc.rung ?? null,
    hardshipPaused: Boolean(doc.hardshipPaused),
    stoppedContact: Boolean(doc.stoppedContact),
    overdueAmount: doc.overdueAmount ?? null,
    daysOverdue: doc.daysOverdue ?? null,
    lastStep: doc.lastStep ?? null,
    openedAt: doc.openedAt ?? null,
    updatedAt: doc.updatedAt,
    aging: aging ?? null,
  }
}
