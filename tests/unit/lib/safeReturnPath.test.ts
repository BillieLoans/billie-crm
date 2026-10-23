import { describe, expect, it } from 'vitest'
import { safeReturnPath } from '@/lib/safeReturnPath'

const APP = 'https://crm.billie.loans'

describe('safeReturnPath', () => {
  it('keeps a same-origin path and its query', () => {
    expect(safeReturnPath('/oauth/authorize?req=abc.def', APP)).toBe('/oauth/authorize?req=abc.def')
    expect(safeReturnPath('/admin/dashboard', APP)).toBe('/admin/dashboard')
  })

  it.each([
    'https://evil.example/',
    '//evil.example/x',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    'oauth/authorize',
    '',
    null,
    42,
  ])('refuses %s', (value) => {
    expect(safeReturnPath(value, APP)).toBeNull()
  })
})
