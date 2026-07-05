import { describe, test, expect } from 'vitest'

describe('B6 marketing query hooks', () => {
  test('useBatches exports hook + query key factory', async () => {
    const mod = await import('@/hooks/queries/useBatches')
    expect(typeof mod.useBatches).toBe('function')
    expect(mod.batchesQueryKey({ page: 2 })).toEqual(['marketing-batches', 'list', { page: 2 }])
  })

  test('useFeedbackQueue exports hook + query key factory', async () => {
    const mod = await import('@/hooks/queries/useFeedbackQueue')
    expect(typeof mod.useFeedbackQueue).toBe('function')
    expect(mod.feedbackQueueQueryKey({ status: 'new' })).toEqual([
      'marketing-feedback',
      'list',
      { status: 'new' },
    ])
  })

  test('useContactReferrals exports hook + query key factory', async () => {
    const mod = await import('@/hooks/queries/useContactReferrals')
    expect(typeof mod.useContactReferrals).toBe('function')
    expect(mod.contactReferralsQueryKey('c-1')).toEqual([
      'marketing-contacts',
      'referrals',
      'c-1',
    ])
  })
})
