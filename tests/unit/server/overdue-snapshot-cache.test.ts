import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getOverdueAccounts = vi.fn()

vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: () => ({ getOverdueAccounts }),
}))

import {
  getFullOverdueSnapshot,
  getOverdueSnapshotPage,
  resetOverdueSnapshotCache,
  OVERDUE_PAGE_SIZE_MAX,
} from '@/server/overdue-snapshot-cache'

const account = (id: string) => ({
  accountId: id,
  dpd: 5,
  bucket: 'early_arrears',
  daysUntilOverdue: 0,
  totalOverdueAmount: '10.00',
  lastUpdated: '2026-08-17T00:00:00Z',
})

describe('overdue-snapshot-cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getOverdueAccounts.mockReset()
    resetOverdueSnapshotCache()
    delete process.env.OVERDUE_SNAPSHOT_CACHE_TTL_MS
    delete process.env.OVERDUE_SNAPSHOT_MAX_PAGES
  })

  afterEach(() => {
    vi.useRealTimers()
    resetOverdueSnapshotCache()
  })

  describe('getOverdueSnapshotPage', () => {
    it('serves a cached value within the TTL and refetches after it expires', async () => {
      getOverdueAccounts.mockResolvedValue({ accounts: [account('a')], totalCount: 1 })

      const first = await getOverdueSnapshotPage({ pageSize: 100 })
      const second = await getOverdueSnapshotPage({ pageSize: 100 })

      expect(getOverdueAccounts).toHaveBeenCalledTimes(1)
      expect(second).toEqual(first)
      expect(first.accounts).toHaveLength(1)

      // default TTL is 20s
      vi.advanceTimersByTime(19_000)
      await getOverdueSnapshotPage({ pageSize: 100 })
      expect(getOverdueAccounts).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(2_000)
      await getOverdueSnapshotPage({ pageSize: 100 })
      expect(getOverdueAccounts).toHaveBeenCalledTimes(2)
    })

    it('honours OVERDUE_SNAPSHOT_CACHE_TTL_MS', async () => {
      process.env.OVERDUE_SNAPSHOT_CACHE_TTL_MS = '1000'
      getOverdueAccounts.mockResolvedValue({ accounts: [], totalCount: 0 })

      await getOverdueSnapshotPage({ pageSize: 100 })
      vi.advanceTimersByTime(1_500)
      await getOverdueSnapshotPage({ pageSize: 100 })

      expect(getOverdueAccounts).toHaveBeenCalledTimes(2)
    })

    it('coalesces concurrent callers onto a single in-flight fetch', async () => {
      let resolveFetch: (value: unknown) => void = () => {}
      getOverdueAccounts.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve
          }),
      )

      const a = getOverdueSnapshotPage({ pageSize: 100 })
      const b = getOverdueSnapshotPage({ pageSize: 100 })
      const c = getOverdueSnapshotPage({ pageSize: 100 })

      expect(getOverdueAccounts).toHaveBeenCalledTimes(1)

      resolveFetch({ accounts: [account('a')], totalCount: 1 })
      const results = await Promise.all([a, b, c])
      expect(results[0]).toEqual(results[1])
      expect(results[1]).toEqual(results[2])
      expect(getOverdueAccounts).toHaveBeenCalledTimes(1)
    })

    it('does not cache a failed fetch', async () => {
      getOverdueAccounts.mockRejectedValueOnce(new Error('UNAVAILABLE'))
      await expect(getOverdueSnapshotPage({ pageSize: 100 })).rejects.toThrow('UNAVAILABLE')

      getOverdueAccounts.mockResolvedValueOnce({ accounts: [account('a')], totalCount: 1 })
      const retry = await getOverdueSnapshotPage({ pageSize: 100 })

      expect(retry.accounts).toHaveLength(1)
      expect(getOverdueAccounts).toHaveBeenCalledTimes(2)
    })

    it('keys the cache by request filters', async () => {
      getOverdueAccounts.mockResolvedValue({ accounts: [], totalCount: 0 })

      await getOverdueSnapshotPage({ pageSize: 100 })
      await getOverdueSnapshotPage({ pageSize: 100, bucketFilter: 'late_arrears' })
      await getOverdueSnapshotPage({ pageSize: 100, pageToken: 'tok' })

      expect(getOverdueAccounts).toHaveBeenCalledTimes(3)
    })

    it('clamps pageSize to the server maximum', async () => {
      getOverdueAccounts.mockResolvedValue({ accounts: [], totalCount: 0 })
      await getOverdueSnapshotPage({ pageSize: 5000 })
      expect(getOverdueAccounts).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: OVERDUE_PAGE_SIZE_MAX }),
      )
    })
  })

  describe('getFullOverdueSnapshot', () => {
    it('follows next_page_token until the ledger stops paginating', async () => {
      getOverdueAccounts
        .mockResolvedValueOnce({
          accounts: [account('a')],
          totalCount: 3,
          nextPageToken: 'p2',
        })
        .mockResolvedValueOnce({
          accounts: [account('b')],
          totalCount: 3,
          nextPageToken: 'p3',
        })
        .mockResolvedValueOnce({ accounts: [account('c')], totalCount: 3 })

      const snapshot = await getFullOverdueSnapshot()

      expect(getOverdueAccounts).toHaveBeenCalledTimes(3)
      expect(snapshot.accounts.map((a) => a.accountId)).toEqual(['a', 'b', 'c'])
      expect(snapshot.totalCount).toBe(3)
      expect(snapshot.truncated).toBe(false)
      expect(getOverdueAccounts).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ pageToken: 'p2' }),
      )
    })

    it('flags truncation and warns when the page budget is exhausted', async () => {
      process.env.OVERDUE_SNAPSHOT_MAX_PAGES = '2'
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      getOverdueAccounts.mockResolvedValue({
        accounts: [account('a')],
        totalCount: 9999,
        nextPageToken: 'more',
      })

      const snapshot = await getFullOverdueSnapshot()

      expect(getOverdueAccounts).toHaveBeenCalledTimes(2)
      expect(snapshot.truncated).toBe(true)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('truncated'))
      warn.mockRestore()
    })

    it('stops on an empty page even if a token is returned', async () => {
      getOverdueAccounts.mockResolvedValue({
        accounts: [],
        totalCount: 0,
        nextPageToken: 'loop',
      })

      const snapshot = await getFullOverdueSnapshot()

      expect(getOverdueAccounts).toHaveBeenCalledTimes(1)
      expect(snapshot.accounts).toEqual([])
      expect(snapshot.truncated).toBe(false)
    })

    it('memoises and coalesces the full snapshot', async () => {
      getOverdueAccounts.mockResolvedValue({ accounts: [account('a')], totalCount: 1 })

      const [a, b] = await Promise.all([getFullOverdueSnapshot(), getFullOverdueSnapshot()])
      const c = await getFullOverdueSnapshot()

      expect(getOverdueAccounts).toHaveBeenCalledTimes(1)
      expect(a).toEqual(b)
      expect(c).toEqual(a)
    })

    it('does not cache a failed full snapshot', async () => {
      getOverdueAccounts.mockRejectedValueOnce(
        Object.assign(new Error('UNAVAILABLE'), { code: 14 }),
      )
      await expect(getFullOverdueSnapshot()).rejects.toThrow('UNAVAILABLE')

      getOverdueAccounts.mockResolvedValueOnce({ accounts: [account('a')], totalCount: 1 })
      const snapshot = await getFullOverdueSnapshot()
      expect(snapshot.accounts).toHaveLength(1)
      expect(getOverdueAccounts).toHaveBeenCalledTimes(2)
    })
  })
})
