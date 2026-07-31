import { describe, it, expect, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { LiveAnnouncer } from '@/components/ui/LiveAnnouncer'
import { useAnnouncerStore } from '@/stores/announcer'
import { useOptimisticStore } from '@/stores/optimistic'
import type { PendingMutation } from '@/types/mutation'

const mutation = (over: Partial<PendingMutation> = {}): PendingMutation => ({
  id: 'm1',
  accountId: 'acc-1',
  action: 'waive-fee',
  stage: 'optimistic',
  amount: 25,
  createdAt: 0,
  ...over,
})

describe('useOptimisticAnnouncements', () => {
  beforeEach(() => {
    cleanup()
    useAnnouncerStore.setState({ polite: '', assertive: '', politeSeq: 0, assertiveSeq: 0 })
    useOptimisticStore.setState({ pendingByAccount: new Map() })
  })

  it('stays silent while a mutation is still in flight', () => {
    render(<LiveAnnouncer />)
    act(() => useOptimisticStore.getState().setPending('acc-1', mutation()))
    expect(useAnnouncerStore.getState().polite).toBe('')
    expect(useAnnouncerStore.getState().assertive).toBe('')
  })

  it('announces politely once the mutation is confirmed', () => {
    render(<LiveAnnouncer />)
    act(() => useOptimisticStore.getState().setPending('acc-1', mutation()))
    act(() => useOptimisticStore.getState().setStage('acc-1', 'm1', 'confirmed'))
    expect(useAnnouncerStore.getState().polite).toBe('Waive fee confirmed. $25.00.')
  })

  it('announces assertively with the reason on failure', () => {
    render(<LiveAnnouncer />)
    act(() => useOptimisticStore.getState().setPending('acc-1', mutation()))
    act(() => useOptimisticStore.getState().setStage('acc-1', 'm1', 'failed', 'Ledger unavailable'))
    expect(useAnnouncerStore.getState().assertive).toBe('Waive fee failed: Ledger unavailable.')
  })

  it('does not announce the same settled mutation twice', () => {
    render(<LiveAnnouncer />)
    act(() => useOptimisticStore.getState().setPending('acc-1', mutation()))
    act(() => useOptimisticStore.getState().setStage('acc-1', 'm1', 'confirmed'))
    const seqAfterFirst = useAnnouncerStore.getState().politeSeq
    act(() => useOptimisticStore.getState().setStage('acc-1', 'm1', 'confirmed'))
    expect(useAnnouncerStore.getState().politeSeq).toBe(seqAfterFirst)
  })

  it('does not re-announce a settled mutation still resident after unmount and remount', () => {
    // Task 3 review, finding 2: settled mutations linger in the store for
    // ~2s (useWaiveFee's delayed clearPending call). If the dedupe record
    // lived on a per-instance useRef, an unmount/remount inside that window
    // (e.g. a providers-tree remount) would start from an empty Set and
    // re-announce an outcome the user already heard.
    const { unmount } = render(<LiveAnnouncer />)
    act(() => useOptimisticStore.getState().setPending('acc-1', mutation()))
    act(() => useOptimisticStore.getState().setStage('acc-1', 'm1', 'confirmed'))
    const seqAfterFirst = useAnnouncerStore.getState().politeSeq

    unmount()
    render(<LiveAnnouncer />)

    // The mutation is still resident (never cleared) — a subsequent store
    // write must not re-trigger the announcement.
    act(() => useOptimisticStore.getState().setStage('acc-1', 'm1', 'confirmed'))
    expect(useAnnouncerStore.getState().politeSeq).toBe(seqAfterFirst)
  })
})
