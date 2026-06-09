// tests/unit/ui/overview-tab.test.tsx
import { describe, test, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('@/hooks/queries/useCarryingAmountBreakdown', () => ({
  useCarryingAmountBreakdown: () => ({ breakdown: null }),
}))

import { OverviewTab } from '@/components/ServicingView/AccountPanel/OverviewTab'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const account = (): LoanAccountData =>
  ({
    id: 'a1', loanAccountId: 'e09a63be-9d43-4992-bdf2-216f6f4e5a1e', accountNumber: 'I9NWJ8XVXKJ3', accountStatus: 'active',
    loanTerms: { loanAmount: 400, loanFee: 80, totalPayable: 480, openedDate: '2026-03-14' },
    balances: { currentBalance: 160, totalOutstanding: 170, totalPaid: 320 },
    liveBalance: { principalBalance: 160, feeBalance: 10, totalOutstanding: 170, asOf: '2026-06-09T00:00:00Z' },
    lastPayment: { date: '2026-05-23', amount: 80 },
    repaymentSchedule: { scheduleId: 's', numberOfPayments: 6, paymentFrequency: 'fortnightly', payments: [], createdDate: null },
    createdAt: '2026-03-14T00:00:00Z', updatedAt: '2026-06-09T00:00:00Z',
  }) as LoanAccountData

afterEach(() => cleanup())

describe('OverviewTab', () => {
  test('renders balance figures', () => {
    render(<OverviewTab account={account()} />)
    expect(screen.getByText('$170.00')).toBeInTheDocument()
    expect(screen.getByText('$160.00')).toBeInTheDocument()
  })

  test('does NOT render a "Loan Account ID" section (moved to summary bar)', () => {
    render(<OverviewTab account={account()} />)
    expect(screen.queryByText(/Loan Account ID/i)).not.toBeInTheDocument()
  })

  test('renders loan terms', () => {
    render(<OverviewTab account={account()} />)
    expect(screen.getByText('$480.00')).toBeInTheDocument() // total payable
  })
})
