import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { AddNoteDrawer, type AddNoteDrawerProps } from '@/components/ServicingView/ContactNotes/AddNoteDrawer'

// =============================================================================
// Mocks
// =============================================================================

const mockMutateAsync = vi.fn()
const mockAmendMutateAsync = vi.fn()
let mockIsPending = false

vi.mock('@/hooks/mutations/useCreateNote', () => ({
  useCreateNote: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockIsPending,
  }),
}))
vi.mock('@/hooks/mutations/useAmendNote', () => ({
  useAmendNote: () => ({
    mutateAsync: mockAmendMutateAsync,
    isPending: mockIsPending,
  }),
}))

vi.mock('@/components/ui/ContextDrawer', () => ({
  ContextDrawer: ({
    isOpen,
    onClose,
    title,
    children,
  }: {
    isOpen: boolean
    onClose: () => void
    title: string
    children: React.ReactNode
  }) => {
    if (!isOpen) return null
    return (
      <div data-testid="context-drawer">
        <h2>{title}</h2>
        <button onClick={onClose} data-testid="drawer-close-btn">Close</button>
        {children}
      </div>
    )
  },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// Tiptap mock — deterministic editor for jsdom.
let mockEditorText = ''
let latestOnUpdate: (({ editor }: { editor: MockEditor }) => void) | null = null

interface MockEditor {
  chain: () => MockChain
  getText: () => string
  getJSON: () => object
  commands: { clearContent: ReturnType<typeof vi.fn>; setContent: ReturnType<typeof vi.fn> }
  setEditable: ReturnType<typeof vi.fn>
  isActive: ReturnType<typeof vi.fn>
  state: { selection: { from: number; to: number } }
}

interface MockChain {
  focus: () => MockChain
  toggleBold: () => MockChain
  toggleItalic: () => MockChain
  toggleUnderline: () => MockChain
  toggleBulletList: () => MockChain
  toggleOrderedList: () => MockChain
  toggleLink: (attrs: { href: string }) => MockChain
  run: () => boolean
}

const mockChain: MockChain = {
  focus: () => mockChain,
  toggleBold: () => mockChain,
  toggleItalic: () => mockChain,
  toggleUnderline: () => mockChain,
  toggleBulletList: () => mockChain,
  toggleOrderedList: () => mockChain,
  toggleLink: () => mockChain,
  run: () => true,
}

const mockEditor: MockEditor = {
  chain: () => mockChain,
  getText: () => mockEditorText,
  getJSON: () => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: mockEditorText }] }],
  }),
  commands: {
    clearContent: vi.fn(() => { mockEditorText = '' }),
    setContent: vi.fn((content: { content?: Array<{ content?: Array<{ text?: string }> }> }) => {
      const extracted = content?.content?.[0]?.content?.[0]?.text
      mockEditorText = extracted ?? mockEditorText
    }),
  },
  setEditable: vi.fn(),
  isActive: vi.fn(() => false),
  state: { selection: { from: 0, to: 0 } },
}

vi.mock('@tiptap/react', () => ({
  useEditor: (opts: { onUpdate?: ({ editor }: { editor: MockEditor }) => void }) => {
    latestOnUpdate = opts?.onUpdate ?? null
    return mockEditor
  },
  EditorContent: (props: { editor: unknown; className?: string; 'data-testid'?: string }) => (
    <div data-testid={props['data-testid']} className={props.className}>
      {mockEditorText}
    </div>
  ),
}))

vi.mock('@tiptap/starter-kit', () => ({ default: {} }))
vi.mock('@tiptap/extension-link', () => ({ default: { configure: () => ({}) } }))
vi.mock('@tiptap/extension-underline', () => ({ default: {} }))

// =============================================================================
// Helpers
// =============================================================================

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const mockAccounts = [
  { id: 'payload-id-1', loanAccountId: 'ACC-001', accountNumber: 'ACC-0001', accountStatus: 'active' },
  { id: 'payload-id-2', loanAccountId: 'ACC-002', accountNumber: 'ACC-0002', accountStatus: 'in_arrears' },
]

const defaultProps: AddNoteDrawerProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  customerId: 'cust-123',
  customerName: 'John Smith',
  selectedAccountId: null,
  accounts: mockAccounts as AddNoteDrawerProps['accounts'],
}

function renderDrawer(props: Partial<AddNoteDrawerProps> = {}) {
  const merged = { ...defaultProps, ...props }
  return render(
    React.createElement(createWrapper(), null,
      React.createElement(AddNoteDrawer, merged)
    )
  )
}

function setEditorContent(text: string) {
  mockEditorText = text
  if (latestOnUpdate) {
    latestOnUpdate({ editor: mockEditor })
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('AddNoteDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEditorText = ''
    latestOnUpdate = null
    mockIsPending = false
    mockMutateAsync.mockResolvedValue({ doc: { id: 'note-new-1' } })
    mockAmendMutateAsync.mockResolvedValue({ doc: { id: 'note-amended-1' } })
  })

  afterEach(() => {
    cleanup()
  })

  describe('AC1: Drawer renders with title', () => {
    it('should render the drawer with title "Add Note" when open', () => {
      renderDrawer()
      expect(screen.getByText('Add Note')).toBeInTheDocument()
    })

    it('should render title "Amend Note" in amendment mode', () => {
      renderDrawer({
        amendingNote: {
          id: 'note-1',
          noteType: 'general_enquiry',
          subject: 'Source note',
          content: 'Original',
          priority: 'high',
          sentiment: 'negative',
          status: 'active',
          customer: 'cust-123',
          createdBy: 'user-1',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      } as Partial<AddNoteDrawerProps>)
      expect(screen.getByText('Amend Note')).toBeInTheDocument()
      expect(screen.getByTestId('amend-warning-banner')).toBeInTheDocument()
    })

    it('should not render when isOpen is false', () => {
      renderDrawer({ isOpen: false })
      expect(screen.queryByTestId('context-drawer')).not.toBeInTheDocument()
    })

    it('should render formatting toolbar options', () => {
      renderDrawer()
      expect(screen.getByTestId('content-toolbar')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-bold')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-italic')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-underline')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-bulleted-list')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-numbered-list')).toBeInTheDocument()
      expect(screen.getByTestId('toolbar-link')).toBeInTheDocument()
    })
  })

  describe('AC2: Customer pre-fill (read-only)', () => {
    it('should display the customer name as read-only', () => {
      renderDrawer()
      expect(screen.getByTestId('customer-display')).toHaveTextContent('John Smith')
    })

    it('should fall back to customerId when no customerName is provided', () => {
      renderDrawer({ customerName: undefined })
      expect(screen.getByTestId('customer-display')).toHaveTextContent('cust-123')
    })
  })

  describe('AC3: Account pre-fill', () => {
    it('should pre-fill the linked account dropdown when selectedAccountId matches an account', () => {
      renderDrawer({ selectedAccountId: 'ACC-001' })
      const select = screen.getByTestId('linked-account-select') as HTMLSelectElement
      expect(select.value).toBe('payload-id-1')
    })

    it('should leave account dropdown empty when no account is selected', () => {
      renderDrawer({ selectedAccountId: null })
      const select = screen.getByTestId('linked-account-select') as HTMLSelectElement
      expect(select.value).toBe('')
    })

    it('should render all accounts as options', () => {
      renderDrawer()
      expect(screen.getByText('ACC-0001 (Active)')).toBeInTheDocument()
      expect(screen.getByText('ACC-0002 (In Arrears)')).toBeInTheDocument()
    })

    it('should render a "No account" option', () => {
      renderDrawer()
      expect(screen.getByText('No account (general enquiry)')).toBeInTheDocument()
    })
  })

  describe('Amendment mode prefill', () => {
    it('prefills editable fields from source note', () => {
      renderDrawer({
        amendingNote: {
          id: 'note-1',
          noteType: 'phone_outbound',
          contactDirection: 'outbound',
          subject: 'Existing subject',
          content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Source body' }] }] },
          priority: 'urgent',
          sentiment: 'escalation',
          loanAccount: { id: 'payload-id-2', loanAccountId: 'ACC-002', accountNumber: 'ACC-0002' },
          status: 'active',
          customer: 'cust-123',
          createdBy: 'user-1',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      } as Partial<AddNoteDrawerProps>)

      expect((screen.getByTestId('note-type-select') as HTMLSelectElement).value).toBe('phone_outbound')
      expect((screen.getByTestId('contact-direction-select') as HTMLSelectElement).value).toBe('outbound')
      expect((screen.getByTestId('linked-account-select') as HTMLSelectElement).value).toBe('payload-id-2')
      expect((screen.getByTestId('subject-input') as HTMLInputElement).value).toBe('Existing subject')
      expect((screen.getByTestId('priority-select') as HTMLSelectElement).value).toBe('urgent')
      expect((screen.getByTestId('sentiment-select') as HTMLSelectElement).value).toBe('escalation')
    })
  })

  describe('AC4: Required field validation', () => {
    it('should show error for Note Type when submitting without type', async () => {
      renderDrawer()
      fireEvent.click(screen.getByTestId('add-note-submit-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('note-type-error')).toHaveTextContent(
          'Please select a note type'
        )
      })
    })

    it('should show error for Subject when submitting without subject', async () => {
      renderDrawer()
      fireEvent.change(screen.getByTestId('note-type-select'), {
        target: { value: 'general_enquiry' },
      })
      fireEvent.click(screen.getByTestId('add-note-submit-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('subject-error')).toHaveTextContent('Please enter a subject')
      })
    })

    it('should show error for Content when submitting without content', async () => {
      renderDrawer()
      fireEvent.change(screen.getByTestId('note-type-select'), {
        target: { value: 'general_enquiry' },
      })
      fireEvent.change(screen.getByTestId('subject-input'), {
        target: { value: 'Test subject' },
      })
      fireEvent.click(screen.getByTestId('add-note-submit-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('content-error')).toHaveTextContent('Please enter note content')
      })
    })
  })

  describe('AC5: Direction field conditional display', () => {
    it('should NOT show Direction field by default', () => {
      renderDrawer()
      expect(screen.queryByTestId('direction-field')).not.toBeInTheDocument()
    })

    it.each([
      ['phone_inbound', 'inbound'],
      ['phone_outbound', 'outbound'],
      ['email_inbound', 'inbound'],
      ['email_outbound', 'outbound'],
    ])(
      'should show Direction field and auto-set to "%s" for note type %s',
      (noteType, expectedDirection) => {
        renderDrawer()
        fireEvent.change(screen.getByTestId('note-type-select'), {
          target: { value: noteType },
        })
        expect(screen.getByTestId('direction-field')).toBeInTheDocument()
        const dirSelect = screen.getByTestId('contact-direction-select') as HTMLSelectElement
        expect(dirSelect.value).toBe(expectedDirection)
      }
    )

    it('should show Direction field for SMS but with no auto-set value', () => {
      renderDrawer()
      fireEvent.change(screen.getByTestId('note-type-select'), {
        target: { value: 'sms' },
      })
      expect(screen.getByTestId('direction-field')).toBeInTheDocument()
      const dirSelect = screen.getByTestId('contact-direction-select') as HTMLSelectElement
      expect(dirSelect.value).toBe('')
    })

    it.each(['general_enquiry', 'complaint', 'escalation', 'internal_note', 'account_update', 'collections'])(
      'should NOT show Direction field for %s',
      (noteType) => {
        renderDrawer()
        fireEvent.change(screen.getByTestId('note-type-select'), {
          target: { value: noteType },
        })
        expect(screen.queryByTestId('direction-field')).not.toBeInTheDocument()
      }
    )
  })

  describe('AC6: More expander', () => {
    it('should NOT show Priority and Sentiment by default', () => {
      renderDrawer()
      expect(screen.queryByTestId('priority-select')).not.toBeInTheDocument()
      expect(screen.queryByTestId('sentiment-select')).not.toBeInTheDocument()
    })

    it('should show Priority and Sentiment after clicking "More"', () => {
      renderDrawer()
      fireEvent.click(screen.getByTestId('more-expander-btn'))
      expect(screen.getByTestId('priority-select')).toBeInTheDocument()
      expect(screen.getByTestId('sentiment-select')).toBeInTheDocument()
    })

    it('should default Priority to "normal" when expanded', () => {
      renderDrawer()
      fireEvent.click(screen.getByTestId('more-expander-btn'))
      const prioritySelect = screen.getByTestId('priority-select') as HTMLSelectElement
      expect(prioritySelect.value).toBe('normal')
    })

    it('should default Sentiment to "neutral" when expanded', () => {
      renderDrawer()
      fireEvent.click(screen.getByTestId('more-expander-btn'))
      const sentimentSelect = screen.getByTestId('sentiment-select') as HTMLSelectElement
      expect(sentimentSelect.value).toBe('neutral')
    })

    it('should hide Priority and Sentiment again after clicking "Less"', () => {
      renderDrawer()
      fireEvent.click(screen.getByTestId('more-expander-btn'))
      expect(screen.getByTestId('more-fields')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('more-expander-btn'))
      expect(screen.queryByTestId('more-fields')).not.toBeInTheDocument()
    })
  })

  describe('AC8: Subject length limit', () => {
    it('should show validation error when subject exceeds 200 characters', async () => {
      renderDrawer()
      fireEvent.change(screen.getByTestId('note-type-select'), {
        target: { value: 'general_enquiry' },
      })
      fireEvent.change(screen.getByTestId('subject-input'), {
        target: { value: 'a'.repeat(201) },
      })
      fireEvent.click(screen.getByTestId('add-note-submit-btn'))
      await waitFor(() => {
        expect(screen.getByTestId('subject-error')).toHaveTextContent(
          'Subject must be 200 characters or less'
        )
      })
    })
  })

  describe('AC9: Submit success flow', () => {
    async function fillAndSubmit(extraProps: Partial<AddNoteDrawerProps> = {}) {
      renderDrawer(extraProps)
      fireEvent.change(screen.getByTestId('note-type-select'), {
        target: { value: 'general_enquiry' },
      })
      fireEvent.change(screen.getByTestId('subject-input'), {
        target: { value: 'Test subject' },
      })
      setEditorContent('Test content body')
      await act(async () => {
        fireEvent.click(screen.getByTestId('add-note-submit-btn'))
      })
    }

    it('should POST with correct payload on submit', async () => {
      await fillAndSubmit()
      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1))
      const call = mockMutateAsync.mock.calls[0][0]
      expect(call.customer).toBe('cust-123')
      expect(call.noteType).toBe('general_enquiry')
      expect(call.subject).toBe('Test subject')
      expect(call.content).toMatchObject({ type: 'doc' })
    })

    it('should close the drawer on success', async () => {
      const onClose = vi.fn()
      await fillAndSubmit({ onClose })
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    })

    it('should call onSuccess with the new note id', async () => {
      const onSuccess = vi.fn()
      await fillAndSubmit({ onSuccess })
      await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('note-new-1'))
    })

    it('uses amendment mutation flow when amending note is provided', async () => {
      await fillAndSubmit({
        amendingNote: {
          id: 'note-original-1',
          noteType: 'general_enquiry',
          subject: 'Original subject',
          content: 'Original content',
          priority: 'normal',
          sentiment: 'neutral',
          status: 'active',
          customer: 'cust-123',
          createdBy: 'user-1',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        } as AddNoteDrawerProps['amendingNote'],
      })
      await waitFor(() => expect(mockAmendMutateAsync).toHaveBeenCalledTimes(1))
      expect(mockMutateAsync).not.toHaveBeenCalled()
      const call = mockAmendMutateAsync.mock.calls[0][0]
      expect(call.originalNoteId).toBe('note-original-1')
    })

    it('should include direction for phone_inbound type', async () => {
      renderDrawer()
      fireEvent.change(screen.getByTestId('note-type-select'), {
        target: { value: 'phone_inbound' },
      })
      fireEvent.change(screen.getByTestId('subject-input'), {
        target: { value: 'Call note' },
      })
      setEditorContent('Content')
      await act(async () => {
        fireEvent.click(screen.getByTestId('add-note-submit-btn'))
      })
      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled())
      const call = mockMutateAsync.mock.calls[0][0]
      expect(call.contactDirection).toBe('inbound')
    })

    it('should NOT include direction for non-communication note types', async () => {
      await fillAndSubmit()
      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled())
      const call = mockMutateAsync.mock.calls[0][0]
      expect(call.contactDirection).toBeUndefined()
    })

    it('should submit content in Tiptap JSON format', async () => {
      await fillAndSubmit()
      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled())
      const call = mockMutateAsync.mock.calls[0][0]
      expect(call.content).toMatchObject({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Test content body' }] },
        ],
      })
    })
  })

  describe('Submit button state', () => {
    it('should show "Submit" label when not pending', () => {
      renderDrawer()
      expect(screen.getByTestId('add-note-submit-btn')).toHaveTextContent('Submit')
    })

    it('should close drawer when Cancel is clicked', () => {
      const onClose = vi.fn()
      renderDrawer({ onClose })
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should disable toolbar buttons while pending', () => {
      mockIsPending = true
      renderDrawer()
      expect(screen.getByTestId('toolbar-bold')).toBeDisabled()
      expect(screen.getByTestId('toolbar-italic')).toBeDisabled()
      expect(screen.getByTestId('toolbar-underline')).toBeDisabled()
    })

    it('should call setEditable(false) on editor while pending', () => {
      mockIsPending = true
      renderDrawer()
      expect(mockEditor.setEditable).toHaveBeenCalledWith(false)
    })
  })

  describe('AC10: Cmd+Enter submit', () => {
    it('should submit form on Cmd+Enter from within the form', async () => {
      renderDrawer()
      fireEvent.change(screen.getByTestId('note-type-select'), {
        target: { value: 'general_enquiry' },
      })
      fireEvent.change(screen.getByTestId('subject-input'), {
        target: { value: 'Quick note' },
      })
      setEditorContent('Content here')

      await act(async () => {
        fireEvent.keyDown(screen.getByTestId('add-note-form'), {
          key: 'Enter',
          metaKey: true,
        })
      })

      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1))
    })
  })

  describe('Editor reset on reopen', () => {
    it('calls clearContent when drawer is closed and reopened', () => {
      const { rerender } = renderDrawer({ isOpen: true })

      rerender(
        React.createElement(createWrapper(), null,
          React.createElement(AddNoteDrawer, { ...defaultProps, isOpen: false })
        )
      )
      rerender(
        React.createElement(createWrapper(), null,
          React.createElement(AddNoteDrawer, { ...defaultProps, isOpen: true })
        )
      )

      expect(mockEditor.commands.clearContent).toHaveBeenCalled()
    })
  })
})
