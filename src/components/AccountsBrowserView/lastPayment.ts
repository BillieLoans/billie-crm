import type { LoanAccount } from '@/payload-types'

/**
 * Derive an account's most recent payment from either:
 *   1. The denormalized `lastPayment.date` field (populated by the event
 *      processor on `account.updated.v1`), or
 *   2. The latest `paid` / `partial` entry in `repaymentSchedule.payments`
 *      when (1) is absent — accounts that received transactions but no
 *      `account.updated.v1` event still have schedule rows we can use.
 *
 * Returns `null` when no payment has occurred.
 */
export function deriveLastPayment(
  account: Pick<LoanAccount, 'lastPayment' | 'repaymentSchedule'>,
): { date: string; amount: number } | null {
  if (account.lastPayment?.date) {
    return {
      date: account.lastPayment.date,
      amount: typeof account.lastPayment.amount === 'number' ? account.lastPayment.amount : 0,
    }
  }

  const payments = account.repaymentSchedule?.payments
  if (!payments || payments.length === 0) return null

  let best: { date: string; amount: number } | null = null
  for (const p of payments) {
    if ((p.status === 'paid' || p.status === 'partial') && p.paidDate) {
      if (!best || p.paidDate > best.date) {
        best = {
          date: p.paidDate,
          amount: typeof p.amountPaid === 'number' ? p.amountPaid : 0,
        }
      }
    }
  }
  return best
}

/**
 * Schedule progress: how many payments are paid vs total. Returns `null` when
 * no schedule is present.
 */
export function deriveScheduleProgress(
  account: Pick<LoanAccount, 'repaymentSchedule'>,
): { paid: number; total: number; nextDue?: { dueDate: string; amount: number } } | null {
  const payments = account.repaymentSchedule?.payments
  if (!payments || payments.length === 0) return null
  const total = payments.length
  let paid = 0
  let nextDue: { dueDate: string; amount: number } | undefined
  for (const p of payments) {
    if (p.status === 'paid') paid += 1
    if (!nextDue && p.status === 'scheduled' && p.dueDate) {
      nextDue = {
        dueDate: p.dueDate,
        amount: typeof p.amount === 'number' ? p.amount : 0,
      }
    }
  }
  return { paid, total, nextDue }
}
