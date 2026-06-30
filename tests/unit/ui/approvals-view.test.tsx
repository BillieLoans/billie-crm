import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApprovalsView } from '@/components/ApprovalsView'

// Mock the fetch API
const mockFetch = vi.fn()
global.fetch = mockFetch

// ApprovalsView also renders <BlockClearList>, which fetches via
// usePendingBlockClears. These tests cover only the write-off approvals queue,
// so stub the block-clears hook to "no pending requests" — otherwise it shares
// the fetch mock above and renders a duplicate table (duplicate text breaks the
// queries below).
vi.mock('@/hooks/queries/usePendingBlockClears', () => ({
  usePendingBlockClears: () => ({
    data: {
      docs: [],
      totalDocs: 0,
      limit: 20,
      page: 1,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
}))

// Create a fresh QueryClient for each test
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  )
}

// Mock approval data
const mockApprovals = [
  {
    id: 'wo-1',
    requestNumber: 'WO-2025-001',
    loanAccountId: 'loan-123',
    customerId: 'cust-456',
    customerName: 'John Smith',
    accountNumber: 'ACC-789',
    amount: 5000,
    originalBalance: 5000,
    reason: 'hardship',
    notes: 'Customer facing difficulties',
    status: 'pending',
    priority: 'normal',
    requiresSeniorApproval: false,
    requestedAt: '2025-12-10T10:00:00Z',
    requestedByName: 'Jane Doe',
    createdAt: '2025-12-10T10:00:00Z',
    updatedAt: '2025-12-10T10:00:00Z',
  },
  {
    id: 'wo-2',
    requestNumber: 'WO-2025-002',
    loanAccountId: 'loan-456',
    customerId: 'cust-789',
    customerName: 'Alice Brown',
    accountNumber: 'ACC-012',
    amount: 15000,
    originalBalance: 15000,
    reason: 'bankruptcy',
    notes: '',
    status: 'pending',
    priority: 'normal',
    requiresSeniorApproval: true,
    requestedAt: '2025-12-11T09:00:00Z',
    requestedByName: 'Bob Wilson',
    createdAt: '2025-12-11T09:00:00Z',
    updatedAt: '2025-12-11T09:00:00Z',
  },
]

// Standard mock response for approvals with list
const mockSuccessResponse = {
  docs: mockApprovals,
  totalDocs: 2,
  limit: 20,
  page: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
}

// Helper to mock fetch for both count and list queries
function setupMockFetch(listData = mockSuccessResponse) {
  mockFetch.mockImplementation((url: string) => {
    // Count query (has limit=0)
    if (url.includes('limit=0') || url.includes('limit%5D=0')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ totalDocs: listData.totalDocs }),
      })
    }
    // List query
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(listData),
    })
  })
}

describe('ApprovalsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Access Control', () => {
    it('should show access denied for operations role', () => {
      renderWithProviders(<ApprovalsView userRole="operations" />)

      expect(screen.getByTestId('access-denied')).toBeInTheDocument()
      expect(screen.getByText('Access Denied')).toBeInTheDocument()
    })

    it('should show access denied for readonly role', () => {
      renderWithProviders(<ApprovalsView userRole="readonly" />)

      expect(screen.getByTestId('access-denied')).toBeInTheDocument()
    })

    it('should show access denied when no role provided', () => {
      renderWithProviders(<ApprovalsView />)

      expect(screen.getByTestId('access-denied')).toBeInTheDocument()
    })

    it('should render approvals view for admin role', async () => {
      setupMockFetch()

      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByTestId('approvals-view')).toBeInTheDocument()
      })
    })

    it('should render approvals view for supervisor role', async () => {
      setupMockFetch()

      renderWithProviders(<ApprovalsView userRole="supervisor" />)

      await waitFor(() => {
        expect(screen.getByTestId('approvals-view')).toBeInTheDocument()
      })
    })
  })

  describe('Queue Display', () => {
    beforeEach(() => {
      setupMockFetch()
    })

    it('should display approval requests in table', async () => {
      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByTestId('approvals-table')).toBeInTheDocument()
      })

      // Check first approval
      expect(screen.getByText('John Smith')).toBeInTheDocument()
      expect(screen.getByText('ACC-789')).toBeInTheDocument()
      expect(screen.getByText('$5,000.00')).toBeInTheDocument()
      expect(screen.getByText('Jane Doe')).toBeInTheDocument()

      // Check second approval (high amount)
      expect(screen.getByText('Alice Brown')).toBeInTheDocument()
      expect(screen.getByText('$15,000.00')).toBeInTheDocument()
    })

    it('should show Senior badge for high-amount requests', async () => {
      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByText('⚠️ Senior')).toBeInTheDocument()
      })
    })

    it('should show Normal badge for regular requests', async () => {
      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByText('Normal')).toBeInTheDocument()
      })
    })
  })

  describe('Empty State', () => {
    it('should show empty state when no pending approvals', async () => {
      setupMockFetch({
        docs: [],
        totalDocs: 0,
        limit: 20,
        page: 1,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      })

      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByTestId('approvals-empty')).toBeInTheDocument()
      })

      expect(screen.getByText('No pending approvals')).toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('should show error state when fetch fails', async () => {
      mockFetch.mockImplementation((url: string) => {
        // Count query can succeed
        if (url.includes('limit=0') || url.includes('limit%5D=0')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ totalDocs: 0 }),
          })
        }
        // List query fails
        return Promise.resolve({
          ok: false,
          status: 500,
        })
      })

      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByTestId('approvals-error')).toBeInTheDocument()
      })

      expect(screen.getByText('Retry')).toBeInTheDocument()
    })
  })

  describe('Sorting', () => {
    it('should have sort dropdown with options', async () => {
      setupMockFetch()

      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByTestId('approvals-sort')).toBeInTheDocument()
      })

      const sortSelect = screen.getByTestId('approvals-sort')
      expect(sortSelect).toHaveValue('oldest')

      // Check all options exist
      expect(screen.getByText('Oldest First')).toBeInTheDocument()
      expect(screen.getByText('Newest First')).toBeInTheDocument()
      expect(screen.getByText('Highest Amount')).toBeInTheDocument()
      expect(screen.getByText('Lowest Amount')).toBeInTheDocument()
    })

    it('should refetch when sort changes', async () => {
      setupMockFetch()

      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByTestId('approvals-sort')).toBeInTheDocument()
      })

      const initialCallCount = mockFetch.mock.calls.length

      const sortSelect = screen.getByTestId('approvals-sort')
      fireEvent.change(sortSelect, { target: { value: 'amount-high' } })

      await waitFor(() => {
        expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount)
      })
    })
  })

  describe('Row Interaction', () => {
    it('should open detail drawer when row is clicked', async () => {
      setupMockFetch()

      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByTestId('approvals-table')).toBeInTheDocument()
      })

      // Click on first row
      const firstRow = screen.getByTestId('approval-row-wo-1')
      fireEvent.click(firstRow)

      // Drawer should open with details
      await waitFor(() => {
        expect(screen.getByText('Write-Off Request Details')).toBeInTheDocument()
      })

      expect(screen.getByText('WO-2025-001')).toBeInTheDocument()
      expect(screen.getByText('Customer facing difficulties')).toBeInTheDocument()
    })
  })

  describe('Loading State', () => {
    it('should show loading state while fetching', async () => {
      // Never resolve to keep in loading state
      mockFetch.mockImplementation(() => new Promise(() => {}))

      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByTestId('approvals-loading')).toBeInTheDocument()
      })
    })
  })

  describe('Pagination', () => {
    it('should show pagination when multiple pages exist', async () => {
      setupMockFetch({
        docs: mockApprovals,
        totalDocs: 50,
        limit: 20,
        page: 1,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: false,
      })

      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByText('Page 1 of 3 (50 total requests)')).toBeInTheDocument()
      })

      // Previous should be disabled on first page
      const prevButton = screen.getByText('Previous')
      expect(prevButton).toBeDisabled()

      // Next should be enabled
      const nextButton = screen.getByText('Next')
      expect(nextButton).not.toBeDisabled()
    })

    it('should navigate to next page when Next is clicked', async () => {
      setupMockFetch({
        docs: mockApprovals,
        totalDocs: 50,
        limit: 20,
        page: 1,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: false,
      })

      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByText('Next')).toBeInTheDocument()
      })

      const initialCallCount = mockFetch.mock.calls.length
      const nextButton = screen.getByText('Next')
      fireEvent.click(nextButton)

      // Should trigger a refetch for page 2
      await waitFor(() => {
        expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount)
      })
    })

    it('should not show pagination when only one page', async () => {
      setupMockFetch({
        docs: mockApprovals,
        totalDocs: 2,
        limit: 20,
        page: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      })

      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByTestId('approvals-table')).toBeInTheDocument()
      })

      // Pagination should not be shown
      expect(screen.queryByText('Previous')).not.toBeInTheDocument()
      expect(screen.queryByText('Next')).not.toBeInTheDocument()
    })
  })

  describe('Drawer Behavior', () => {
    it('should close drawer when close button is clicked', async () => {
      setupMockFetch()

      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByTestId('approvals-table')).toBeInTheDocument()
      })

      // Open drawer
      const firstRow = screen.getByTestId('approval-row-wo-1')
      fireEvent.click(firstRow)

      await waitFor(() => {
        expect(screen.getByText('Write-Off Request Details')).toBeInTheDocument()
      })

      // Close drawer - find and click close button (the X button in ContextDrawer)
      const closeButton = screen.getByLabelText(/close/i)
      fireEvent.click(closeButton)

      // Drawer title should no longer be visible
      await waitFor(() => {
        expect(screen.queryByText('Write-Off Request Details')).not.toBeInTheDocument()
      })
    })
  })

  describe('Keyboard Accessibility', () => {
    it('should open drawer when Enter is pressed on a row', async () => {
      setupMockFetch()

      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        expect(screen.getByTestId('approvals-table')).toBeInTheDocument()
      })

      // Press Enter on first row
      const firstRow = screen.getByTestId('approval-row-wo-1')
      fireEvent.keyDown(firstRow, { key: 'Enter', code: 'Enter' })

      await waitFor(() => {
        expect(screen.getByText('Write-Off Request Details')).toBeInTheDocument()
      })
    })

    it('should have aria-label on table', async () => {
      setupMockFetch()

      renderWithProviders(<ApprovalsView userRole="admin" />)

      await waitFor(() => {
        const table = screen.getByTestId('approvals-table')
        expect(table).toHaveAttribute('aria-label', 'Pending write-off approval requests')
      })
    })
  })
})
