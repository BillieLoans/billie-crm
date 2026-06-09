// tests/unit/ui/actions-tab.test.tsx
import { describe, test, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ActionsTab } from '@/components/ServicingView/AccountPanel/ActionsTab'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const account = (o: Partial<LoanAccountData> = {}): LoanAccountData =>
  ({
    id: 'a1', loanAccountId: 'LOAN-1', accountNumber: 'ACC-1', accountStatus: 'active',
    loanTerms: { loanAmount: 400, loanFee: 80, totalPayable: 480, openedDate: '2026-03-14' },
    balances: { currentBalance: 160, totalOutstanding: 170, totalPaid: 320 },
    liveBalance: { principalBalance: 160, feeBalance: 10, totalOutstanding: 170, asOf: '2026-06-09T00:00:00Z' },
    lastPayment: { date: null, amount: null },
    repaymentSchedule: { scheduleId: 's', numberOfPayments: 6, paymentFrequency: 'fortnightly', payments: [], createdDate: null },
    createdAt: '2026-03-14T00:00:00Z', updatedAt: '2026-06-09T00:00:00Z', ...o,
  }) as LoanAccountData

const h = () => ({
  onRecordRepayment: vi.fn(), onWaiveFee: vi.fn(), onApplyLateFee: vi.fn(),
  onApplyDishonourFee: vi.fn(), onRequestWriteOff: vi.fn(), onDisburseLoan: vi.fn(),
})

afterEach(() => cleanup())

describe('ActionsTab', () => {
  test('live account: record-payment enabled, no disburse card', () => {
    render(<ActionsTab account={account()} hasPendingWriteOff={false} {...h()} />)
    expect(screen.getByTestId('action-record-repayment')).toBeEnabled()
    expect(screen.queryByTestId('action-disburse-loan')).not.toBeInTheDocument()
  })

  test('pending_disbursement: disburse present, record-payment disabled', () => {
    render(<ActionsTab account={account({ accountStatus: 'pending_disbursement' })} hasPendingWriteOff={false} {...h()} />)
    expect(screen.getByTestId('action-disburse-loan')).toBeEnabled()
    expect(screen.getByTestId('action-record-repayment')).toBeDisabled()
  })
})
