/**
 * ApplicationsTable — the Applications list view.
 *
 * Sortable headers are buttons inside <th scope="col"> carrying aria-sort on the
 * active column; derived columns (customer name, amount, purpose, messages)
 * have no button. Rows open the conversation and carry the same
 * data-conversation-card hook the arrow-key navigation already uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'
import type { ConversationSummary } from '@/lib/schemas/conversations'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/admin/applications',
}))
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.PropsWithChildren<{ href: string; [key: string]: unknown }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { ApplicationsTable } from '@/components/ApplicationsView/ApplicationsTable'

const ROWS: ConversationSummary[] = [
  {
    conversationId: 'conv-1',
    customer: { fullName: 'Rohan Sharp', customerId: 'B81FC35E' },
    applicationNumber: 'F68420AA-67F',
    status: 'cancelled',
    decisionStatus: null,
    application: { loanAmount: 100, purpose: 'Bill payment' },
    messageCount: 12,
    lastMessageAt: '2026-10-07T09:40:00.000Z',
    updatedAt: '2026-10-07T09:40:00.000Z',
    startedAt: '2026-10-06T00:00:00.000Z',
  },
  {
    conversationId: 'conv-2',
    customer: { fullName: null, customerId: '56DD5FD7' },
    applicationNumber: '88071842-449',
    status: 'declined',
    decisionStatus: 'declined',
    application: { loanAmount: null, purpose: null },
    messageCount: 0,
    lastMessageAt: null,
    updatedAt: '2026-10-11T09:10:00.000Z',
    startedAt: '2026-10-10T00:00:00.000Z',
  },
]

describe('ApplicationsTable', () => {
  beforeEach(() => push.mockClear())

  it('renders one row per conversation with the customer, application and status', () => {
    render(<ApplicationsTable conversations={ROWS} sort="-updatedAt" onSortChange={vi.fn()} />)
    const rows = screen.getAllByRole('row').slice(1) // minus header
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Rohan Sharp')).toBeInTheDocument()
    expect(within(rows[0]).getByText('F68420AA-67F')).toBeInTheDocument()
    expect(within(rows[0]).getByRole('status')).toHaveTextContent('Cancelled')
    expect(within(rows[0]).getByText('$100.00')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Unknown customer')).toBeInTheDocument()
  })

  it('keeps every column in place with a dash for blanks', () => {
    render(<ApplicationsTable conversations={ROWS} sort="-updatedAt" onSortChange={vi.fn()} />)
    const [first, second] = screen.getAllByRole('row').slice(1)
    const cells = within(second).getAllByRole('cell')
    expect(cells).toHaveLength(10)
    // amount and purpose blank → dash, decision shown as its label
    expect(cells[5]).toHaveTextContent('—')
    expect(cells[6]).toHaveTextContent('—')
    expect(cells[4]).toHaveTextContent('Declined')
    // no decision yet → Pending, matching the filter bar's wording
    expect(within(first).getAllByRole('cell')[4]).toHaveTextContent('Pending')
  })

  it('marks the active sort column and direction for assistive tech', () => {
    render(<ApplicationsTable conversations={ROWS} sort="-updatedAt" onSortChange={vi.fn()} />)
    const lastActivity = screen.getByRole('columnheader', { name: /Last activity/ })
    expect(lastActivity).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: /Started/ })).not.toHaveAttribute('aria-sort')
  })

  it('sorts a new column descending first, then flips it', () => {
    const onSortChange = vi.fn()
    const { rerender } = render(
      <ApplicationsTable conversations={ROWS} sort="-updatedAt" onSortChange={onSortChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Started/ }))
    expect(onSortChange).toHaveBeenLastCalledWith('-startedAt')

    rerender(
      <ApplicationsTable conversations={ROWS} sort="-startedAt" onSortChange={onSortChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Started/ }))
    expect(onSortChange).toHaveBeenLastCalledWith('startedAt')
  })

  it.each([
    ['Customer ID', 'customerIdString'],
    ['Application', 'applicationNumber'],
    ['Status', 'status'],
    ['Decision', 'decisionStatus'],
    ['Started', 'startedAt'],
    ['Last activity', 'updatedAt'],
  ])('header %s sorts by %s', (label, field) => {
    const onSortChange = vi.fn()
    render(<ApplicationsTable conversations={ROWS} sort="status" onSortChange={onSortChange} />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))
    expect(onSortChange).toHaveBeenCalledWith(field === 'status' ? '-status' : `-${field}`)
  })

  it.each(['Customer', 'Amount', 'Purpose', 'Messages'])(
    'derived column %s has a plain header with no sort button',
    (label) => {
      render(<ApplicationsTable conversations={ROWS} sort="-updatedAt" onSortChange={vi.fn()} />)
      const header = screen.getByRole('columnheader', { name: new RegExp(`^${label}$`) })
      expect(within(header).queryByRole('button')).toBeNull()
    },
  )

  it('opens the conversation on row click and on Enter', () => {
    render(<ApplicationsTable conversations={ROWS} sort="-updatedAt" onSortChange={vi.fn()} />)
    const row = screen.getAllByRole('row')[1]
    expect(row).toHaveAttribute('data-conversation-card')
    fireEvent.click(row)
    expect(push).toHaveBeenCalledWith('/admin/applications/conv-1')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(push).toHaveBeenCalledTimes(2)
  })
})
