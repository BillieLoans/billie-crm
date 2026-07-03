import { describe, test, expect } from 'vitest'

describe('useMarketingContacts', () => {
  test('exports hook + query key factory', async () => {
    const mod = await import('@/hooks/queries/useMarketingContacts')
    expect(typeof mod.useMarketingContacts).toBe('function')
    expect(mod.marketingContactsQueryKey({ stage: 'waitlist' })).toEqual([
      'marketing-contacts',
      'list',
      { stage: 'waitlist' },
    ])
  })
  test('detail hook exports', async () => {
    const mod = await import('@/hooks/queries/useMarketingContact')
    expect(typeof mod.useMarketingContact).toBe('function')
    expect(mod.marketingContactQueryKey('c-1')).toEqual(['marketing-contacts', 'detail', 'c-1'])
  })
})
