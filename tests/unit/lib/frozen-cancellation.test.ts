/**
 * The frozen Cancel loan request (BTB-517 fix round 1): kept in sessionStorage
 * per loan until the platform's answer settles it, so a drawer closed after an
 * outcome-unknown failure can still finish the same cancel with the same key.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  clearAllFrozenCancellations,
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
  it('round-trips a request under a per-loan key, for its owner', () => {
    expect(frozenCancellationKey('LA-1')).toBe('btb517:cancel:LA-1')
    expect(saveFrozenCancellation(REQUEST, 'user-a')).toBe(true)
    expect(loadFrozenCancellation('LA-1', 'user-a')).toEqual(REQUEST)
    expect(loadFrozenCancellation('LA-2', 'user-a')).toBeNull()
  })

  it('an entry from user A is not offered to user B, and is left in place', () => {
    saveFrozenCancellation(REQUEST, 'user-a')
    expect(loadFrozenCancellation('LA-1', 'user-b')).toBeNull()
    expect(loadFrozenCancellation('LA-1', null)).toBeNull()
    expect(loadFrozenCancellation('LA-1', 'user-a')).toEqual(REQUEST)
  })

  it('is not kept without an owner', () => {
    expect(saveFrozenCancellation(REQUEST, null)).toBe(false)
    expect(sessionStorage.length).toBe(0)
  })

  it('clears it', () => {
    saveFrozenCancellation(REQUEST, 'user-a')
    clearFrozenCancellation('LA-1')
    expect(loadFrozenCancellation('LA-1', 'user-a')).toBeNull()
  })

  it('the sweep removes every btb517:cancel: entry and nothing else', () => {
    saveFrozenCancellation(REQUEST, 'user-a')
    saveFrozenCancellation({ ...REQUEST, loanAccountId: 'LA-2' }, 'user-b')
    sessionStorage.setItem('billie-ask-draft', 'keep me')
    sessionStorage.setItem('btb517:other', 'keep me too')
    clearAllFrozenCancellations()
    expect(sessionStorage.getItem('btb517:cancel:LA-1')).toBeNull()
    expect(sessionStorage.getItem('btb517:cancel:LA-2')).toBeNull()
    expect(sessionStorage.getItem('billie-ask-draft')).toBe('keep me')
    expect(sessionStorage.getItem('btb517:other')).toBe('keep me too')
    expect(sessionStorage.length).toBe(2)
  })

  it('ignores anything that is not a whole, valid request for that loan', () => {
    const put = (value: unknown) =>
      sessionStorage.setItem('btb517:cancel:LA-1', JSON.stringify(value))
    sessionStorage.setItem('btb517:cancel:LA-1', '{not json')
    expect(loadFrozenCancellation('LA-1', 'user-a')).toBeNull()
    put({ ownerId: 'user-a', request: { ...REQUEST, idempotencyKey: 'x' } })
    expect(loadFrozenCancellation('LA-1', 'user-a')).toBeNull()
    put({ ownerId: 'user-a', request: { ...REQUEST, loanAccountId: 'LA-9' } })
    expect(loadFrozenCancellation('LA-1', 'user-a')).toBeNull()
    // The pre-R26 shape (no owner) belongs to nobody.
    put(REQUEST)
    expect(loadFrozenCancellation('LA-1', 'user-a')).toBeNull()
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
    expect(saveFrozenCancellation(REQUEST, 'user-a')).toBe(false)
    expect(loadFrozenCancellation('LA-1', 'user-a')).toBeNull()
    expect(() => clearFrozenCancellation('LA-1')).not.toThrow()
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => clearAllFrozenCancellations()).not.toThrow()
  })
})
