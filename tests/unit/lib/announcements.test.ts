import { describe, it, expect } from 'vitest'
import { describeSettledMutation } from '@/lib/announcements'
import type { PendingMutation } from '@/types/mutation'

const base: PendingMutation = {
  id: 'm1',
  accountId: 'acc-1',
  action: 'waive-fee',
  stage: 'confirmed',
  amount: 25,
  createdAt: 0,
}

describe('describeSettledMutation', () => {
  it('returns null for unsettled stages so nothing is announced mid-flight', () => {
    expect(describeSettledMutation({ ...base, stage: 'optimistic' })).toBeNull()
    expect(describeSettledMutation({ ...base, stage: 'submitted' })).toBeNull()
  })

  it('announces a confirmed action politely, with its amount', () => {
    expect(describeSettledMutation(base)).toEqual({
      text: 'Waive fee confirmed. $25.00.',
      urgency: 'polite',
    })
  })

  it('appends the balance when the caller reported one', () => {
    expect(describeSettledMutation({ ...base, balanceAfter: 0 })).toEqual({
      text: 'Waive fee confirmed. $25.00. Balance updated to $0.00.',
      urgency: 'polite',
    })
  })

  it('announces failures assertively, including the reason', () => {
    expect(
      describeSettledMutation({
        ...base,
        stage: 'failed',
        error: 'Ledger unavailable',
      }),
    ).toEqual({
      text: 'Waive fee failed: Ledger unavailable.',
      urgency: 'assertive',
    })
  })

  it('reports the restored balance on a rollback', () => {
    expect(
      describeSettledMutation({
        ...base,
        stage: 'failed',
        error: 'Ledger unavailable',
        balanceAfter: 150,
      }),
    ).toEqual({
      text: 'Waive fee failed: Ledger unavailable. Balance restored to $150.00.',
      urgency: 'assertive',
    })
  })

  it('falls back to a generic phrase for an unmapped action', () => {
    expect(describeSettledMutation({ ...base, action: 'some-new-thing', amount: undefined }))
      .toEqual({ text: 'Action confirmed.', urgency: 'polite' })
  })

  it('omits the amount clause when there is no amount', () => {
    expect(describeSettledMutation({ ...base, amount: undefined })).toEqual({
      text: 'Waive fee confirmed.',
      urgency: 'polite',
    })
  })
})
