import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { LiveAnnouncer } from '@/components/ui/LiveAnnouncer'
import { useAnnouncerStore } from '@/stores/announcer'

describe('LiveAnnouncer', () => {
  beforeEach(() => {
    cleanup()
    useAnnouncerStore.setState({ polite: '', assertive: '', politeSeq: 0, assertiveSeq: 0 })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes a polite status region and an assertive alert region', () => {
    render(<LiveAnnouncer />)
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive')
  })

  it('routes a polite announcement to the status region only', () => {
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Waive fee confirmed.', 'polite'))
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByRole('status').textContent).toBe('Waive fee confirmed.')
    expect(screen.getByRole('alert').textContent).toBe('')
  })

  it('routes a failure to the assertive region only', () => {
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Waive fee failed.', 'assertive'))
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByRole('alert').textContent).toBe('Waive fee failed.')
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('re-announces an identical consecutive message on the same stable node', () => {
    // Node identity must be STABLE (no `key` remount) — a region inserted
    // simultaneously with its content is unreliably announced by some screen
    // readers, so the region must already exist in the DOM before its text
    // changes. To still get a re-read on an unchanged string, the lane clears
    // its text to '' and re-sets the real text on a later tick: a genuine
    // two-phase mutation of the SAME node, not a remount that happens to
    // already contain the text.
    render(<LiveAnnouncer />)

    act(() => useAnnouncerStore.getState().announce('Ledger unavailable.', 'assertive'))
    act(() => vi.advanceTimersByTime(100))
    const firstNode = screen.getByRole('alert')
    expect(firstNode.textContent).toBe('Ledger unavailable.')

    act(() => useAnnouncerStore.getState().announce('Ledger unavailable.', 'assertive'))
    // Identity is unchanged, and the text has been cleared but not yet
    // re-set — proving this is a real mutation in two steps, not a remount
    // that lands with the text already attached.
    expect(screen.getByRole('alert')).toBe(firstNode)
    expect(screen.getByRole('alert').textContent).toBe('')

    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByRole('alert')).toBe(firstNode)
    expect(screen.getByRole('alert').textContent).toBe('Ledger unavailable.')
  })

  it('waits the full 100ms before re-setting the text — a 0ms timer commonly lands in the same coalesced a11y-tree notification and the re-announcement is never observed', () => {
    render(<LiveAnnouncer />)

    act(() => useAnnouncerStore.getState().announce('Ledger unavailable.', 'assertive'))
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByRole('alert').textContent).toBe('Ledger unavailable.')

    act(() => useAnnouncerStore.getState().announce('Ledger unavailable.', 'assertive'))
    expect(screen.getByRole('alert').textContent).toBe('')

    // Just short of the full delay: still cleared, not yet re-set. If this were the old 0ms
    // timer, any positive advance — including 1ms — would already have fired it.
    act(() => vi.advanceTimersByTime(99))
    expect(screen.getByRole('alert').textContent).toBe('')

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('alert').textContent).toBe('Ledger unavailable.')
  })

  it('keeps the regions out of the visual layout', () => {
    render(<LiveAnnouncer />)
    expect(screen.getByRole('status').className).not.toBe('')
  })

  // --- Task 3 review, finding 1: the two lanes must be fully independent ---

  it('does not blank the assertive lane when a polite announcement follows it', () => {
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Write off failed.', 'assertive'))
    act(() => vi.advanceTimersByTime(100))
    act(() => useAnnouncerStore.getState().announce('Repayment confirmed.', 'polite'))
    act(() => vi.advanceTimersByTime(100))
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
    act(() => vi.advanceTimersByTime(100))
    act(() => useAnnouncerStore.getState().announce('Waive fee confirmed. $25.00.', 'polite'))
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByRole('alert').textContent).toBe('Write off failed: Ledger unavailable.')
    expect(screen.getByRole('status').textContent).toBe('Waive fee confirmed. $25.00.')
  })

  it('does not lose a confirmation when a failure follows it (confirmed-then-failed)', () => {
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Waive fee confirmed. $25.00.', 'polite'))
    act(() => vi.advanceTimersByTime(100))
    act(() =>
      useAnnouncerStore.getState().announce('Write off failed: Ledger unavailable.', 'assertive'),
    )
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByRole('status').textContent).toBe('Waive fee confirmed. $25.00.')
    expect(screen.getByRole('alert').textContent).toBe('Write off failed: Ledger unavailable.')
  })

  it('does not remount the polite region when an assertive announcement fires', () => {
    // Guards against the "stale re-read" failure mode: a shared seq would
    // remount the (unchanged) polite region on every assertive announcement,
    // forcing a screen reader to re-read old, unchanged text as if it were
    // new. Each lane must own its own seq — and, independently of seq, the
    // region node itself now never remounts at all.
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Waive fee confirmed.', 'polite'))
    act(() => vi.advanceTimersByTime(100))
    const politeNode = screen.getByRole('status')
    const politeSeqBefore = useAnnouncerStore.getState().politeSeq
    act(() => useAnnouncerStore.getState().announce('Write off failed.', 'assertive'))
    act(() => vi.advanceTimersByTime(100))
    expect(useAnnouncerStore.getState().politeSeq).toBe(politeSeqBefore)
    expect(screen.getByRole('status')).toBe(politeNode)
    expect(screen.getByRole('status').textContent).toBe('Waive fee confirmed.')
  })
  it('reset() clears both rendered regions without announcing (cross-user session clear)', () => {
    // UserSessionGuard calls reset() when a different user authenticates in the same
    // tab. The previous user's last announcement can contain a balance figure, so it
    // must leave the DOM — and seq returning to 0 must not itself speak anything.
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Balance updated to $475.50.', 'polite'))
    act(() => useAnnouncerStore.getState().announce('Write off failed.', 'assertive'))
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByRole('status').textContent).toBe('Balance updated to $475.50.')
    expect(screen.getByRole('alert').textContent).toBe('Write off failed.')

    act(() => useAnnouncerStore.getState().reset())
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByRole('status').textContent).toBe('')
    expect(screen.getByRole('alert').textContent).toBe('')
  })
})
