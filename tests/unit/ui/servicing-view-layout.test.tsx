// tests/unit/ui/servicing-view-layout.test.tsx
import { describe, test, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const acc = (id: string, o: Partial<LoanAccountData> = {}): LoanAccountData =>
  ({
    id,
    loanAccountId: id,
    accountNumber: id,
    accountStatus: 'active',
    loanTerms: { loanAmount: 0, loanFee: 0, totalPayable: 0, openedDate: null },
    balances: { currentBalance: 0, totalOutstanding: 0, totalPaid: 0 },
    liveBalance: null,
    lastPayment: { date: null, amount: null },
    repaymentSchedule: {
      scheduleId: 's',
      numberOfPayments: 0,
      paymentFrequency: 'fortnightly',
      payments: [],
      createdDate: null,
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...o,
  }) as LoanAccountData

const customer = {
  id: 'doc1',
  customerId: 'CUST-1',
  fullName: 'Jane Doe',
  vulnerableFlag: false,
  loanAccounts: [acc('over', { accountStatus: 'in_arrears' }), acc('paid', { accountStatus: 'paid_off' })],
}

// Mock @payloadcms/ui (same pattern as ClearBlockButton.test) — the real
// package imports a .css file Node's ESM loader cannot handle in jsdom tests.
vi.mock('@payloadcms/ui', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'ops-1', role: 'operations' },
  })),
}))

vi.mock('@/hooks/queries/useCustomer', () => ({
  useCustomer: () => ({ data: customer, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
}))
vi.mock('@/hooks/queries/useFeesCount', () => ({ useFeesCount: () => 0 }))
vi.mock('@/hooks/queries/usePendingWriteOff', () => ({ usePendingWriteOff: () => ({ data: null, isError: false }) }))
vi.mock('@/hooks/useTrackCustomerView', () => ({ useTrackCustomerView: () => {} }))
vi.mock('@/hooks/queries/useAccountAging', () => ({
  useAccountAging: () => ({ dpd: 0, bucket: 'current', isInArrears: false, isFallback: true, isLoading: false }),
}))
// OverviewTab (rendered for the auto-selected account) calls this React Query hook.
vi.mock('@/hooks/queries/useCarryingAmountBreakdown', () => ({
  useCarryingAmountBreakdown: () => ({ breakdown: null }),
}))
vi.mock('@/components/ServicingView/Communications/CommunicationsPanel', () => ({
  CommunicationsPanel: () => <div data-testid="mock-comms" />,
}))
vi.mock('@/components/ServicingView/ApplicationsPanel', () => ({
  ApplicationsPanel: () => <div data-testid="mock-apps" />,
}))

import { ServicingView } from '@/components/ServicingView/ServicingView'

const renderWithClient = (ui: ReactNode) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

afterEach(() => cleanup())

describe('ServicingView cockpit layout', () => {
  test('renders rail, attention strip, detail and context panes', () => {
    renderWithClient(<ServicingView customerId="CUST-1" />)
    expect(screen.getByTestId('account-rail')).toBeInTheDocument()
    expect(screen.getByTestId('attention-strip')).toBeInTheDocument()
    expect(screen.getByTestId('context-pane')).toBeInTheDocument()
  })

  test('auto-selects the top-triaged (in-arrears) account, populating the summary bar', () => {
    renderWithClient(<ServicingView customerId="CUST-1" />)
    const summaryBar = screen.getByTestId('account-summary-bar')
    expect(summaryBar).toBeInTheDocument()
    // The in-arrears account ("over") outranks the paid-off one and is auto-selected;
    // its account number appears in the summary bar. (Scoped because the rail also
    // lists the same account number.)
    expect(within(summaryBar).getByText('over')).toBeInTheDocument()
  })

  test('close button dismisses the detail panel instead of re-selecting an account', () => {
    renderWithClient(<ServicingView customerId="CUST-1" />)
    // Multi-account customer, so the close (deselect) control is shown.
    fireEvent.click(screen.getByTestId('close-account-panel'))
    // The panel should collapse to the empty state — auto-select must NOT
    // immediately re-pick the top-triaged account.
    expect(screen.queryByTestId('account-summary-bar')).not.toBeInTheDocument()
    expect(screen.getByText('Select an account from the list.')).toBeInTheDocument()
  })
})
