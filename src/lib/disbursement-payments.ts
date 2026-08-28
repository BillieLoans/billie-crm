/**
 * Constants and copy for the manual-Osko disbursement lane (BTB-279).
 *
 * At launch, money leaves Billie by hand: an operator reads a row off the
 * disbursement queue, pays it via ANZ Internet Banking for Business "Pay Anyone",
 * and marks it disbursed. This module holds the two things that lane needs beyond
 * the loan data itself — the payment message that travels with the money, and the
 * daily bank limit the day's total is measured against.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ DRAFT COPY — NEEDS PO SIGN-OFF (BTB-279)
 *
 * `Payment_Instructions_Canonical_Block` is the single source for all customer
 * payment copy and carries a verbatim-reuse rule, but it lives only on the PO's
 * machine (it is not mirrored to Drive), so this message is reconstructed from
 * the facts recorded in `Payments_Workstream_Context_Brief_2026-08-12.md` §3.
 * Check it against the canonical block before this ships to customers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Billie's repayment account, as disclosed in the loan agreement.
 *
 * The ANZ account name is still "Finscale Pty Ltd" — the ASIC change-of-name to
 * Billie Loans Pty Ltd has not been processed by the bank yet. The agreement
 * discloses the Finscale name too, so bank and document agree; do NOT "correct"
 * this to Billie Loans until ANZ confirms the retitle (BTB-275).
 */
export const BILLIE_REPAYMENT_ACCOUNT = {
  payId: 'repay@billie.loans',
  bsb: '013-257',
  accountNumber: '805296574',
  accountName: 'Finscale Pty Ltd',
} as const

/**
 * Osko's outbound message field carries 280 characters onto the payee's
 * statement — verified by the $1 smoke test on 11 Aug 2026.
 */
export const OSKO_MESSAGE_MAX_LENGTH = 280

/**
 * Ceiling the day's disbursement total is measured against.
 *
 * ANZ IB4B "Pay Anyone" allows up to $1M/day with ANZ Shield active. Overridable
 * so ops can dial it down to whatever the account is actually set to without a
 * deploy.
 */
export const DAILY_DISBURSEMENT_LIMIT_AUD = (() => {
  const raw = process.env.DISBURSEMENT_DAILY_LIMIT_AUD
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1_000_000
})()

/** Fraction of the daily limit at which the queue starts warning. */
export const DAILY_LIMIT_WARN_RATIO = 0.8

export type DailyLimitStatus = 'ok' | 'warn' | 'exceeded'

export interface DailyLimitUsage {
  /** Already paid out today. */
  disbursedToday: number
  /** Still sitting in today's queue. */
  pendingToday: number
  /** disbursedToday + pendingToday — what the day costs if the queue is cleared. */
  projectedTotal: number
  limit: number
  /** projectedTotal / limit, clamped at 0 (can exceed 1). */
  ratio: number
  status: DailyLimitStatus
}

/**
 * Measure the day's disbursement total against the bank limit.
 *
 * Deliberately projects (already-paid + still-queued) rather than reporting only
 * what has gone out: an operator needs to know they will hit the ceiling before
 * they start a 50-loan run, not after payment 38 is rejected.
 */
export function calculateDailyLimitUsage(
  disbursedToday: number,
  pendingToday: number,
  limit: number = DAILY_DISBURSEMENT_LIMIT_AUD,
): DailyLimitUsage {
  const safeLimit = limit > 0 ? limit : DAILY_DISBURSEMENT_LIMIT_AUD
  const projectedTotal = Math.max(0, disbursedToday) + Math.max(0, pendingToday)
  const ratio = projectedTotal / safeLimit
  const status: DailyLimitStatus =
    ratio >= 1 ? 'exceeded' : ratio >= DAILY_LIMIT_WARN_RATIO ? 'warn' : 'ok'
  return {
    disbursedToday,
    pendingToday,
    projectedTotal,
    limit: safeLimit,
    ratio,
    status,
  }
}

/** Australian short date (DD/MM/YYYY) in the business timezone. */
function formatDueDate(due: string | Date | null | undefined): string | null {
  if (!due) return null
  const d = due instanceof Date ? due : new Date(due)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

export interface OskoMessageInput {
  /** Customer-facing loan reference (application number). */
  reference: string | null | undefined
  /** First repayment due date. */
  firstDueDate: string | Date | null | undefined
}

/**
 * Build the message an operator pastes into ANZ's payment-message field.
 *
 * Carries the three things the ops spec requires: the loan reference, the first
 * due date, and complete repayment instructions (both rails). It lands on the
 * customer's bank statement, so it doubles as their payment instructions — and it
 * is what next morning's statement recon matches on.
 *
 * Both rails are always shown: PayTo/PayID adoption is partial and the push lane
 * is permanent, so a customer must never be left with only one way to pay.
 */
export function buildOskoMessage({ reference, firstDueDate }: OskoMessageInput): string {
  const ref = reference?.trim() || null
  const due = formatDueDate(firstDueDate)
  const { payId, bsb, accountNumber, accountName } = BILLIE_REPAYMENT_ACCOUNT

  const parts: string[] = ['Billie Pay Advance']
  if (ref) parts[0] = `Billie Pay Advance ${ref}`
  parts[0] += '.'

  if (due) parts.push(`First repayment ${due}.`)
  parts.push(`Pay by PayID ${payId} OR BSB ${bsb} Acc ${accountNumber} (${accountName}).`)
  // The reference is always requested but never a gate — an unreferenced payment
  // still counts; it just lands in the recon exception queue instead of automatching.
  if (ref) parts.push(`Reference ${ref}.`)

  return parts.join(' ')
}

/** Whether a built message still fits Osko's 280-character field. */
export function isWithinOskoLimit(message: string): boolean {
  return message.length <= OSKO_MESSAGE_MAX_LENGTH
}
