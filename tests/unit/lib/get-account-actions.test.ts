// tests/unit/lib/get-account-actions.test.ts
import { describe, it, expect } from 'vitest'
import { getAccountActions, type AccountActionContext } from '@/lib/getAccountActions'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const baseCtx: AccountActionContext = {
  readOnly: false,
  hasPendingWriteOff: false,
  pendingRepayment: false,
  pendingWaive: false,
}

const account = (overrides: Partial<LoanAccountData> = {}): LoanAccountData =>
  ({
    id: 'a1',
    loanAccountId: 'LOAN-1',
    accountNumber: 'ACC-1',
    accountStatus: 'active',
    loanTerms: { loanAmount: 400, loanFee: 80, totalPayable: 480, openedDate: '2026-03-14' },
    balances: { currentBalance: 160, totalOutstanding: 170, totalPaid: 320 },
    liveBalance: { principalBalance: 160, feeBalance: 10, totalOutstanding: 170, asOf: '2026-06-09T00:00:00Z' },
    lastPayment: { date: '2026-05-23', amount: 80 },
    repaymentSchedule: { scheduleId: 's1', numberOfPayments: 6, paymentFrequency: 'fortnightly', payments: [], createdDate: null },
    createdAt: '2026-03-14T00:00:00Z',
    updatedAt: '2026-06-09T00:00:00Z',
    ...overrides,
  }) as LoanAccountData

const byId = (a: LoanAccountData, ctx: AccountActionContext) =>
  Object.fromEntries(getAccountActions(a, ctx).map((x) => [x.id, x]))

describe('getAccountActions', () => {
  it('live account: record-payment is the enabled primary; waive enabled when fees>0', () => {
    const m = byId(account(), baseCtx)
    expect(m['record-payment'].primary).toBe(true)
    expect(m['record-payment'].enabled).toBe(true)
    expect(m['disburse'].visible).toBe(false)
    expect(m['waive-fee'].enabled).toBe(true)
  })

  it('waive disabled when fees are zero', () => {
    const m = byId(account({ liveBalance: { principalBalance: 160, feeBalance: 0, totalOutstanding: 160, asOf: '2026-06-09T00:00:00Z' } }), baseCtx)
    expect(m['waive-fee'].enabled).toBe(false)
    expect(m['waive-fee'].disabledReason).toBe('No fees to waive')
  })

  it('pending_disbursement: disburse is the enabled primary, all money actions disabled', () => {
    const m = byId(account({ accountStatus: 'pending_disbursement' }), baseCtx)
    expect(m['disburse'].visible).toBe(true)
    expect(m['disburse'].primary).toBe(true)
    expect(m['disburse'].enabled).toBe(true)
    for (const id of ['record-payment', 'waive-fee', 'apply-late-fee', 'apply-dishonour-fee', 'request-write-off'] as const) {
      expect(m[id].enabled).toBe(false)
      expect(m[id].disabledReason).toBe('Available after the loan is disbursed')
    }
  })

  it('read-only disables everything with a read-only reason', () => {
    const m = byId(account(), { ...baseCtx, readOnly: true })
    for (const a of Object.values(m)) {
      if (a.visible) {
        expect(a.enabled).toBe(false)
        expect(a.disabledReason).toBe('Read-only mode')
      }
    }
  })

  it('in-flight repayment/waive disable their buttons', () => {
    const m = byId(account(), { ...baseCtx, pendingRepayment: true, pendingWaive: true })
    expect(m['record-payment'].enabled).toBe(false)
    expect(m['record-payment'].disabledReason).toBe('Payment in progress')
    expect(m['waive-fee'].enabled).toBe(false)
    expect(m['waive-fee'].disabledReason).toBe('Waive in progress')
  })

  it('pending write-off disables the write-off action', () => {
    const m = byId(account(), { ...baseCtx, hasPendingWriteOff: true })
    expect(m['request-write-off'].enabled).toBe(false)
    expect(m['request-write-off'].disabledReason).toBe('Write-off already pending approval')
    expect(m['request-write-off'].danger).toBe(true)
  })
})
