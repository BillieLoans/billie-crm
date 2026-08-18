import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRingBuffer } from '@/lib/issue-diagnostics/ring-buffer'
import { ISSUE_BUFFER_TTL_MS } from '@/lib/issue-diagnostics/constants'

const KEY = 'test_ring_buffer'

describe('createRingBuffer', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  describe('cap enforcement', () => {
    it('keeps every entry while under the cap, oldest first', () => {
      const buffer = createRingBuffer<number>(KEY, 3)
      buffer.push(1)
      buffer.push(2)

      expect(buffer.read()).toEqual([1, 2])
    })

    it('drops the oldest entries once the cap is exceeded', () => {
      const buffer = createRingBuffer<number>(KEY, 3)
      for (const n of [1, 2, 3, 4, 5]) buffer.push(n)

      expect(buffer.read()).toEqual([3, 4, 5])
    })

    it('never stores more than `max` entries in localStorage', () => {
      const buffer = createRingBuffer<number>(KEY, 2)
      for (const n of [1, 2, 3, 4]) buffer.push(n)

      const stored = JSON.parse(localStorage.getItem(KEY) as string)
      expect(stored.entries).toEqual([3, 4])
    })

    it('trims an over-long buffer written by an earlier (larger) cap on read', () => {
      localStorage.setItem(
        KEY,
        JSON.stringify({ savedAt: Date.now(), entries: [1, 2, 3, 4, 5, 6] }),
      )
      const buffer = createRingBuffer<number>(KEY, 2)

      expect(buffer.read()).toEqual([5, 6])
    })
  })

  describe('TTL expiry', () => {
    it('returns entries written just inside the TTL window', () => {
      localStorage.setItem(
        KEY,
        JSON.stringify({ savedAt: Date.now() - (ISSUE_BUFFER_TTL_MS - 60_000), entries: ['a'] }),
      )

      expect(createRingBuffer<string>(KEY, 5).read()).toEqual(['a'])
    })

    it('drops the whole buffer once it is older than the TTL', () => {
      localStorage.setItem(
        KEY,
        JSON.stringify({ savedAt: Date.now() - (ISSUE_BUFFER_TTL_MS + 60_000), entries: ['a'] }),
      )

      expect(createRingBuffer<string>(KEY, 5).read()).toEqual([])
    })

    it('drops a buffer with no savedAt stamp (treated as epoch 0)', () => {
      localStorage.setItem(KEY, JSON.stringify({ entries: ['a'] }))

      expect(createRingBuffer<string>(KEY, 5).read()).toEqual([])
    })

    it('a push after expiry starts a fresh buffer rather than appending to stale entries', () => {
      localStorage.setItem(
        KEY,
        JSON.stringify({ savedAt: Date.now() - (ISSUE_BUFFER_TTL_MS + 1), entries: ['stale'] }),
      )
      const buffer = createRingBuffer<string>(KEY, 5)
      buffer.push('fresh')

      expect(buffer.read()).toEqual(['fresh'])
    })

    it('expires as wall-clock time advances past the TTL', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-18T00:00:00Z'))

      const buffer = createRingBuffer<string>(KEY, 5)
      buffer.push('a')
      expect(buffer.read()).toEqual(['a'])

      vi.setSystemTime(new Date('2026-08-18T00:00:00Z').getTime() + ISSUE_BUFFER_TTL_MS + 1)
      expect(buffer.read()).toEqual([])
    })
  })

  describe('malformed storage', () => {
    it('returns [] for unparseable JSON rather than throwing', () => {
      localStorage.setItem(KEY, '{not json')
      const buffer = createRingBuffer<string>(KEY, 5)

      expect(() => buffer.read()).not.toThrow()
      expect(buffer.read()).toEqual([])
    })

    it('returns [] when entries is not an array', () => {
      localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), entries: 'nope' }))

      expect(createRingBuffer<string>(KEY, 5).read()).toEqual([])
    })

    it('returns [] when the key is absent', () => {
      expect(createRingBuffer<string>('never_written', 5).read()).toEqual([])
    })
  })

  describe('storage failures', () => {
    it('push does not throw when setItem throws (quota / private mode)', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      const buffer = createRingBuffer<string>(KEY, 5)
      expect(() => buffer.push('a')).not.toThrow()
      expect(setItem).toHaveBeenCalled()

      setItem.mockRestore()
      expect(buffer.read()).toEqual([])
    })

    it('read does not throw when getItem throws', () => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled')
      })

      const buffer = createRingBuffer<string>(KEY, 5)
      expect(() => buffer.read()).not.toThrow()
      expect(buffer.read()).toEqual([])

      getItem.mockRestore()
    })

    it('clear does not throw when removeItem throws', () => {
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('storage disabled')
      })

      const buffer = createRingBuffer<string>(KEY, 5)
      expect(() => buffer.clear()).not.toThrow()

      removeItem.mockRestore()
    })
  })

  describe('clear', () => {
    it('removes the buffer entirely', () => {
      const buffer = createRingBuffer<string>(KEY, 5)
      buffer.push('a')
      expect(buffer.read()).toEqual(['a'])

      buffer.clear()

      expect(localStorage.getItem(KEY)).toBeNull()
      expect(buffer.read()).toEqual([])
    })
  })

  describe('isolation', () => {
    it('buffers with different keys do not share entries', () => {
      const a = createRingBuffer<string>('buf_a', 5)
      const b = createRingBuffer<string>('buf_b', 5)

      a.push('from-a')

      expect(a.read()).toEqual(['from-a'])
      expect(b.read()).toEqual([])

      localStorage.removeItem('buf_a')
      localStorage.removeItem('buf_b')
    })

    it('two instances over the same key see each other’s writes', () => {
      const first = createRingBuffer<string>(KEY, 5)
      const second = createRingBuffer<string>(KEY, 5)

      first.push('a')
      second.push('b')

      expect(first.read()).toEqual(['a', 'b'])
    })
  })

  describe('SSR resilience', () => {
    it('is a no-op when `window` is undefined', () => {
      const buffer = createRingBuffer<string>(KEY, 5)
      const windowSpy = vi.spyOn(globalThis, 'window', 'get')
      // Simulate a server render: `typeof window === 'undefined'`.
      windowSpy.mockReturnValue(undefined as unknown as Window & typeof globalThis)

      expect(() => buffer.push('a')).not.toThrow()
      expect(buffer.read()).toEqual([])
      expect(() => buffer.clear()).not.toThrow()

      windowSpy.mockRestore()
      // Nothing was persisted while "on the server".
      expect(localStorage.getItem(KEY)).toBeNull()
    })
  })
})
