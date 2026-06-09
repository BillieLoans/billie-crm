// tests/unit/ui/account-summary-bar.test.tsx
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

vi.mock('@/hooks/queries/useAccountAging', () => ({
  useAccountAging: () => ({ dpd: 0, bucket: 'current', isInArrears: false, isFallback: true, isLoading: false }),
}))

import { AccountSummaryBar } from '@/components/ServicingView/AccountPanel/AccountSummaryBar'

const account = (o: Partial<LoanAccountData> = {}): LoanAccountData =>
  ({
    id: 'a1', loanAccountId: 'e09a63be-9d43-4992-bdf2-216f6f4e5a1e', accountNumber: 'I9NWJ8XVXKJ3',
    accountStatus: 'active',
    loanTerms: { loanAmount: 400, loanFee: 80, totalPayable: 480, openedDate: '2026-03-14' },
    balances: { currentBalance: 160, totalOutstanding: 170, totalPaid: 320 },
    liveBalance: { principalBalance: 160, feeBalance: 10, totalOutstanding: 170, asOf: '2026-06-09T00:00:00Z' },
    lastPayment: { date: '2026-05-23', amount: 80 },
    repaymentSchedule: { scheduleId: 's', numberOfPayments: 6, paymentFrequency: 'fortnightly', payments: [], createdDate: null },
    createdAt: '2026-03-14T00:00:00Z', updatedAt: '2026-06-09T00:00:00Z', ...o,
  }) as LoanAccountData

const handlers = () => ({
  onRecordRepayment: vi.fn(), onWaiveFee: vi.fn(), onApplyLateFee: vi.fn(),
  onApplyDishonourFee: vi.fn(), onRequestWriteOff: vi.fn(), onDisburseLoan: vi.fn(),
  onRefresh: vi.fn(), onClose: vi.fn(),
})

describe('AccountSummaryBar', () => {
  beforeEach(() => { /* read-only store defaults to false */ })
  afterEach(() => cleanup())

  test('shows account number and total outstanding', () => {
    render(<AccountSummaryBar account={account()} hasPendingWriteOff={false} {...handlers()} />)
    expect(screen.getByText('I9NWJ8XVXKJ3')).toBeInTheDocument()
    expect(screen.getByText('$170.00')).toBeInTheDocument()
  })

  test('shows a truncated, copyable loanAccountId', () => {
    render(<AccountSummaryBar account={account()} hasPendingWriteOff={false} {...handlers()} />)
    // truncated form contains the start of the UUID
    expect(screen.getByText(/e09a63be/)).toBeInTheDocument()
  })

  test('record payment is the primary action for a live account and fires its handler', () => {
    const h = handlers()
    render(<AccountSummaryBar account={account()} hasPendingWriteOff={false} {...h} />)
    fireEvent.click(screen.getByRole('button', { name: /record payment/i }))
    expect(h.onRecordRepayment).toHaveBeenCalled()
  })

  test('pending_disbursement shows Disburse loan as primary', () => {
    render(<AccountSummaryBar account={account({ accountStatus: 'pending_disbursement' })} hasPendingWriteOff={false} {...handlers()} />)
    expect(screen.getByRole('button', { name: /disburse loan/i })).toBeInTheDocument()
  })

  test('next payment shows the scheduled instalment amount, not the last payment amount', () => {
    const a = account({
      accountStatus: 'active',
      lastPayment: { date: '2026-05-01', amount: 999 }, // red-herring: should NOT render
      repaymentSchedule: {
        scheduleId: 's', numberOfPayments: 1, paymentFrequency: 'fortnightly', createdDate: null,
        payments: [{ paymentNumber: 1, dueDate: '2026-07-01', amount: 95, status: 'scheduled' }],
      },
    })
    render(<AccountSummaryBar account={a} hasPendingWriteOff={false} {...handlers()} />)
    // $95.00 is the next scheduled instalment; $999.00 must not appear
    expect(screen.getByText('$95.00')).toBeInTheDocument()
    expect(screen.queryByText('$999.00')).not.toBeInTheDocument()
  })
})
