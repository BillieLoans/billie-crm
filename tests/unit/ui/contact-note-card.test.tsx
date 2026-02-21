import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ContactNoteCard } from '@/components/ServicingView/ContactNotes/ContactNoteCard'
import type { ContactNoteData } from '@/hooks/queries/useContactNotes'

const createMockNote = (overrides: Partial<ContactNoteData> = {}): ContactNoteData => ({
  id: 'note-1',
  noteType: 'phone_inbound',
  contactDirection: 'inbound',
  subject: 'Follow-up on payment',
  content: 'Customer called to discuss payment arrangement.',
  priority: 'normal',
  sentiment: 'neutral',
  status: 'active',
  amendsNote: null,
  customer: 'cust-1',
  loanAccount: {
    id: 'la-1',
    loanAccountId: 'LOAN-001',
    accountNumber: 'ACC-12345',
  },
  createdBy: {
    id: 'user-1',
    firstName: 'Sarah',
    lastName: 'Chen',
    email: 'sarah.chen@example.com',
  },
  createdAt: '2024-06-01T10:30:00Z',
  updatedAt: '2024-06-01T10:30:00Z',
  ...overrides,
})

describe('ContactNoteCard component', () => {
  afterEach(() => {
    cleanup()
  })

  test('renders type icon and label for phone_inbound', () => {
    render(<ContactNoteCard note={createMockNote()} isHighlighted={false} onAmend={vi.fn()} />)
    expect(screen.getByText(/📞/)).toBeInTheDocument()
    expect(screen.getByText(/Inbound Call/)).toBeInTheDocument()
  })

  test('renders subject', () => {
    render(<ContactNoteCard note={createMockNote()} isHighlighted={false} onAmend={vi.fn()} />)
    expect(screen.getByText('Follow-up on payment')).toBeInTheDocument()
  })

  test('hides priority badge when priority is normal', () => {
    render(<ContactNoteCard note={createMockNote({ priority: 'normal' })} isHighlighted={false} onAmend={vi.fn()} />)
    expect(screen.queryByText(/Priority/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Urgent')).not.toBeInTheDocument()
  })

  test('shows priority badge when priority is high', () => {
    render(<ContactNoteCard note={createMockNote({ priority: 'high' })} isHighlighted={false} onAmend={vi.fn()} />)
    const badge = screen.getByText('High Priority')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('badgePriorityHigh')
  })

  test('hides sentiment badge when sentiment is neutral', () => {
    render(<ContactNoteCard note={createMockNote({ sentiment: 'neutral' })} isHighlighted={false} onAmend={vi.fn()} />)
    expect(screen.queryByText('Positive')).not.toBeInTheDocument()
    expect(screen.queryByText('Negative')).not.toBeInTheDocument()
    expect(screen.queryByText('Escalation')).not.toBeInTheDocument()
  })

  test('shows sentiment badge when sentiment is negative', () => {
    render(<ContactNoteCard note={createMockNote({ sentiment: 'negative' })} isHighlighted={false} onAmend={vi.fn()} />)
    const badge = screen.getByText('Negative')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('badgeSentimentNegative')
  })

  test('shows AMENDED badge when previousVersions are present', () => {
    const previousVersion = createMockNote({ id: 'prev-1', subject: 'Old subject' })
    render(
      <ContactNoteCard
        note={createMockNote({ amendsNote: 'prev-1' })}
        isHighlighted={false}
        onAmend={vi.fn()}
        previousVersions={[previousVersion]}
      />,
    )
    const badge = screen.getByText('AMENDED')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('badgeAmendment')
  })

  test('does not show AMENDED badge when no previousVersions', () => {
    render(<ContactNoteCard note={createMockNote()} isHighlighted={false} onAmend={vi.fn()} />)
    expect(screen.queryByText('AMENDED')).not.toBeInTheDocument()
  })

  test('shows Amend button when onAmend is provided', () => {
    render(<ContactNoteCard note={createMockNote({ status: 'active' })} isHighlighted={false} onAmend={vi.fn()} />)
    expect(screen.getByText('Amend ↗')).toBeInTheDocument()
  })

  test('hides Amend button when onAmend is not provided', () => {
    render(<ContactNoteCard note={createMockNote({ status: 'active' })} isHighlighted={false} />)
    expect(screen.queryByText('Amend ↗')).not.toBeInTheDocument()
  })

  test('calls onAmend with note id when Amend button is clicked', () => {
    const onAmend = vi.fn()
    render(<ContactNoteCard note={createMockNote({ id: 'note-abc' })} isHighlighted={false} onAmend={onAmend} />)
    fireEvent.click(screen.getByText('Amend ↗'))
    expect(onAmend).toHaveBeenCalledWith('note-abc')
  })

  test('amendment history toggle shows and hides previous versions', () => {
    const prev = createMockNote({
      id: 'prev-1',
      subject: 'Original subject',
      content: 'Original content',
      createdAt: '2024-05-31T10:00:00Z',
    })
    render(
      <ContactNoteCard
        note={createMockNote({ amendsNote: 'prev-1' })}
        isHighlighted={false}
        onAmend={vi.fn()}
        previousVersions={[prev]}
      />,
    )
    const toggle = screen.getByTestId('amendment-history-toggle')
    expect(toggle).toHaveTextContent('1 previous version')
    expect(screen.queryByTestId('amendment-history-list')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.getByTestId('amendment-history-list')).toBeInTheDocument()
    expect(screen.getByText('Original subject')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.queryByTestId('amendment-history-list')).not.toBeInTheDocument()
  })

  test('amendment history shows multiple previous versions with correct count', () => {
    const prevVersions = [
      createMockNote({ id: 'v1', subject: 'Version 1', createdAt: '2024-05-29T10:00:00Z' }),
      createMockNote({ id: 'v2', subject: 'Version 2', createdAt: '2024-05-30T10:00:00Z' }),
    ]
    render(
      <ContactNoteCard
        note={createMockNote({ amendsNote: 'v2' })}
        isHighlighted={false}
        onAmend={vi.fn()}
        previousVersions={prevVersions}
      />,
    )
    const toggle = screen.getByTestId('amendment-history-toggle')
    expect(toggle).toHaveTextContent('2 previous versions')

    fireEvent.click(toggle)
    expect(screen.getAllByTestId('previous-version-card')).toHaveLength(2)
  })

  test('does not show amendment history when previousVersions is empty', () => {
    render(<ContactNoteCard note={createMockNote()} isHighlighted={false} onAmend={vi.fn()} />)
    expect(screen.queryByTestId('amendment-history-toggle')).not.toBeInTheDocument()
  })

  test('shows linked account number when loanAccount is populated', () => {
    render(
      <ContactNoteCard
        note={createMockNote({ loanAccount: { id: 'la-1', loanAccountId: 'LOAN-001', accountNumber: 'ACC-12345' } })}
        isHighlighted={false}
        onAmend={vi.fn()}
      />,
    )
    expect(screen.getByText(/ACC-12345/)).toBeInTheDocument()
  })

  test('hides linked account when loanAccount is null', () => {
    render(
      <ContactNoteCard note={createMockNote({ loanAccount: null })} isHighlighted={false} onAmend={vi.fn()} />,
    )
    expect(screen.queryByText(/ACC-/)).not.toBeInTheDocument()
    expect(screen.queryByText(/🔗/)).not.toBeInTheDocument()
  })

  test('shows author name from createdBy object', () => {
    render(
      <ContactNoteCard
        note={createMockNote({ createdBy: { id: 'user-1', firstName: 'Sarah', lastName: 'Chen' } })}
        isHighlighted={false}
        onAmend={vi.fn()}
      />,
    )
    expect(screen.getByText('By Sarah Chen')).toBeInTheDocument()
  })

  test('applies highlighted class when isHighlighted is true', () => {
    const { container } = render(
      <ContactNoteCard note={createMockNote()} isHighlighted={true} onAmend={vi.fn()} />,
    )
    const card = container.firstChild as HTMLElement
    expect(card.className).toContain('noteCardHighlighted')
  })

  test('does not apply highlighted class when isHighlighted is false', () => {
    const { container } = render(
      <ContactNoteCard note={createMockNote()} isHighlighted={false} onAmend={vi.fn()} />,
    )
    const card = container.firstChild as HTMLElement
    expect(card.className).not.toContain('noteCardHighlighted')
  })

  test('body truncation: shows Show more button and expands on click then collapses', () => {
    render(
      <ContactNoteCard
        note={createMockNote({ content: 'Long body content that should be truncated.' })}
        isHighlighted={false}
        onAmend={vi.fn()}
      />,
    )
    const showMoreBtn = screen.getByText('Show more')
    expect(showMoreBtn).toBeInTheDocument()

    fireEvent.click(showMoreBtn)
    expect(screen.getByText('Show less')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Show less'))
    expect(screen.getByText('Show more')).toBeInTheDocument()
  })

  test('extracts text from Tiptap JSON content', () => {
    const tiptapContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello from Tiptap' }] },
      ],
    }
    render(
      <ContactNoteCard note={createMockNote({ content: tiptapContent })} isHighlighted={false} />,
    )
    expect(screen.getByText('Hello from Tiptap')).toBeInTheDocument()
  })

  test('extracts text from legacy Lexical JSON content', () => {
    const lexicalContent = {
      root: {
        type: 'root',
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: 'Hello from Lexical' }] },
        ],
      },
    }
    render(
      <ContactNoteCard note={createMockNote({ content: lexicalContent })} isHighlighted={false} />,
    )
    expect(screen.getByText('Hello from Lexical')).toBeInTheDocument()
  })
})
