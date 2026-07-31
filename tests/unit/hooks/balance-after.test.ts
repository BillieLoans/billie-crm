import { describe, it, expect } from 'vitest'
import { describeSettledMutation } from '@/lib/announcements'
import type { PendingMutation } from '@/types/mutation'

// Guards the spec rule: balanceAfter is set by the caller ONLY when the balance
// actually changed. The announcer appends the clause whenever it is present, so
// a hook setting it for an unchanged balance is the bug.
describe('balanceAfter contract', () => {
  const settled: PendingMutation = {
    id: 'm1',
    accountId: 'acc-1',
    action: 'record-repayment',
    stage: 'confirmed',
    amount: 50,
    createdAt: 0,
  }

  it('omits the balance clause when the hook reported none', () => {
    expect(describeSettledMutation(settled)?.text).toBe('Record repayment confirmed. $50.00.')
  })

  it('includes it when the hook reported one', () => {
    expect(describeSettledMutation({ ...settled, balanceAfter: 100 })?.text).toBe(
      'Record repayment confirmed. $50.00. Balance updated to $100.00.',
    )
  })
})
