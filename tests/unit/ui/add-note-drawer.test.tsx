import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { AddNoteDrawer, type AddNoteDrawerProps } from '@/components/ServicingView/ContactNotes/AddNoteDrawer'

const mockMutateAsync = vi.fn()
const mockAmendMutateAsync = vi.fn()
let mockIsPending = false

vi.mock('@/hooks/mutations/useCreateNote', () => ({
  useCreateNote: () => ({ mutateAsync: mockMutateAsync, isPending: mockIsPending }),
}))
vi.mock('@/hooks/mutations/useAmendNote', () => ({
  useAmendNote: () => ({ mutateAsync: mockAmendMutateAsync, isPending: mockIsPending }),
}))

vi.mock('@/components/ui/ContextDrawer', () => ({
  ContextDrawer: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? (
      <div data-testid="context-drawer">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}))

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
  getJSON: () => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: mockEditorText }] }] }),
  commands: {
    clearContent: vi.fn(() => {
      mockEditorText = ''
    }),
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
  EditorContent: (props: { className?: string; 'data-testid'?: string }) => (
    <div data-testid={props['data-testid']} className={props.className}>
      {mockEditorText}
    </div>
  ),
}))
vi.mock('@tiptap/starter-kit', () => ({ default: {} }))
vi.mock('@tiptap/extension-link', () => ({ default: { configure: () => ({}) } }))
vi.mock('@tiptap/extension-underline', () => ({ default: {} }))

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
    React.createElement(
      createWrapper(),
      null,
      React.createElement(AddNoteDrawer, merged),
    ),
  )
}

function setEditorContent(text: string) {
  mockEditorText = text
  latestOnUpdate?.({ editor: mockEditor })
}

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

  it('renders Add Note title and required fields', () => {
    renderDrawer()
    expect(screen.getByText('Add Note')).toBeInTheDocument()
    expect(screen.getByTestId('channel-select')).toBeInTheDocument()
    expect(screen.getByTestId('topic-select')).toBeInTheDocument()
  })

  it('shows amendment mode title/banner and prefills channel/topic', () => {
    renderDrawer({
      amendingNote: {
        id: 'note-1',
        channel: 'phone',
        topic: 'complaint',
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
    })
    expect(screen.getByText('Amend Note')).toBeInTheDocument()
    expect(screen.getByTestId('amend-warning-banner')).toBeInTheDocument()
    expect((screen.getByTestId('channel-select') as HTMLSelectElement).value).toBe('phone')
    expect((screen.getByTestId('topic-select') as HTMLSelectElement).value).toBe('complaint')
  })

  it('shows channel validation error when channel missing', async () => {
    renderDrawer()
    fireEvent.click(screen.getByTestId('add-note-submit-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('channel-error')).toHaveTextContent('Please select a channel')
    })
  })

  it('shows topic validation error when topic missing', async () => {
    renderDrawer()
    fireEvent.change(screen.getByTestId('channel-select'), { target: { value: 'internal' } })
    fireEvent.click(screen.getByTestId('add-note-submit-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('topic-error')).toBeInTheDocument()
    })
  })

  it('shows direction only for phone/email/sms channels', () => {
    renderDrawer()
    expect(screen.queryByTestId('direction-field')).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('channel-select'), { target: { value: 'phone' } })
    expect(screen.getByTestId('direction-field')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('channel-select'), { target: { value: 'internal' } })
    expect(screen.queryByTestId('direction-field')).not.toBeInTheDocument()
  })

  it('submits create payload with channel/topic/content', async () => {
    renderDrawer()
    fireEvent.change(screen.getByTestId('channel-select'), { target: { value: 'phone' } })
    fireEvent.change(screen.getByTestId('topic-select'), { target: { value: 'complaint' } })
    fireEvent.change(screen.getByTestId('contact-direction-select'), { target: { value: 'inbound' } })
    fireEvent.change(screen.getByTestId('subject-input'), { target: { value: 'Test subject' } })
    setEditorContent('Body')
    await act(async () => {
      fireEvent.click(screen.getByTestId('add-note-submit-btn'))
    })
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1))
    const call = mockMutateAsync.mock.calls[0][0]
    expect(call.channel).toBe('phone')
    expect(call.topic).toBe('complaint')
    expect(call.contactDirection).toBe('inbound')
    expect(call.content).toMatchObject({ type: 'doc' })
  })

  it('uses amendment mutation when amending note is provided', async () => {
    renderDrawer({
      amendingNote: {
        id: 'note-original-1',
        channel: 'internal',
        topic: 'internal_note',
        subject: 'Original',
        content: 'Original content',
        priority: 'normal',
        sentiment: 'neutral',
        status: 'active',
        customer: 'cust-123',
        createdBy: 'user-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    })
    fireEvent.change(screen.getByTestId('channel-select'), { target: { value: 'internal' } })
    fireEvent.change(screen.getByTestId('topic-select'), { target: { value: 'internal_note' } })
    fireEvent.change(screen.getByTestId('subject-input'), { target: { value: 'Updated' } })
    setEditorContent('Body')
    await act(async () => {
      fireEvent.click(screen.getByTestId('add-note-submit-btn'))
    })
    await waitFor(() => expect(mockAmendMutateAsync).toHaveBeenCalledTimes(1))
    const call = mockAmendMutateAsync.mock.calls[0][0]
    expect(call.originalNoteId).toBe('note-original-1')
  })

  it('submits on Cmd+Enter', async () => {
    renderDrawer()
    fireEvent.change(screen.getByTestId('channel-select'), { target: { value: 'internal' } })
    fireEvent.change(screen.getByTestId('topic-select'), { target: { value: 'general_enquiry' } })
    fireEvent.change(screen.getByTestId('subject-input'), { target: { value: 'Quick note' } })
    setEditorContent('Body')
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('add-note-form'), { key: 'Enter', metaKey: true })
    })
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1))
  })
})
