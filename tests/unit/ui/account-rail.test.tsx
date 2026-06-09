// tests/unit/ui/account-rail.test.tsx
import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AccountRail } from '@/components/ServicingView/AccountRail'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const TODAY = new Date('2026-06-09T12:00:00Z')
const acc = (id: string, o: Partial<LoanAccountData> = {}): LoanAccountData =>
  ({
    id, loanAccountId: id, accountNumber: id, accountStatus: 'active',
    loanTerms: { loanAmount: 0, loanFee: 0, totalPayable: 0, openedDate: null },
    balances: { currentBalance: 0, totalOutstanding: 0, totalPaid: 0 },
    liveBalance: null, lastPayment: { date: null, amount: null },
    repaymentSchedule: { scheduleId: 's', numberOfPayments: 0, paymentFrequency: 'fortnightly', payments: [], createdDate: null },
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...o,
  }) as LoanAccountData

describe('AccountRail', () => {
  afterEach(() => cleanup())

  test('renders the account count header', () => {
    render(<AccountRail accounts={[acc('A'), acc('B')]} selectedAccountId={null} onSelectAccount={vi.fn()} today={TODAY} />)
    expect(screen.getByText('Accounts (2)')).toBeInTheDocument()
  })

  test('shows a Closed divider when closed accounts exist', () => {
    render(<AccountRail accounts={[acc('A'), acc('Z', { accountStatus: 'paid_off' })]} selectedAccountId={null} onSelectAccount={vi.fn()} today={TODAY} />)
    expect(screen.getByText('CLOSED')).toBeInTheDocument()
  })

  test('renders an empty state when there are no accounts', () => {
    render(<AccountRail accounts={[]} selectedAccountId={null} onSelectAccount={vi.fn()} today={TODAY} />)
    expect(screen.getByText(/No loan accounts/i)).toBeInTheDocument()
  })
})
