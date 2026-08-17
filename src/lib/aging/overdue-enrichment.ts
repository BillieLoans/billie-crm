/**
 * Overdue account normalisation + loan-account enrichment.
 *
 * Extracted from `GET /api/ledger/aging/overdue` so the mapping is unit
 * testable and so the batched (single-query) enrichment shape is shared rather
 * than re-derived per row. Response field names are load-bearing — the
 * dashboard consumes them via `src/hooks/queries/useOverdueAccounts.ts`.
 */

/** Normalised overdue account, before loan-account enrichment. */
export interface NormalisedOverdueAccount {
  accountId: string
  dpd: number
  bucket: string
  daysUntilOverdue: number
  totalOverdueAmount: string
  lastUpdated: string
  isInArrears: boolean
}

/** Normalised overdue account with Payload loan-account details attached. */
export interface EnrichedOverdueAccount extends NormalisedOverdueAccount {
  accountNumber: string | null
  customerIdString: string | null
  customerName: string | null
}

/** Minimal shape read off a `loan-accounts` doc. */
export interface LoanAccountLike {
  loanAccountId?: string | null
  accountNumber?: string | null
  customerIdString?: string | null
  customerName?: string | null
}

/**
 * Normalise a raw gRPC overdue account.
 * Handles both camelCase (proto loader with `keepCase: false`) and snake_case.
 */
export function normaliseOverdueAccount(account: any): NormalisedOverdueAccount {
  return {
    accountId: account.accountId ?? account.account_id ?? '',
    dpd: account.dpd ?? 0,
    bucket: account.bucket ?? 'current',
    daysUntilOverdue: account.daysUntilOverdue ?? account.days_until_overdue ?? 0,
    totalOverdueAmount: account.totalOverdueAmount ?? account.total_overdue_amount ?? '0',
    lastUpdated: account.lastUpdated ?? account.last_updated ?? new Date().toISOString(),
    // aging-v1.1.0+ field. Default false when the ledger version doesn't supply it.
    isInArrears:
      typeof account.isInArrears === 'boolean'
        ? account.isInArrears
        : typeof account.is_in_arrears === 'boolean'
          ? account.is_in_arrears
          : false,
  }
}

/** Index loan-account docs by their `loanAccountId` for O(1) enrichment. */
export function indexLoanAccountsById(docs: LoanAccountLike[]): Map<string, LoanAccountLike> {
  const map = new Map<string, LoanAccountLike>()
  for (const doc of docs) {
    if (doc?.loanAccountId) map.set(doc.loanAccountId, doc)
  }
  return map
}

/**
 * Attach loan-account details to normalised overdue accounts.
 * Accounts with no matching loan account keep the historical null-filled shape.
 */
export function enrichOverdueAccounts(
  accounts: NormalisedOverdueAccount[],
  loanAccountsById: Map<string, LoanAccountLike>,
): EnrichedOverdueAccount[] {
  return accounts.map((account) => {
    const loanAccount = loanAccountsById.get(account.accountId)
    return {
      ...account,
      accountNumber: loanAccount?.accountNumber ?? null,
      customerIdString: loanAccount?.customerIdString ?? null,
      customerName: loanAccount?.customerName ?? null,
    }
  })
}
