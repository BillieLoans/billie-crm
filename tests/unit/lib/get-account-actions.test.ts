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
  it('live account: record-payment is the enabled primary; waive enabled', () => {
    const m = byId(account(), baseCtx)
    expect(m['record-payment'].primary).toBe(true)
    expect(m['record-payment'].enabled).toBe(true)
    expect(m['disburse'].visible).toBe(false)
    expect(m['waive-fee'].enabled).toBe(true)
  })

  it('waive stays enabled at zero fee balance (retroactive waiver of a paid fee)', () => {
    const m = byId(account({ liveBalance: { principalBalance: 160, feeBalance: 0, totalOutstanding: 160, asOf: '2026-06-09T00:00:00Z' } }), baseCtx)
    expect(m['waive-fee'].enabled).toBe(true)
    expect(m['waive-fee'].disabledReason).toBeNull()
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

// BTB-517: cancel a loan before disbursement.
describe('getAccountActions: cancel before disbursement', () => {
  const MONEY_AND_DISBURSE = [
    'disburse',
    'record-payment',
    'waive-fee',
    'apply-late-fee',
    'apply-dishonour-fee',
    'request-write-off',
  ] as const

  it('cancel-loan visible only for pending_disbursement + supervisor', () => {
    const pending = account({ accountStatus: 'pending_disbursement' })
    for (const role of ['supervisor', 'admin'] as const) {
      const m = byId(pending, { ...baseCtx, role })
      expect(m['cancel-loan'].visible).toBe(true)
      expect(m['cancel-loan'].enabled).toBe(true)
      expect(m['cancel-loan'].danger).toBe(true)
      expect(m['cancel-loan'].primary).toBe(false)
      expect(m['cancel-loan'].label).toBe('Cancel loan')
    }
    for (const role of ['operations', 'readonly', undefined] as const) {
      expect(byId(pending, { ...baseCtx, role })['cancel-loan'].visible).toBe(false)
    }
    for (const status of ['active', 'in_arrears', 'paid_off', 'written_off', 'cancelled'] as const) {
      const m = byId(account({ accountStatus: status }), { ...baseCtx, role: 'supervisor' })
      expect(m['cancel-loan'].visible).toBe(false)
    }
  })

  it('cancel-loan is disabled in read-only mode', () => {
    const m = byId(account({ accountStatus: 'pending_disbursement' }), {
      ...baseCtx,
      role: 'supervisor',
      readOnly: true,
    })
    expect(m['cancel-loan'].visible).toBe(true)
    expect(m['cancel-loan'].enabled).toBe(false)
    expect(m['cancel-loan'].disabledReason).toBe('Read-only mode')
  })

  it('cancelled hides disburse, record-payment, waive-fee, fees, write-off', () => {
    const m = byId(account({ accountStatus: 'cancelled' }), { ...baseCtx, role: 'admin' })
    for (const id of MONEY_AND_DISBURSE) {
      expect(m[id].visible).toBe(false)
    }
    expect(getAccountActions(account({ accountStatus: 'cancelled' }), baseCtx).filter((a) => a.visible)).toEqual([])
  })

  it('a live account keeps every money action visible (cancel changes nothing there)', () => {
    const m = byId(account(), { ...baseCtx, role: 'supervisor' })
    for (const id of ['record-payment', 'waive-fee', 'apply-late-fee', 'apply-dishonour-fee', 'request-write-off'] as const) {
      expect(m[id].visible).toBe(true)
    }
  })
})
