import { formatCurrency } from '@/lib/formatters'
import type { PendingMutation } from '@/types/mutation'

export type AnnouncementUrgency = 'polite' | 'assertive'

export interface Announcement {
  text: string
  urgency: AnnouncementUrgency
}

/**
 * Human phrase for each optimistic action. Unmapped actions fall back to
 * "Action", which keeps a new mutation silent-but-safe rather than crashing or
 * announcing a raw slug.
 */
const ACTION_PHRASES: Record<string, string> = {
  'waive-fee': 'Waive fee',
  'record-repayment': 'Record repayment',
  'apply-fee': 'Apply fee',
  'write-off': 'Write off',
  adjustment: 'Adjustment',
  disburse: 'Disbursement',
}

export function describeSettledMutation(mutation: PendingMutation): Announcement | null {
  if (mutation.stage !== 'confirmed' && mutation.stage !== 'failed') return null

  const subject = ACTION_PHRASES[mutation.action] ?? 'Action'
  const failed = mutation.stage === 'failed'
  const parts: string[] = []

  if (failed) {
    parts.push(mutation.error ? `${subject} failed: ${mutation.error}.` : `${subject} failed.`)
  } else {
    parts.push(`${subject} confirmed.`)
    if (mutation.amount !== undefined) parts.push(`${formatCurrency(mutation.amount)}.`)
  }

  if (mutation.balanceAfter !== undefined) {
    const verb = failed ? 'restored to' : 'updated to'
    parts.push(`Balance ${verb} ${formatCurrency(mutation.balanceAfter)}.`)
  }

  return { text: parts.join(' '), urgency: failed ? 'assertive' : 'polite' }
}
