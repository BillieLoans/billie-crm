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

  // The assertive lane is reserved for a failure that ALSO carries a rolled-back balance
  // ("... failed: reason. Balance restored to $X.") — genuine new information the toast
  // doesn't have. A plain failure with no balance is otherwise an exact duplicate of the
  // toast's text (sonner announces the toast through its own live region), and an
  // assertive-lane duplicate interrupts the user for no reason — noise is exactly what gets
  // live regions switched off. So a failure with no balanceAfter announces nothing here and
  // leaves the toast to carry it alone.
  //
  // NOTE: as of this writing, nothing in the codebase sets balanceAfter on a failed
  // mutation (no rollback-balance wiring exists yet), so this branch is DORMANT in
  // production — describeSettledMutation currently returns null for every failure. That is
  // intentional, not a bug. Do not "fix" this by deleting the branch or the balanceAfter
  // check below — it is reserved for when a failure handler starts reporting a real
  // rolled-back balance.
  if (failed && mutation.balanceAfter === undefined) return null

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
