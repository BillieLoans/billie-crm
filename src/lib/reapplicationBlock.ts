/**
 * Re-application block helpers (BTB-135).
 *
 * Shared by the application decision banner and the customer profile/attention
 * strip. Semantics follow the crm-event-contract-2026-06-10:
 * - `blockedUntil` is the inclusive end of the exclusion window.
 * - `blockedUntil = null` means permanent (PEP, PRIOR_DEFAULT, IDENTITY_CONFLICT)
 *   or ongoing-state (ACTIVE_LOAN — blocked while the loan is open).
 * - dated windows carry a non-null `blockedUntil`: the decline windows
 *   (ID_VERIFICATION, SERVICEABILITY, ACCOUNT_CONDUCT) and PRIOR_SERIOUS_ARREARS
 *   (BTB-154 — cured serious-arrears/default, 12 months from loan closure).
 * - APPLICATION_IN_PROGRESS (BTB-397 in-flight claim) carries a dated
 *   `blockedUntil` (claim time + 3 h — the window self-lapses) which still
 *   drives `isBlockActive`, but it is an ongoing-state block like ACTIVE_LOAN,
 *   so `formatBlockedUntil` reads "while application in progress" rather than
 *   a date that is always today.
 */

import { formatDateOnly } from '@/lib/formatters'
import { sydneyDayStartUtc } from '@/lib/disbursement-cutoff'

/** Block reason enum → staff-facing label. Unknown values fall back to the raw enum. */
const BLOCK_REASON_LABELS: Record<string, string> = {
  ACTIVE_LOAN: 'Active loan',
  PRIOR_DEFAULT: 'Prior default',
  PRIOR_SERIOUS_ARREARS: 'Prior serious arrears',
  PEP: 'PEP',
  ID_VERIFICATION: 'ID verification',
  SERVICEABILITY: 'Serviceability',
  ACCOUNT_CONDUCT: 'Account conduct',
  IDENTITY_CONFLICT: 'Identity conflict',
  MANUAL_ADMIN: 'Manually blocked (staff)',
  APPLICATION_IN_PROGRESS: 'Application in progress',
}

export function formatBlockReason(reason: string | null | undefined): string {
  if (!reason) return '—'
  return BLOCK_REASON_LABELS[reason] ?? reason
}

export interface BlockLike {
  reason?: string | null
  blockedUntil?: string | Date | null
}

// =============================================================================
// Manual block set from the CRM (BTB-517)
// =============================================================================

/**
 * Reason codes for a MANUAL_ADMIN block set from the CRM
 * (`reapplication_block.manual_set.v1`). billieChat accepts exactly these.
 */
export const MANUAL_BLOCK_REASON_CODES = [
  'credit_review_hold',
  'cancelled_pre_disbursement',
  'fraud_hold',
] as const

export type ManualBlockReasonCode = (typeof MANUAL_BLOCK_REASON_CODES)[number]

export const MANUAL_BLOCK_REASON_LABELS: Record<ManualBlockReasonCode, string> = {
  credit_review_hold: 'Credit review hold',
  cancelled_pre_disbursement: 'Cancelled before disbursement',
  fraud_hold: 'Fraud hold',
}

/** The customer-row block fields that say which manual set raised the block. */
export interface ManualBlockFields extends BlockLike {
  /** Written by state.changed only: the manual-set request that raised the block shown now. */
  manualBlockRequestId?: string | null
  /** The latest manual set billieChat applied, and its reason code. */
  manualSetRequestId?: string | null
  manualSetReasonCode?: string | null
}

/**
 * The reason code of the manual set that raised this MANUAL_ADMIN block, or
 * null when it is not known.
 *
 * state.changed binds the mirrored block to the request that caused it, and
 * unbinds it for any other cause (a conversation kill, which sends no applied
 * reply; a merge; an unblock). The applied reply supplies a request's code.
 * The code is used only when both name the same request, so an older set's
 * code never describes a block something else raised.
 */
export function manualBlockReasonCode(
  block: ManualBlockFields | null | undefined,
): ManualBlockReasonCode | null {
  if (block?.reason !== 'MANUAL_ADMIN') return null
  const bound = block.manualBlockRequestId
  if (!bound || bound !== block.manualSetRequestId) return null
  const code = block.manualSetReasonCode
  return code && (MANUAL_BLOCK_REASON_CODES as readonly string[]).includes(code)
    ? (code as ManualBlockReasonCode)
    : null
}

/**
 * Staff-facing name of a block: its reason, and for a manual block set from
 * the CRM, why it was set ("Manual block — credit review hold").
 */
export function formatBlockLabel(block: ManualBlockFields | null | undefined): string {
  const code = manualBlockReasonCode(block)
  if (code) return `Manual block — ${MANUAL_BLOCK_REASON_LABELS[code].toLowerCase()}`
  return formatBlockReason(block?.reason)
}

/** Whether the customer has an active MANUAL_ADMIN block (the cancel route re-checks this, AC16). */
export function isManualBlockActive(
  block: BlockLike | null | undefined,
  today: Date = new Date(),
): boolean {
  return block?.reason === 'MANUAL_ADMIN' && isBlockActive(block, today)
}

/**
 * Staff wording for why billieChat refused a manual set, shared by every place
 * that shows it. `manualSetRejection` is stored as "CODE: detail" (the code on
 * its own is also accepted); a code with no wording here is shown as received,
 * so a new billieChat code is never hidden or mis-described.
 */
export function describeManualSetRejection(rejection: string | null | undefined): string {
  const raw = rejection?.trim()
  if (!raw) return 'no reason given'
  switch (raw.split(':', 1)[0].trim()) {
    case 'WOULD_SHORTEN_ACTIVE_BLOCK':
      return 'a longer manual block is already in place'
    case 'INVALID_EXPIRY':
      return "the end date isn't valid"
    case 'INVALID_REASON':
      return "the reason isn't valid"
    case 'MISSING_FIELDS':
      return 'details were missing'
    default:
      return raw
  }
}

/**
 * `expires_at` for a manual block that runs through `day` ('YYYY-MM-DD', a
 * Sydney calendar day): the last millisecond of that day in Sydney, as UTC ISO.
 *
 * billieChat blocks while now < expires_at, and the CRM shows a dated block as
 * active through the end of its `blockedUntil` day, so both read the chosen
 * day as the last day of the block.
 */
export function manualBlockExpiresAt(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  return new Date(sydneyDayStartUtc(next).getTime() - 1).toISOString()
}

/**
 * Human text for the exclusion window end. Null window = "While loan open" for
 * ACTIVE_LOAN, "Permanent" otherwise (PEP, PRIOR_DEFAULT, IDENTITY_CONFLICT).
 * APPLICATION_IN_PROGRESS is ongoing-state too — its `blockedUntil` is only the
 * self-lapse backstop a few hours out — so it reads "while application in progress".
 */
export function formatBlockedUntil(block: BlockLike): string {
  if (block.reason === 'APPLICATION_IN_PROGRESS') return 'while application in progress'
  if (block.blockedUntil) return `until ${formatDateOnly(block.blockedUntil as string)}`
  return block.reason === 'ACTIVE_LOAN' ? 'while loan open' : 'permanent'
}

/**
 * Whether the block currently applies. Inclusive boundary per the contract —
 * a block ending today is still active today. Null window = always active.
 */
export function isBlockActive(block: BlockLike | null | undefined, today: Date = new Date()): boolean {
  if (!block?.reason) return false
  if (!block.blockedUntil) return true
  const until = new Date(block.blockedUntil)
  if (Number.isNaN(until.getTime())) return false
  // Inclusive: active through the end of the blockedUntil calendar day.
  const endOfDay = new Date(until)
  endOfDay.setHours(23, 59, 59, 999)
  return today.getTime() <= endOfDay.getTime()
}

/** True when a final_credit_decision reason marks a block-decline. */
export function isBlockDeclineReason(reason: string | null | undefined): boolean {
  return Boolean(reason?.startsWith('REAPPLICATION_BLOCK:'))
}
