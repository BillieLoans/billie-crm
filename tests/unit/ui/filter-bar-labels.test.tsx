import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FilterBar } from '@/components/AccountsBrowserView/FilterBar'
import { queryStringToFilters } from '@/lib/account-filters'

// ux-standards.md §1.2 / §1.3. The advanced filter modal mixes three shapes:
// single controls, toggle-button groups, and from/to input pairs. Each needs a
// different association — a <label> is only correct for the first.
const openModal = () => {
  render(
    <FilterBar
      filters={queryStringToFilters('')}
      onChange={vi.fn()}
      totalDocs={0}
      isFetching={false}
      onExport={vi.fn()}
      onShowShortcuts={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByTestId('add-filter'))
}

describe('FilterBar advanced filter modal labelling', () => {
  afterEach(cleanup)

  it.each([
    ['Minimum DPD'],
    ['Last payment before'],
    ['Closure reason'],
    ['Customer status'],
    ['Payment frequency'],
  ])('associates the single control labelled %s', (label) => {
    openModal()
    expect(screen.getByLabelText(label)).toBeDefined()
  })

  it.each([
    ['Status'],
    ['Arrears state (from aging service)'],
    ['Aging bucket'],
  ])('exposes %s as a named group rather than a bare label', (name) => {
    openModal()
    expect(screen.getByRole('group', { name })).toBeDefined()
  })

  it.each([
    ['Minimum outstanding balance'],
    ['Maximum outstanding balance'],
    ['Opened from'],
    ['Opened to'],
    ['Disbursed from'],
    ['Disbursed to'],
    ['Closed from'],
    ['Closed to'],
  ])('gives the range input %s its own accessible name', (name) => {
    openModal()
    expect(screen.getByLabelText(name)).toBeDefined()
  })

  it('marks selected status toggles with aria-pressed', () => {
    openModal()
    const active = screen.getByRole('button', { name: 'Active' })
    expect(active.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(active)
    expect(active.getAttribute('aria-pressed')).toBe('true')
  })
})
