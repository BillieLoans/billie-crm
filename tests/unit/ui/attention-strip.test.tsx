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
})
