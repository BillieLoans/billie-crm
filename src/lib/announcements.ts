import { formatCurrency } from '@/lib/formatters'
import type { PendingMutation } from '@/types/mutation'

export type AnnouncementUrgency = 'polite' | 'assertive'

export interface Announcement {
  text: string
  urgency: AnnouncementUrgency
}

/**
 * Human phrase for each optimistic action. An unmapped action makes
 * describeSettledMutation return null, which keeps a new mutation
 * silent-but-safe (carried by its toast alone) rather than announcing a
 * misleading generic "Action" or a raw slug.
 */
const ACTION_PHRASES: Record<string, string> = {
  'waive-fee': 'Waive fee',
  'record-repayment': 'Record repayment',
  'flag-hardship': 'Flag hardship',
  'stop-contact': 'Stop contact',
  'resume-hardship': 'Resume hardship',
  'advance-step': 'Advance step',
}

export function describeSettledMutation(mutation: PendingMutation): Announcement | null {
  if (mutation.stage !== 'confirmed' && mutation.stage !== 'failed') return null

  const subject = ACTION_PHRASES[mutation.action]
  if (!subject) return null

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
