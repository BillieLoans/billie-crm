'use client'

import { Fragment, useMemo } from 'react'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import type { CollectionsCaseRow } from '@/types/collections'
import { sortAccountsForRail } from '@/lib/accountTriage'
import { LoanAccountCard } from './LoanAccountCard'
import styles from './AccountRail.module.css'

export interface AccountRailProps {
  accounts: LoanAccountData[]
  selectedAccountId: string | null
  onSelectAccount: (account: LoanAccountData) => void
  today?: Date
  /** Collections cases for this customer (BTB-197 WS4), matched to rows by accountId === loanAccountId. */
  collectionsCases?: CollectionsCaseRow[]
}

const currencyFormatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

export const AccountRail: React.FC<AccountRailProps> = ({
  accounts,
  selectedAccountId,
  onSelectAccount,
  today,
  collectionsCases = [],
}) => {
  const { active, closed, cancelled } = useMemo(
    () => sortAccountsForRail(accounts, today),
    [accounts, today],
  )
  const groups = [
    { label: 'CLOSED', testId: 'account-rail-closed', accounts: closed },
    // Same neutral divider as CLOSED: the heading says what happened, colour does not.
    { label: 'CANCELLED', testId: 'account-rail-cancelled', accounts: cancelled },
  ]
  const total = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.liveBalance?.totalOutstanding ?? a.balances?.totalOutstanding ?? 0), 0),
    [accounts],
  )
  const caseByAccountId = useMemo(() => {
    const map = new Map<string, CollectionsCaseRow>()
    for (const c of collectionsCases) map.set(c.accountId, c)
    return map
  }, [collectionsCases])

  if (accounts.length === 0) {
    return (
      <div className={styles.rail} data-testid="account-rail">
        <h3 className={styles.title}>Accounts</h3>
        <p className={styles.empty}>No loan accounts found</p>
      </div>
    )
  }

  return (
    <div className={styles.rail} data-testid="account-rail">
      <h3 className={styles.title}>Accounts ({accounts.length})</h3>
      <p className={styles.total}>
        Total outstanding <strong>{currencyFormatter.format(total)}</strong>
      </p>

      {active.map((a) => (
        <LoanAccountCard
          key={a.id}
          account={a}
          isSelected={a.loanAccountId === selectedAccountId}
          onSelect={onSelectAccount}
          today={today}
          collectionsCase={caseByAccountId.get(a.loanAccountId) ?? null}
        />
      ))}

      {groups.map(
        (group) =>
          group.accounts.length > 0 && (
            <Fragment key={group.label}>
              <div className={styles.divider} data-testid={group.testId}>
                <span className={styles.dividerLabel}>{group.label}</span>
              </div>
              {group.accounts.map((a) => (
                <LoanAccountCard
                  key={a.id}
                  account={a}
                  isSelected={a.loanAccountId === selectedAccountId}
                  onSelect={onSelectAccount}
                  today={today}
                  collectionsCase={caseByAccountId.get(a.loanAccountId) ?? null}
                />
              ))}
            </Fragment>
          ),
      )}
    </div>
  )
}
