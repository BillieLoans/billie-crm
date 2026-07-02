// tests/unit/ui/attention-strip.test.tsx
import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { AttentionStrip } from '@/components/ServicingView/AttentionStrip'
import type { AttentionItem } from '@/lib/accountTriage'

afterEach(() => cleanup())

const items: AttentionItem[] = [
  { kind: 'vulnerable', label: 'Vulnerable customer', accountId: null, severity: 'high' },
  { kind: 'overdue', label: '1 account overdue', accountId: 'LOAN-9', severity: 'high' },
]

describe('AttentionStrip', () => {
  test('renders nothing when there are no items', () => {
    const { container } = render(<AttentionStrip items={[]} onSelectAccount={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('renders a chip per item', () => {
    render(<AttentionStrip items={items} onSelectAccount={vi.fn()} />)
    expect(screen.getByText('Vulnerable customer')).toBeInTheDocument()
    expect(screen.getByText('1 account overdue')).toBeInTheDocument()
  })

  test('clicking a chip with an accountId selects that account', () => {
    const onSelectAccount = vi.fn()
    render(<AttentionStrip items={items} onSelectAccount={onSelectAccount} />)
    fireEvent.click(screen.getByText('1 account overdue'))
    expect(onSelectAccount).toHaveBeenCalledWith('LOAN-9')
  })

  test('a chip with no accountId (e.g. vulnerable) is not clickable', () => {
    const onSelectAccount = vi.fn()
    render(<AttentionStrip items={items} onSelectAccount={onSelectAccount} />)
    fireEvent.click(screen.getByText('Vulnerable customer'))
    expect(onSelectAccount).not.toHaveBeenCalled()
  })

  test('renders the collections/hardship/stop_contact chips (BTB-197 WS4)', () => {
    const collectionsItems: AttentionItem[] = [
      { kind: 'collections', label: 'In collections', accountId: 'LOAN-1', severity: 'high' },
      { kind: 'hardship', label: 'Hardship paused', accountId: 'LOAN-1', severity: 'medium' },
      { kind: 'stop_contact', label: 'Contact stopped', accountId: null, severity: 'high' },
    ]
    const onSelectAccount = vi.fn()
    render(<AttentionStrip items={collectionsItems} onSelectAccount={onSelectAccount} />)

    expect(screen.getByText('In collections')).toBeInTheDocument()
    expect(screen.getByText('Hardship paused')).toBeInTheDocument()
    expect(screen.getByText('Contact stopped')).toBeInTheDocument()

    // Per-account kinds select that account; the customer-level stop_contact chip does not.
    fireEvent.click(screen.getByText('In collections'))
    expect(onSelectAccount).toHaveBeenCalledWith('LOAN-1')
    onSelectAccount.mockClear()
    fireEvent.click(screen.getByText('Contact stopped'))
    expect(onSelectAccount).not.toHaveBeenCalled()
  })
})
