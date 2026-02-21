import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ContactNoteData, UseContactNotesResult } from '@/hooks/queries/useContactNotes'

// Mock the data hook entirely so no real fetching occurs
vi.mock('@/hooks/queries/useContactNotes', () => ({
  useContactNotes: vi.fn(),
}))

// Mock mutation hook — AddNoteDrawer uses this
vi.mock('@/hooks/mutations/useCreateNote', () => ({
  useCreateNote: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

// Mock hotkeys hook — no DOM event listener side effects in tests
vi.mock('@/components/ServicingView/ContactNotes/useContactNotesHotkeys', () => ({
  useContactNotesHotkeys: vi.fn(),
}))

// Stub child components to keep tests focused on panel logic
vi.mock('@/components/ServicingView/ContactNotes/ContactNoteFilters', () => ({
  ContactNoteFilters: () => null,
}))

vi.mock('@/components/ServicingView/ContactNotes/ContactNotesTimeline', () => ({
  ContactNotesTimeline: ({
    notes,
    onLoadMore,
    hasMore,
    onAmend,
  }: {
    notes: ContactNoteData[]
    onLoadMore?: () => void
    hasMore?: boolean
    onAmend?: (noteId: string) => void
  }) => (
    <div data-testid="timeline">
      {notes.length} notes
      {hasMore && onLoadMore && (
        <button type="button" onClick={onLoadMore}>
          Load more
        </button>
      )}
      {notes[0] && onAmend && (
        <button type="button" onClick={() => onAmend(notes[0].id)}>
          Trigger amend
        </button>
      )}
    </div>
  ),
}))

// Stub AddNoteDrawer — track open state; supports triggering onSuccess for timer-cleanup test
vi.mock('@/components/ServicingView/ContactNotes/AddNoteDrawer', () => ({
  AddNoteDrawer: ({
    isOpen,
    onSuccess,
    amendingNote,
  }: {
    isOpen: boolean
    onSuccess?: (noteId: string) => void
    amendingNote?: ContactNoteData | null
  }) =>
    isOpen ? (
      <div data-testid="add-note-drawer">
        {amendingNote ? <div data-testid="amending-note-id">{amendingNote.id}</div> : null}
        {onSuccess && (
          <button
            type="button"
            data-testid="simulate-note-success"
            onClick={() => onSuccess('new-note-id')}
          >
            Simulate note success
          </button>
        )}
      </div>
    ) : null,
}))

// Import after mocks
import { useContactNotes } from '@/hooks/queries/useContactNotes'
import { ContactNotesPanel } from '@/components/ServicingView/ContactNotes/ContactNotesPanel'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const mockUseContactNotes = vi.mocked(useContactNotes)

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

function renderPanel(props: Partial<React.ComponentProps<typeof ContactNotesPanel>> = {}) {
  const defaultProps = {
    customerId: 'cust-001',
    customerName: 'Test Customer',
    selectedAccountId: null,
    accounts: [] as LoanAccountData[],
  }
  return render(<ContactNotesPanel {...defaultProps} {...props} />, { wrapper: createWrapper() })
}

const makeEmptyResult = (): UseContactNotesResult => ({
  notes: [],
  totalDocs: 0,
  hasNextPage: false,
  isLoading: false,
  isSuccess: true,
  isError: false,
  error: null,
  fetchStatus: 'idle',
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(() => Promise.resolve()),
})

const makeNote = (id: string, subject: string): ContactNoteData => ({
  id,
  channel: 'internal' as const,
  topic: 'internal_note' as const,
  subject,
  content: {},
  priority: 'normal' as const,
  sentiment: 'neutral' as const,
  status: 'active' as const,
  customer: 'cust-001',
  createdBy: 'user-001',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
})

const makeResultWithNotes = (count: number): UseContactNotesResult => ({
  notes: Array.from({ length: count }, (_, i) => makeNote(`note-${i}`, `Note ${i}`)),
  totalDocs: count,
  hasNextPage: false,
  isLoading: false,
  isSuccess: true,
  isError: false,
  error: null,
  fetchStatus: 'idle',
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(() => Promise.resolve()),
})

describe('ContactNotesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseContactNotes.mockReturnValue(makeEmptyResult() as ReturnType<typeof useContactNotes>)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders header with "Contact Notes" title', () => {
    renderPanel()
    expect(screen.getByText(/Contact Notes/)).toBeInTheDocument()
  })

  it('renders the "+ Add Note" button', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: '+ Add Note' })).toBeInTheDocument()
  })

  it('opens the Add Note drawer when "+ Add Note" button is clicked', () => {
    renderPanel()
    expect(screen.queryByTestId('add-note-drawer')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ Add Note' }))
    expect(screen.getByTestId('add-note-drawer')).toBeInTheDocument()
  })

  it('shows empty state when there are no notes', () => {
    mockUseContactNotes.mockReturnValue(makeEmptyResult() as ReturnType<typeof useContactNotes>)
    renderPanel()
    expect(screen.getByText(/No contact notes yet for this customer/)).toBeInTheDocument()
  })

  it('shows note count in header when notes exist', () => {
    mockUseContactNotes.mockReturnValue(makeResultWithNotes(3) as ReturnType<typeof useContactNotes>)
    renderPanel()
    expect(screen.getByText(/\(3\)/)).toBeInTheDocument()
  })

  it('does not show empty state when notes exist', () => {
    mockUseContactNotes.mockReturnValue(makeResultWithNotes(1) as ReturnType<typeof useContactNotes>)
    renderPanel()
    expect(screen.queryByText(/No contact notes yet for this customer/)).not.toBeInTheDocument()
    expect(screen.getByTestId('timeline')).toBeInTheDocument()
  })

  it('calls fetchNextPage when Load more is clicked', async () => {
    const fetchNextPage = vi.fn(() => Promise.resolve())
    mockUseContactNotes.mockReturnValue({
      ...makeResultWithNotes(1),
      hasNextPage: true,
      fetchNextPage,
    } as ReturnType<typeof useContactNotes>)
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => {
      expect(fetchNextPage).toHaveBeenCalledTimes(1)
    })
  })

  it('clears pending flash timer on unmount when AddNoteDrawer onSuccess fires', () => {
    vi.useFakeTimers()
    try {
      mockUseContactNotes.mockReturnValue(makeEmptyResult() as ReturnType<typeof useContactNotes>)
      const { unmount } = renderPanel()
      fireEvent.click(screen.getByRole('button', { name: '+ Add Note' }))
      fireEvent.click(screen.getByTestId('simulate-note-success'))
      unmount()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('scrolls panel into view when note creation succeeds', () => {
    const scrollSpy = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollSpy
    try {
      mockUseContactNotes.mockReturnValue(makeEmptyResult() as ReturnType<typeof useContactNotes>)
      renderPanel()
      fireEvent.click(screen.getByRole('button', { name: '+ Add Note' }))
      fireEvent.click(screen.getByTestId('simulate-note-success'))
      expect(scrollSpy).toHaveBeenCalledTimes(1)
    } finally {
      HTMLElement.prototype.scrollIntoView = original
    }
  })

  it('passes selected note to drawer when amend action is triggered from timeline', () => {
    mockUseContactNotes.mockReturnValue(makeResultWithNotes(1) as ReturnType<typeof useContactNotes>)
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Trigger amend' }))
    expect(screen.getByTestId('add-note-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('amending-note-id')).toHaveTextContent('note-0')
  })
})
