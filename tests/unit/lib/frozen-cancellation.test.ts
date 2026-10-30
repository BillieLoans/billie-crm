/**
 * The frozen Cancel loan request (BTB-517 fix round 1): kept in sessionStorage
 * per loan until the platform's answer settles it, so a drawer closed after an
 * outcome-unknown failure can still finish the same cancel with the same key.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  clearFrozenCancellation,
  frozenCancellationKey,
  loadFrozenCancellation,
  saveFrozenCancellation,
} from '@/lib/frozenCancellation'

const REQUEST = {
  loanAccountId: 'LA-1',
  reason: 'customer_withdrew' as const,
  note: 'Customer rang to withdraw before the money moved.',
  blockConfirmation: { kind: 'no_block_needed' as const, reason: 'Customer may reapply later.' },
  idempotencyKey: '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b',
}

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('frozen cancellation storage', () => {
  it('round-trips a request under a per-loan key', () => {
    expect(frozenCancellationKey('LA-1')).toBe('btb517:cancel:LA-1')
    expect(saveFrozenCancellation(REQUEST)).toBe(true)
    expect(loadFrozenCancellation('LA-1')).toEqual(REQUEST)
    expect(loadFrozenCancellation('LA-2')).toBeNull()
  })

  it('clears it', () => {
    saveFrozenCancellation(REQUEST)
    clearFrozenCancellation('LA-1')
    expect(loadFrozenCancellation('LA-1')).toBeNull()
  })

  it('ignores anything that is not a whole, valid request for that loan', () => {
    sessionStorage.setItem('btb517:cancel:LA-1', '{not json')
    expect(loadFrozenCancellation('LA-1')).toBeNull()
    sessionStorage.setItem(
      'btb517:cancel:LA-1',
      JSON.stringify({ ...REQUEST, idempotencyKey: 'x' }),
    )
    expect(loadFrozenCancellation('LA-1')).toBeNull()
    sessionStorage.setItem(
      'btb517:cancel:LA-1',
      JSON.stringify({ ...REQUEST, loanAccountId: 'LA-9' }),
    )
    expect(loadFrozenCancellation('LA-1')).toBeNull()
  })

  it('never throws when storage is unavailable, and says the save failed', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(saveFrozenCancellation(REQUEST)).toBe(false)
    expect(loadFrozenCancellation('LA-1')).toBeNull()
    expect(() => clearFrozenCancellation('LA-1')).not.toThrow()
  })
})
