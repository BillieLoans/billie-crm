/**
 * Client helper for recording payout-detail disclosures (BTB-279).
 *
 * `docs/ux-standards.md` §4 requires an audit entry whenever a full identifier is
 * revealed. A copy is recorded too — an account number on the clipboard is just as
 * disclosed as one on screen, and copying is the queue's main interaction.
 *
 * Deliberately fire-and-forget: the audit write must never delay or block the
 * operator's copy. A failure is logged for diagnosis rather than surfaced, because
 * there is no useful action an operator could take about it mid-payment-run.
 * Server-side, the actor is taken from the session, so this cannot be spoofed.
 */

export type DisbursementAccessAction = 'reveal' | 'copy'
export type DisbursementAccessField = 'accountNumber' | 'bsb' | 'holder' | 'all'

export interface DisbursementAccessEntry {
  loanAccountId: string
  accountNumber?: string | null
  action: DisbursementAccessAction
  field: DisbursementAccessField
}

export function recordDisbursementAccess(entry: DisbursementAccessEntry): void {
  void fetch('/api/pending-disbursements/access-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  }).catch((err) => {
    console.error('[disbursement-access-log] Failed to record access:', err)
  })
}

/** Mask all but the last `visible` digits: '63764292' → '••••4292'. */
export function maskAccountNumber(value: string | null | undefined, visible = 4): string {
  if (!value) return '—'
  const trimmed = value.trim()
  if (trimmed.length <= visible) return trimmed
  return `${'•'.repeat(Math.max(4, trimmed.length - visible))}${trimmed.slice(-visible)}`
}
