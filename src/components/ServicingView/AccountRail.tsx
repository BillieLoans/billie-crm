'use client'

import { useMemo } from 'react'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { sortAccountsForRail } from '@/lib/accountTriage'
import { LoanAccountCard } from './LoanAccountCard'
import styles from './AccountRail.module.css'

export interface AccountRailProps {
  accounts: LoanAccountData[]
  selectedAccountId: string | null
  onSelectAccount: (account: LoanAccountData) => void
  today?: Date
}

const currencyFormatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

export const AccountRail: React.FC<AccountRailProps> = ({ accounts, selectedAccountId, onSelectAccount, today }) => {
  const { active, closed } = useMemo(() => sortAccountsForRail(accounts, today), [accounts, today])
  const total = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.liveBalance?.totalOutstanding ?? a.balances?.totalOutstanding ?? 0), 0),
    [accounts],
  )

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
        <LoanAccountCard key={a.id} account={a} isSelected={a.loanAccountId === selectedAccountId} onSelect={onSelectAccount} today={today} />
      ))}

      {closed.length > 0 && (
        <>
          <div className={styles.divider}>
            <span className={styles.dividerLabel}>CLOSED</span>
          </div>
          {closed.map((a) => (
            <LoanAccountCard key={a.id} account={a} isSelected={a.loanAccountId === selectedAccountId} onSelect={onSelectAccount} today={today} />
          ))}
        </>
      )}
    </div>
  )
}
