import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { LiveAnnouncer } from '@/components/ui/LiveAnnouncer'
import { useAnnouncerStore } from '@/stores/announcer'

describe('LiveAnnouncer', () => {
  beforeEach(() => {
    cleanup()
    useAnnouncerStore.setState({ polite: '', assertive: '', politeSeq: 0, assertiveSeq: 0 })
  })

  it('exposes a polite status region and an assertive alert region', () => {
    render(<LiveAnnouncer />)
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive')
  })

  it('routes a polite announcement to the status region only', () => {
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Waive fee confirmed.', 'polite'))
    expect(screen.getByRole('status').textContent).toBe('Waive fee confirmed.')
    expect(screen.getByRole('alert').textContent).toBe('')
  })

  it('routes a failure to the assertive region only', () => {
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Waive fee failed.', 'assertive'))
    expect(screen.getByRole('alert').textContent).toBe('Waive fee failed.')
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('re-announces an identical consecutive message', () => {
    // Screen readers ignore an unchanged region, so a second identical failure
    // would otherwise be silent — the case where silence is most dangerous.
    // A changed textContent alone doesn't guarantee a re-read: some screen
    // readers only re-announce a live region on DOM node remount, which is
    // why the region is keyed on its own lane's seq. Assert the node identity
    // actually changes, not just the store's seq counter.
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Ledger unavailable.', 'assertive'))
    const first = useAnnouncerStore.getState().assertiveSeq
    const firstNode = screen.getByRole('alert')
    act(() => useAnnouncerStore.getState().announce('Ledger unavailable.', 'assertive'))
    expect(useAnnouncerStore.getState().assertiveSeq).toBeGreaterThan(first)
    expect(screen.getByRole('alert')).not.toBe(firstNode)
  })

  it('keeps the regions out of the visual layout', () => {
    render(<LiveAnnouncer />)
    expect(screen.getByRole('status').className).not.toBe('')
  })

  // --- Task 3 review, finding 1: the two lanes must be fully independent ---

  it('does not blank the assertive lane when a polite announcement follows it', () => {
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Write off failed.', 'assertive'))
    act(() => useAnnouncerStore.getState().announce('Repayment confirmed.', 'polite'))
    expect(screen.getByRole('alert').textContent).toBe('Write off failed.')
    expect(screen.getByRole('status').textContent).toBe('Repayment confirmed.')
  })

  it('does not lose a failure announcement when a confirmation follows it (failed-then-confirmed)', () => {
    // The exact regression finding 1 exists to prevent: recomputing both
    // lanes on every announce() call blanked whichever lane didn't just
    // fire, so a confirmation right after a failure silently erased the
    // failure — a silent failed write-off is precisely what this feature
    // exists to prevent.
    render(<LiveAnnouncer />)
    act(() =>
      useAnnouncerStore.getState().announce('Write off failed: Ledger unavailable.', 'assertive'),
    )
    act(() => useAnnouncerStore.getState().announce('Waive fee confirmed. $25.00.', 'polite'))
    expect(screen.getByRole('alert').textContent).toBe('Write off failed: Ledger unavailable.')
    expect(screen.getByRole('status').textContent).toBe('Waive fee confirmed. $25.00.')
  })

  it('does not lose a confirmation when a failure follows it (confirmed-then-failed)', () => {
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Waive fee confirmed. $25.00.', 'polite'))
    act(() =>
      useAnnouncerStore.getState().announce('Write off failed: Ledger unavailable.', 'assertive'),
    )
    expect(screen.getByRole('status').textContent).toBe('Waive fee confirmed. $25.00.')
    expect(screen.getByRole('alert').textContent).toBe('Write off failed: Ledger unavailable.')
  })

  it('does not remount the polite region when an assertive announcement fires', () => {
    // Guards against the "stale re-read" failure mode: a shared seq would
    // remount the (unchanged) polite region on every assertive announcement,
    // forcing a screen reader to re-read old, unchanged text as if it were
    // new. Each lane must own its own seq.
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Waive fee confirmed.', 'polite'))
    const politeNode = screen.getByRole('status')
    const politeSeqBefore = useAnnouncerStore.getState().politeSeq
    act(() => useAnnouncerStore.getState().announce('Write off failed.', 'assertive'))
    expect(useAnnouncerStore.getState().politeSeq).toBe(politeSeqBefore)
    expect(screen.getByRole('status')).toBe(politeNode)
    expect(screen.getByRole('status').textContent).toBe('Waive fee confirmed.')
  })
})
