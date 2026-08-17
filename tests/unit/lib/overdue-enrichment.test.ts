import { describe, it, expect } from 'vitest'
import {
  enrichOverdueAccounts,
  indexLoanAccountsById,
  normaliseOverdueAccount,
} from '@/lib/aging/overdue-enrichment'

describe('normaliseOverdueAccount', () => {
  it('maps camelCase fields', () => {
    expect(
      normaliseOverdueAccount({
        accountId: 'acc_1',
        dpd: 12,
        bucket: 'late_arrears',
        daysUntilOverdue: 0,
        totalOverdueAmount: '250.50',
        lastUpdated: '2026-08-17T01:02:03Z',
        isInArrears: true,
      }),
    ).toEqual({
      accountId: 'acc_1',
      dpd: 12,
      bucket: 'late_arrears',
      daysUntilOverdue: 0,
      totalOverdueAmount: '250.50',
      lastUpdated: '2026-08-17T01:02:03Z',
      isInArrears: true,
    })
  })

  it('maps snake_case fields', () => {
    expect(
      normaliseOverdueAccount({
        account_id: 'acc_2',
        dpd: 3,
        bucket: 'early_arrears',
        days_until_overdue: 0,
        total_overdue_amount: '10.00',
        last_updated: '2026-08-16T00:00:00Z',
        is_in_arrears: true,
      }),
    ).toMatchObject({
      accountId: 'acc_2',
      totalOverdueAmount: '10.00',
      lastUpdated: '2026-08-16T00:00:00Z',
      isInArrears: true,
    })
  })

  it('defaults missing fields (isInArrears false for pre-aging-v1.1.0 ledgers)', () => {
    const result = normaliseOverdueAccount({})
    expect(result).toMatchObject({
      accountId: '',
      dpd: 0,
      bucket: 'current',
      daysUntilOverdue: 0,
      totalOverdueAmount: '0',
      isInArrears: false,
    })
    expect(typeof result.lastUpdated).toBe('string')
  })
})

describe('indexLoanAccountsById / enrichOverdueAccounts', () => {
  const accounts = [
    normaliseOverdueAccount({ accountId: 'acc_1' }),
    normaliseOverdueAccount({ accountId: 'acc_2' }),
  ]

  it('attaches loan-account details from a single batched result', () => {
    const index = indexLoanAccountsById([
      {
        loanAccountId: 'acc_1',
        accountNumber: 'LN-001',
        customerIdString: 'cus_1',
        customerName: 'Jane Doe',
      },
    ])

    expect(enrichOverdueAccounts(accounts, index)).toEqual([
      expect.objectContaining({
        accountId: 'acc_1',
        accountNumber: 'LN-001',
        customerIdString: 'cus_1',
        customerName: 'Jane Doe',
      }),
      // no matching loan account -> historical null-filled shape preserved
      expect.objectContaining({
        accountId: 'acc_2',
        accountNumber: null,
        customerIdString: null,
        customerName: null,
      }),
    ])
  })

  it('nulls out missing optional loan-account fields', () => {
    const index = indexLoanAccountsById([{ loanAccountId: 'acc_1', accountNumber: 'LN-001' }])
    const [first] = enrichOverdueAccounts([accounts[0]], index)
    expect(first.customerIdString).toBeNull()
    expect(first.customerName).toBeNull()
  })

  it('ignores docs without a loanAccountId', () => {
    const index = indexLoanAccountsById([
      { accountNumber: 'LN-999' } as any,
      { loanAccountId: null, accountNumber: 'LN-998' } as any,
    ])
    expect(index.size).toBe(0)
  })

  it('returns null-filled rows when no loan accounts were found', () => {
    expect(enrichOverdueAccounts(accounts, new Map())).toEqual([
      expect.objectContaining({ accountNumber: null }),
      expect.objectContaining({ accountNumber: null }),
    ])
  })
})
