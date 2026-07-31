import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Modal } from '@/components/ui/Modal'

// The conformance contract for every modal in the app — docs/ux-standards.md §1.3
// (ARIA APG Dialog), §2.2, and the design spec's "Esc closes the deepest layer" and
// "focus returns exactly to the row that opened it" rules.
describe('Modal', () => {
  afterEach(cleanup)

  const renderModal = (props: Partial<React.ComponentProps<typeof Modal>> = {}) =>
    render(
      <Modal title="Waive fee" onClose={vi.fn()} {...props}>
        <button type="button">First</button>
        <button type="button">Second</button>
      </Modal>,
    )

  it('exposes the container as a modal dialog', () => {
    renderModal()
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('takes its accessible name from the title', () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'Waive fee' })).toBeDefined()
  })

  it('does not put the dialog role on the backdrop', () => {
    const { container } = renderModal()
    // The backdrop is the outermost element; the dialog must be the inner panel,
    // otherwise the accessible name covers the whole viewport and the backdrop's
    // click handler lands on a dialog.
    const backdrop = container.firstElementChild as HTMLElement
    expect(backdrop.getAttribute('role')).toBe('presentation')
    expect(backdrop).not.toBe(screen.getByRole('dialog'))
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn()
    const { container } = renderModal({ onClose })
    fireEvent.click(container.firstElementChild as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when content inside the panel is clicked', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close on backdrop click when dismissal is disabled', () => {
    const onClose = vi.fn()
    const { container } = renderModal({ onClose, dismissOnBackdropClick: false })
    fireEvent.click(container.firstElementChild as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('moves focus into the dialog on open', () => {
    renderModal()
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('restores focus to the invoking element on close', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { unmount } = renderModal()
    expect(document.activeElement).not.toBe(trigger)

    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('wraps focus from the last focusable back to the first on Tab', () => {
    renderModal()
    const close = screen.getByRole('button', { name: 'Close' })
    const second = screen.getByRole('button', { name: 'Second' })

    second.focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
    expect(document.activeElement).toBe(close)
  })

  it('wraps focus from the first focusable back to the last on Shift+Tab', () => {
    renderModal()
    const close = screen.getByRole('button', { name: 'Close' })
    const second = screen.getByRole('button', { name: 'Second' })

    close.focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(second)
  })

  it('gives the close control a text alternative rather than a bare glyph', () => {
    renderModal()
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close.getAttribute('type')).toBe('button')
  })

  it('does not close on Escape when escape dismissal is disabled', () => {
    const onClose = vi.fn()
    renderModal({ onClose, dismissOnEscape: false })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lets a caller keep its own panel width', () => {
    // The shared panel defaults to 500px. Migrated dialogs ranged 480-600px and
    // some carry wide tables, so the override must actually win — an inline style
    // rather than a second class, whose precedence depends on stylesheet order.
    renderModal({ maxWidth: '600px' })
    expect(screen.getByRole('dialog').style.maxWidth).toBe('600px')
  })

  it('can disable the close control while an operation is in flight', () => {
    renderModal({ closeDisabled: true })
    expect(screen.getByRole('button', { name: 'Close' })).toHaveProperty('disabled', true)
  })

  it('puts a supplied test id on the panel, not the backdrop', () => {
    renderModal({ testId: 'my-modal' })
    expect(screen.getByTestId('my-modal')).toBe(screen.getByRole('dialog'))
  })

  it('renders a decorative icon but keeps it out of the accessible name', () => {
    render(
      <Modal title="Write Off Account" icon="❌" onClose={vi.fn()}>
        <button type="button">Only</button>
      </Modal>,
    )
    // The emoji stays visible but must not be announced — "cross mark write off
    // account" is not a useful dialog name.
    const icon = screen.getByText('❌')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('dialog', { name: 'Write Off Account' })).toBeDefined()
  })

  it('supports an explicit aria-label when there is no visible title', () => {
    render(
      <Modal ariaLabel="Filters" onClose={vi.fn()}>
        <button type="button">Only</button>
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeDefined()
  })
})
