import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ContactNotesTimeline } from '@/components/ServicingView/ContactNotes/ContactNotesTimeline'
import type { ContactNoteData } from '@/hooks/queries/useContactNotes'

const mockContactNoteCard = vi.fn()
vi.mock('@/components/ServicingView/ContactNotes/ContactNoteCard', () => ({
  ContactNoteCard: (props: {
    note: ContactNoteData
    isHighlighted: boolean
    onAmend?: (id: string) => void
    onNavigateToAccount?: (loanAccountId: string) => void
    previousVersions?: ContactNoteData[]
  }) => {
    mockContactNoteCard(props)
    return (
      <div data-testid={`contact-note-card-${props.note.id}`} data-is-highlighted={String(props.isHighlighted)}>
        {props.note.subject}
        {props.previousVersions && props.previousVersions.length > 0 && (
          <span data-testid={`prev-versions-${props.note.id}`}>{props.previousVersions.length}</span>
        )}
      </div>
    )
  },
}))

function createNote(overrides: Partial<ContactNoteData> = {}): ContactNoteData {
  return {
    id: 'note-1',
    channel: 'internal',
    topic: 'internal_note',
    subject: 'Test note',
    content: 'Content',
    priority: 'normal',
    sentiment: 'neutral',
    status: 'active',
    customer: 'cust-001',
    createdBy: 'user-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('ContactNotesTimeline', () => {
  afterEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  it('loading state renders skeleton cards', () => {
    const { container } = render(
      <ContactNotesTimeline
        notes={[]}
        isLoading={true}
        selectedAccountId={null}
        onLoadMore={vi.fn()}
        hasMore={false}
      />,
    )
    const skeletonCards = container.querySelectorAll('[class*="skeletonCard"]')
    expect(skeletonCards).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('renders only active notes, hiding amended ones', () => {
    const notes = [
      createNote({ id: 'n1', subject: 'Active note', status: 'active' }),
      createNote({ id: 'n2', subject: 'Amended note', status: 'amended' }),
    ]
    render(
      <ContactNotesTimeline
        notes={notes}
        isLoading={false}
        selectedAccountId={null}
        onLoadMore={vi.fn()}
        hasMore={false}
      />,
    )
    expect(screen.getByTestId('contact-note-card-n1')).toBeInTheDocument()
    expect(screen.queryByTestId('contact-note-card-n2')).not.toBeInTheDocument()
    expect(mockContactNoteCard).toHaveBeenCalledTimes(1)
  })

  it('passes previousVersions chain to amendment cards', () => {
    const notes = [
      createNote({ id: 'original', subject: 'Original', status: 'amended' }),
      createNote({ id: 'amendment', subject: 'Amendment', status: 'active', amendsNote: 'original' }),
    ]
    render(
      <ContactNotesTimeline
        notes={notes}
        isLoading={false}
        selectedAccountId={null}
        onLoadMore={vi.fn()}
        hasMore={false}
      />,
    )
    expect(screen.getByTestId('contact-note-card-amendment')).toBeInTheDocument()
    expect(screen.getByTestId('prev-versions-amendment')).toHaveTextContent('1')
    expect(screen.queryByTestId('contact-note-card-original')).not.toBeInTheDocument()
  })

  it('builds multi-step chain for A -> B -> C amendments', () => {
    const notes = [
      createNote({ id: 'a', subject: 'Original', status: 'amended' }),
      createNote({ id: 'b', subject: 'First amendment', status: 'amended', amendsNote: 'a' }),
      createNote({ id: 'c', subject: 'Second amendment', status: 'active', amendsNote: 'b' }),
    ]
    render(
      <ContactNotesTimeline
        notes={notes}
        isLoading={false}
        selectedAccountId={null}
        onLoadMore={vi.fn()}
        hasMore={false}
      />,
    )
    expect(screen.getByTestId('contact-note-card-c')).toBeInTheDocument()
    expect(screen.getByTestId('prev-versions-c')).toHaveTextContent('2')
    expect(screen.queryByTestId('contact-note-card-a')).not.toBeInTheDocument()
    expect(screen.queryByTestId('contact-note-card-b')).not.toBeInTheDocument()
  })

  it('sets polite live region attributes for announcements', () => {
    const { container } = render(
      <ContactNotesTimeline
        notes={[createNote({ id: 'n1', subject: 'First' })]}
        isLoading={false}
        selectedAccountId={null}
        onLoadMore={vi.fn()}
        hasMore={false}
      />,
    )
    const timeline = container.querySelector('[class*="timeline"]')
    expect(timeline).toHaveAttribute('aria-live', 'polite')
    expect(timeline).toHaveAttribute('aria-atomic', 'true')
  })

  it('hasMore=true shows Load more button and clicking calls onLoadMore', () => {
    const onLoadMore = vi.fn()
    render(
      <ContactNotesTimeline
        notes={[createNote()]}
        isLoading={false}
        selectedAccountId={null}
        onLoadMore={onLoadMore}
        hasMore={true}
      />,
    )
    const btn = screen.getByRole('button', { name: 'Load more' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('hasMore=false hides Load more button', () => {
    render(
      <ContactNotesTimeline
        notes={[createNote()]}
        isLoading={false}
        selectedAccountId={null}
        onLoadMore={vi.fn()}
        hasMore={false}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('newlyAddedNoteId applies flash wrapper class to matching note container only', () => {
    const notes = [
      createNote({ id: 'flash-me' }),
      createNote({ id: 'no-flash' }),
    ]
    render(
      <ContactNotesTimeline
        notes={notes}
        isLoading={false}
        selectedAccountId={null}
        onLoadMore={vi.fn()}
        hasMore={false}
        newlyAddedNoteId="flash-me"
      />,
    )
    const flashCard = screen.getByTestId('contact-note-card-flash-me')
    const noFlashCard = screen.getByTestId('contact-note-card-no-flash')
    const flashWrapper = flashCard.parentElement
    const noFlashWrapper = noFlashCard.parentElement
    expect(flashWrapper?.className).toContain('noteFlash')
    expect(noFlashWrapper?.className).not.toContain('noteFlash')
  })

  it('selectedAccountId passes through highlight logic such that matching loanAccount gets isHighlighted=true', () => {
    const notes = [
      createNote({
        id: 'highlighted',
        loanAccount: { id: 'la-1', loanAccountId: 'LOAN-001', accountNumber: 'ACC-1' },
      }),
      createNote({
        id: 'not-highlighted',
        loanAccount: { id: 'la-2', loanAccountId: 'LOAN-002', accountNumber: 'ACC-2' },
      }),
    ]
    render(
      <ContactNotesTimeline
        notes={notes}
        isLoading={false}
        selectedAccountId="LOAN-001"
        onLoadMore={vi.fn()}
        hasMore={false}
      />,
    )
    const highlightedCall = mockContactNoteCard.mock.calls.find((c) => c[0].note.id === 'highlighted')
    const notHighlightedCall = mockContactNoteCard.mock.calls.find((c) => c[0].note.id === 'not-highlighted')
    expect(highlightedCall?.[0].isHighlighted).toBe(true)
    expect(notHighlightedCall?.[0].isHighlighted).toBe(false)
  })
})
