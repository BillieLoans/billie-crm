import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TransactionHistory } from '@/components/ServicingView/TransactionHistory'

// Mock useTransactions hook
vi.mock('@/hooks/queries/useTransactions', async () => {
  const actual = await vi.importActual('@/hooks/queries/useTransactions')
  return {
    ...actual,
    useTransactions: vi.fn(() => ({
      data: null,
      isLoading: false,
      isError: false,
      isFetching: false,
    })),
  }
})

import { useTransactions } from '@/hooks/queries/useTransactions'
const mockedUseTransactions = vi.mocked(useTransactions)

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const mockTransactions = [
  {
    transactionId: 'tx-1',
    loanAccountId: 'LOAN-001',
    type: 'REPAYMENT',
    typeLabel: 'Repayment',
    transactionDate: '2024-06-15T10:00:00Z',
    effectiveDate: '2024-06-15T10:00:00Z',
    principalDelta: '-100',
    feeDelta: '-10',
    totalDelta: '-110',
    principalAfter: '900',
    feeAfter: '90',
    totalAfter: '990',
    description: 'Direct debit repayment',
    referenceType: 'DD',
    referenceId: 'REF-123',
    createdBy: 'system',
    createdAt: '2024-06-15T10:00:00Z',
  },
  {
    transactionId: 'tx-2',
    loanAccountId: 'LOAN-001',
    type: 'LATE_FEE',
    typeLabel: 'Late Fee',
    transactionDate: '2024-06-20T10:00:00Z',
    effectiveDate: '2024-06-20T10:00:00Z',
    principalDelta: '0',
    feeDelta: '25',
    totalDelta: '25',
    principalAfter: '900',
    feeAfter: '115',
    totalAfter: '1015',
    description: 'Late payment fee',
    referenceType: '',
    referenceId: '',
    createdBy: 'system',
    createdAt: '2024-06-20T10:00:00Z',
  },
]

describe('TransactionHistory component', () => {
  beforeEach(() => {
    mockedUseTransactions.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      isFetching: false,
    } as unknown as ReturnType<typeof useTransactions>)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  test('shows placeholder when no loanAccountId', () => {
    render(<TransactionHistory loanAccountId={null} />, { wrapper: createWrapper() })
    expect(screen.getByText('Select a loan account to view transactions')).toBeInTheDocument()
  })

  test('renders section title', () => {
    render(<TransactionHistory loanAccountId="LOAN-001" />, { wrapper: createWrapper() })
    expect(screen.getByText(/Transaction History/)).toBeInTheDocument()
  })

  test('shows loading state', () => {
    mockedUseTransactions.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
      isFetching: true,
    } as unknown as ReturnType<typeof useTransactions>)

    render(<TransactionHistory loanAccountId="LOAN-001" />, { wrapper: createWrapper() })
    expect(screen.getByText('Loading transactions...')).toBeInTheDocument()
  })

  test('shows empty state when no transactions', () => {
    mockedUseTransactions.mockReturnValue({
      data: { loanAccountId: 'LOAN-001', transactions: [], totalCount: 0 },
      isLoading: false,
      isError: false,
      isFetching: false,
    } as unknown as ReturnType<typeof useTransactions>)

    render(<TransactionHistory loanAccountId="LOAN-001" />, { wrapper: createWrapper() })
    expect(screen.getByText('No transactions found')).toBeInTheDocument()
  })

  test('shows fallback message when ledger unavailable', () => {
    mockedUseTransactions.mockReturnValue({
      data: {
        loanAccountId: 'LOAN-001',
        transactions: [],
        totalCount: 0,
        _fallback: true,
        _message: 'Ledger service unavailable',
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    } as unknown as ReturnType<typeof useTransactions>)

    render(<TransactionHistory loanAccountId="LOAN-001" />, { wrapper: createWrapper() })
    expect(screen.getByText('Ledger service unavailable')).toBeInTheDocument()
  })

  test('renders transactions in table', () => {
    mockedUseTransactions.mockReturnValue({
      data: { loanAccountId: 'LOAN-001', transactions: mockTransactions, totalCount: 2 },
      isLoading: false,
      isError: false,
      isFetching: false,
    } as unknown as ReturnType<typeof useTransactions>)

    render(<TransactionHistory loanAccountId="LOAN-001" />, { wrapper: createWrapper() })
    // Check for transaction badges (appear in both table and cards, so use getAllByText)
    expect(screen.getAllByText('Repayment').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Late Fee').length).toBeGreaterThanOrEqual(1)
  })

  test('has type filter dropdown', () => {
    render(<TransactionHistory loanAccountId="LOAN-001" />, { wrapper: createWrapper() })
    expect(screen.getByLabelText('Filter by transaction type')).toBeInTheDocument()
  })

  test('has date filter inputs', () => {
    render(<TransactionHistory loanAccountId="LOAN-001" />, { wrapper: createWrapper() })
    expect(screen.getByLabelText('From date')).toBeInTheDocument()
    expect(screen.getByLabelText('To date')).toBeInTheDocument()
  })

  test('shows clear button when filters applied', () => {
    render(<TransactionHistory loanAccountId="LOAN-001" />, { wrapper: createWrapper() })
    
    // Initially no clear button
    expect(screen.queryByText('Clear')).not.toBeInTheDocument()
    
    // Apply a filter
    const typeFilter = screen.getByLabelText('Filter by transaction type')
    fireEvent.change(typeFilter, { target: { value: 'REPAYMENT' } })
    
    // Clear button should appear
    expect(screen.getByText('Clear')).toBeInTheDocument()
  })

  test('shows load more button when more transactions available', () => {
    mockedUseTransactions.mockReturnValue({
      data: { loanAccountId: 'LOAN-001', transactions: mockTransactions, totalCount: 50 },
      isLoading: false,
      isError: false,
      isFetching: false,
    } as unknown as ReturnType<typeof useTransactions>)

    render(<TransactionHistory loanAccountId="LOAN-001" />, { wrapper: createWrapper() })
    expect(screen.getByText(/Load more/)).toBeInTheDocument()
  })

  test('has correct test id', () => {
    render(<TransactionHistory loanAccountId="LOAN-001" />, { wrapper: createWrapper() })
    expect(screen.getByTestId('transaction-history')).toBeInTheDocument()
  })
})


/**
 * Operator context (waiver reason, disbursement notes, who recorded it) lives
 * in the ledger metadata and had no home in this view. Each row gets a
 * Disclosure control that reveals it in place.
 */
describe('TransactionHistory — transaction detail disclosure', () => {
  const waiver = {
    transactionId: 'tx-waiver',
    loanAccountId: 'LOAN-001',
    type: 'FEE_WAIVER',
    typeLabel: 'Fee Waiver',
    transactionDate: '2026-09-01T10:00:00Z',
    effectiveDate: '2026-09-01',
    principalDelta: '0',
    feeDelta: '-10',
    totalDelta: '-10',
    principalAfter: '200',
    feeAfter: '0',
    totalAfter: '200',
    description: 'Fee waiver: Goodwill - hardship call',
    referenceType: 'waiver',
    referenceId: 'WAIV-1',
    metadata: { reason: 'Goodwill - hardship call', approved_by: 'k.wallace@billie.loans' },
    createdBy: 'k.wallace@billie.loans',
    createdAt: '2026-09-01T10:00:00Z',
  }

  const disbursement = {
    ...waiver,
    transactionId: 'tx-disbursement',
    type: 'DISBURSEMENT',
    typeLabel: 'Disbursement',
    description: 'Loan disbursement - bank ref: DD-1',
    metadata: { notes: 'Paid after ID recheck', bank_reference: 'DD-1' },
  }

  /** Nothing the operator typed, and no provenance — no control to offer. */
  const bare = {
    ...waiver,
    transactionId: 'tx-bare',
    type: 'REPAYMENT',
    typeLabel: 'Repayment',
    description: '',
    metadata: {},
    createdBy: '',
    createdAt: '',
  }

  const renderWith = (transactions: unknown[]) => {
    mockedUseTransactions.mockReturnValue({
      data: { loanAccountId: 'LOAN-001', transactions, totalCount: transactions.length },
      isLoading: false,
      isError: false,
      isFetching: false,
    } as unknown as ReturnType<typeof useTransactions>)

    render(<TransactionHistory loanAccountId="LOAN-001" />, { wrapper: createWrapper() })
    return within(screen.getByRole('table'))
  }

  test('offers an expand control for a transaction carrying detail', () => {
    const table = renderWith([waiver])
    expect(table.getByRole('button', { name: /show details/i })).toBeInTheDocument()
  })

  test('offers no expand control when there is nothing to show', () => {
    const table = renderWith([bare])
    expect(table.queryByRole('button', { name: /show details/i })).not.toBeInTheDocument()
  })

  test('reveals the operator reason and approver when expanded', () => {
    const table = renderWith([waiver])
    fireEvent.click(table.getByRole('button', { name: /show details/i }))

    expect(table.getByText('Reason')).toBeInTheDocument()
    expect(table.getByText('Goodwill - hardship call')).toBeInTheDocument()
    expect(table.getByText('Approved by')).toBeInTheDocument()
  })

  test('reports expanded state and collapses again', () => {
    const table = renderWith([waiver])
    const toggle = table.getByRole('button', { name: /show details/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    expect(table.getByRole('button', { name: /hide details/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    fireEvent.click(table.getByRole('button', { name: /hide details/i }))
    expect(table.queryByText('Goodwill - hardship call')).not.toBeInTheDocument()
  })

  test('keeps two rows open at once for comparison', () => {
    const table = renderWith([waiver, disbursement])
    const toggles = table.getAllByRole('button', { name: /show details/i })
    fireEvent.click(toggles[0])
    fireEvent.click(table.getAllByRole('button', { name: /show details/i })[0])

    expect(table.getByText('Goodwill - hardship call')).toBeInTheDocument()
    expect(table.getByText('Paid after ID recheck')).toBeInTheDocument()
  })

  test('reveals the same detail on the mobile card', () => {
    mockedUseTransactions.mockReturnValue({
      data: { loanAccountId: 'LOAN-001', transactions: [waiver], totalCount: 1 },
      isLoading: false,
      isError: false,
      isFetching: false,
    } as unknown as ReturnType<typeof useTransactions>)

    render(<TransactionHistory loanAccountId="LOAN-001" />, { wrapper: createWrapper() })
    const card = within(screen.getByTestId('transaction-card'))

    // The card list is `display: none` until the mobile breakpoint, and the
    // CSS module is applied in jsdom — so role queries need `hidden`.
    fireEvent.click(card.getByRole('button', { name: /show details/i, hidden: true }))
    expect(card.getByText('Goodwill - hardship call')).toBeInTheDocument()
  })
})
