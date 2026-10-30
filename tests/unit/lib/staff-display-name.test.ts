import { describe, it, expect } from 'vitest'
import { staffDisplayName } from '@/lib/staffDisplayName'

describe('staffDisplayName', () => {
  it('is "First Last", "First" alone, else the email, else the fallback', () => {
    expect(staffDisplayName({ firstName: 'Sam', lastName: 'Supervisor', email: 's@x' })).toBe(
      'Sam Supervisor',
    )
    expect(staffDisplayName({ firstName: 'Sam', lastName: null, email: 's@x' })).toBe('Sam')
    expect(staffDisplayName({ firstName: null, lastName: 'Supervisor', email: 's@x' })).toBe('s@x')
    expect(staffDisplayName({ firstName: '', email: '' })).toBe('Unknown User')
  })
})
