/**
 * Re-application block helpers (BTB-135).
 *
 * Shared by the application decision banner and the customer profile/attention
 * strip. Semantics follow the crm-event-contract-2026-06-10:
 * - `blockedUntil` is the inclusive end of the exclusion window.
 * - `blockedUntil = null` means permanent (PEP, PRIOR_DEFAULT, IDENTITY_CONFLICT)
 *   or ongoing-state (ACTIVE_LOAN — blocked while the loan is open).
 */

import { formatDateOnly } from '@/lib/formatters'

/** Block reason enum → staff-facing label. Unknown values fall back to the raw enum. */
const BLOCK_REASON_LABELS: Record<string, string> = {
  ACTIVE_LOAN: 'Active loan',
  PRIOR_DEFAULT: 'Prior default',
  PEP: 'PEP',
  ID_VERIFICATION: 'ID verification',
  SERVICEABILITY: 'Serviceability',
  ACCOUNT_CONDUCT: 'Account conduct',
  IDENTITY_CONFLICT: 'Identity conflict',
}

export function formatBlockReason(reason: string | null | undefined): string {
  if (!reason) return '—'
  return BLOCK_REASON_LABELS[reason] ?? reason
}

export interface BlockLike {
  reason?: string | null
  blockedUntil?: string | Date | null
}

/**
 * Human text for the exclusion window end. Null window = "While loan open" for
 * ACTIVE_LOAN, "Permanent" otherwise (PEP, PRIOR_DEFAULT, IDENTITY_CONFLICT).
 */
export function formatBlockedUntil(block: BlockLike): string {
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
