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
    useAnnouncerStore.setState({ polite: '', assertive: '', seq: 0 })
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
    const seqAfterFirst = useAnnouncerStore.getState().seq
    act(() => useOptimisticStore.getState().setStage('acc-1', 'm1', 'confirmed'))
    expect(useAnnouncerStore.getState().seq).toBe(seqAfterFirst)
  })
})
