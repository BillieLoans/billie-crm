import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { LiveAnnouncer } from '@/components/ui/LiveAnnouncer'
import { useAnnouncerStore } from '@/stores/announcer'

describe('LiveAnnouncer', () => {
  beforeEach(() => {
    cleanup()
    useAnnouncerStore.setState({ polite: '', assertive: '', seq: 0 })
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
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Ledger unavailable.', 'assertive'))
    const first = useAnnouncerStore.getState().seq
    act(() => useAnnouncerStore.getState().announce('Ledger unavailable.', 'assertive'))
    expect(useAnnouncerStore.getState().seq).toBeGreaterThan(first)
  })

  it('keeps the regions out of the visual layout', () => {
    render(<LiveAnnouncer />)
    expect(screen.getByRole('status').className).not.toBe('')
  })
})
