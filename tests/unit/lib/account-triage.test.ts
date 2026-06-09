// tests/unit/lib/account-triage.test.ts
import { describe, it, expect } from 'vitest'
import {
  getAccountSignal,
  sortAccountsForRail,
  getAttentionItems,
} from '@/lib/accountTriage'
import type { LoanAccountData, ScheduledPayment } from '@/hooks/queries/useCustomer'

const TODAY = new Date('2026-06-09T12:00:00Z')

const pay = (n: number, dueDate: string, status: ScheduledPayment['status']): ScheduledPayment =>
  ({ paymentNumber: n, dueDate, amount: 80, status } as ScheduledPayment)

const acc = (o: Partial<LoanAccountData> & { loanAccountId: string }): LoanAccountData =>
  ({
    id: o.loanAccountId,
    accountNumber: o.loanAccountId,
    accountStatus: 'active',
    loanTerms: { loanAmount: 400, loanFee: 80, totalPayable: 480, openedDate: '2026-03-14' },
    balances: { currentBalance: 0, totalOutstanding: 0, totalPaid: 0 },
    liveBalance: null,
    lastPayment: { date: null, amount: null },
    repaymentSchedule: { scheduleId: 's', numberOfPayments: 6, paymentFrequency: 'fortnightly', payments: [], createdDate: null },
    createdAt: '2026-03-14T00:00:00Z',
    updatedAt: '2026-03-14T00:00:00Z',
    ...o,
  }) as LoanAccountData

describe('getAccountSignal', () => {
  it('paid_off and written_off are closed', () => {
    expect(getAccountSignal(acc({ loanAccountId: 'A', accountStatus: 'paid_off' }), TODAY).tier).toBe('closed')
    expect(getAccountSignal(acc({ loanAccountId: 'B', accountStatus: 'written_off' }), TODAY).tier).toBe('closed')
  })

  it('pending_disbursement is pending', () => {
    expect(getAccountSignal(acc({ loanAccountId: 'C', accountStatus: 'pending_disbursement' }), TODAY).tier).toBe('pending')
  })

  it('active with a past-due unpaid instalment is overdue with daysOverdue', () => {
    const s = getAccountSignal(
      acc({
        loanAccountId: 'D',
        repaymentSchedule: { scheduleId: 's', numberOfPayments: 2, paymentFrequency: 'fortnightly', createdDate: null,
          payments: [pay(1, '2026-06-06', 'scheduled'), pay(2, '2026-06-20', 'scheduled')] },
      }),
      TODAY,
    )
    expect(s.tier).toBe('overdue')
    expect(s.isOverdue).toBe(true)
    expect(s.daysOverdue).toBe(3)
    expect(s.nextDueDate).toBe('2026-06-06')
  })

  it('active fully up-to-date is active with the next future due date', () => {
    const s = getAccountSignal(
      acc({
        loanAccountId: 'E',
        repaymentSchedule: { scheduleId: 's', numberOfPayments: 2, paymentFrequency: 'fortnightly', createdDate: null,
          payments: [pay(1, '2026-05-09', 'paid'), pay(2, '2026-06-20', 'scheduled')] },
      }),
      TODAY,
    )
    expect(s.tier).toBe('active')
    expect(s.daysOverdue).toBe(0)
    expect(s.nextDueDate).toBe('2026-06-20')
  })

  it('in_arrears status is overdue even without schedule rows', () => {
    expect(getAccountSignal(acc({ loanAccountId: 'F', accountStatus: 'in_arrears' }), TODAY).tier).toBe('overdue')
  })
})

describe('sortAccountsForRail', () => {
  it('orders overdue → pending → active and separates closed', () => {
    const accounts = [
      acc({ loanAccountId: 'paid', accountStatus: 'paid_off', updatedAt: '2026-05-02T00:00:00Z' }),
      acc({ loanAccountId: 'pend', accountStatus: 'pending_disbursement' }),
      acc({ loanAccountId: 'live', accountStatus: 'active',
        repaymentSchedule: { scheduleId: 's', numberOfPayments: 1, paymentFrequency: 'fortnightly', createdDate: null, payments: [pay(1, '2026-06-20', 'scheduled')] } }),
      acc({ loanAccountId: 'over', accountStatus: 'active',
        repaymentSchedule: { scheduleId: 's', numberOfPayments: 1, paymentFrequency: 'fortnightly', createdDate: null, payments: [pay(1, '2026-05-28', 'scheduled')] } }),
    ]
    const { active, closed } = sortAccountsForRail(accounts, TODAY)
    expect(active.map((a) => a.loanAccountId)).toEqual(['over', 'pend', 'live'])
    expect(closed.map((a) => a.loanAccountId)).toEqual(['paid'])
  })

  it('orders multiple closed accounts most-recent-first', () => {
    const accounts = [
      acc({ loanAccountId: 'old', accountStatus: 'paid_off', updatedAt: '2026-01-10T00:00:00Z' }),
      acc({ loanAccountId: 'new', accountStatus: 'written_off', updatedAt: '2026-05-30T00:00:00Z' }),
    ]
    const { closed } = sortAccountsForRail(accounts, TODAY)
    expect(closed.map((a) => a.loanAccountId)).toEqual(['new', 'old'])
  })
})

describe('getAttentionItems', () => {
  it('emits vulnerable, overdue and pending chips in order', () => {
    const accounts = [
      acc({ loanAccountId: 'over', repaymentSchedule: { scheduleId: 's', numberOfPayments: 1, paymentFrequency: 'fortnightly', createdDate: null, payments: [pay(1, '2026-05-28', 'scheduled')] } }),
      acc({ loanAccountId: 'pend', accountStatus: 'pending_disbursement' }),
    ]
    const items = getAttentionItems({ vulnerable: true, accounts, today: TODAY })
    expect(items.map((i) => i.kind)).toEqual(['vulnerable', 'overdue', 'pending_disbursement'])
    expect(items[1].accountId).toBe('over')
    expect(items[0].accountId).toBeNull()
  })

  it('returns empty when nothing needs attention', () => {
    const accounts = [acc({ loanAccountId: 'ok', repaymentSchedule: { scheduleId: 's', numberOfPayments: 1, paymentFrequency: 'fortnightly', createdDate: null, payments: [pay(1, '2026-06-20', 'scheduled')] } })]
    expect(getAttentionItems({ vulnerable: false, accounts, today: TODAY })).toEqual([])
  })

  it('emits a writeoff_pending chip targeting the flagged account', () => {
    const accounts = [acc({ loanAccountId: 'wo' }), acc({ loanAccountId: 'other' })]
    const items = getAttentionItems({ vulnerable: false, accounts, pendingWriteOffAccountIds: ['wo'], today: TODAY })
    expect(items.map((i) => i.kind)).toEqual(['writeoff_pending'])
    expect(items[0].accountId).toBe('wo')
    expect(items[0].severity).toBe('medium')
  })
})
