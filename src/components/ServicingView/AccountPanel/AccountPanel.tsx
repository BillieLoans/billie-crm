'use client'

import { useMemo, useCallback, useEffect } from 'react'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import type { SelectedFee } from '../FeeList'
import { AccountHeader } from './AccountHeader'
import { AccountTabs, type TabId } from './AccountTabs'
import { AccountSwitcher } from './AccountSwitcher'
import { OverviewTab } from './OverviewTab'
import { TransactionsTab } from './TransactionsTab'
import { FeesTab } from './FeesTab'
import { AccrualsTab } from './AccrualsTab'
import { ECLTab } from './ECLTab'
import { ActionsTab } from './ActionsTab'
import { useAccountPanelHotkeys } from './useAccountPanelHotkeys'
import { useUIStore } from '@/stores/ui'
import styles from './styles.module.css'

export interface AccountPanelProps {
  account: LoanAccountData
  allAccounts: LoanAccountData[]
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  onClose: () => void
  onSwitchAccount: (accountId: string) => void
  onWaiveFee: () => void
  onRecordRepayment: () => void
  onBulkWaive: (fees: SelectedFee[]) => void
  /** Number of outstanding fees (for tab badge) */
  feesCount?: number
  /** Callback to refresh data for current tab */
  onRefresh?: () => void
  /** Whether data is currently being refreshed */
  isRefreshing?: boolean
  /** Callback to open write-off request form */
  onRequestWriteOff?: () => void
  /** Whether there's a pending write-off for this account */
  hasPendingWriteOff?: boolean
  /** Callback to trigger disbursement (GAP-07) */
  onTriggerDisbursement?: () => void
  /** Whether a disbursement is currently being processed */
  hasPendingDisbursement?: boolean
}

/**
 * AccountPanel - Main container for account details with tabbed navigation.
 * Replaces the drawer-based approach with an inline panel.
 *
 * Keyboard shortcuts:
 * - 1-6: Switch tabs (Overview, Transactions, Fees, Actions)
 * - ↑/↓: Navigate between accounts
 * - Escape: Close panel
 */
export const AccountPanel: React.FC<AccountPanelProps> = ({
  account,
  allAccounts,
  activeTab,
  onTabChange,
  onClose,
  onSwitchAccount,
  onWaiveFee,
  onRecordRepayment,
  onBulkWaive,
  feesCount,
  onRefresh,
  isRefreshing,
  onRequestWriteOff,
  hasPendingWriteOff,
  onTriggerDisbursement,
  hasPendingDisbursement,
}) => {
  // Other accounts for switcher (exclude current)
  const otherAccounts = useMemo(
    () => allAccounts.filter((a) => a.loanAccountId !== account.loanAccountId),
    [allAccounts, account.loanAccountId]
  )

  // Account IDs for keyboard navigation
  const accountIds = useMemo(
    () => allAccounts.map((a) => a.loanAccountId),
    [allAccounts]
  )

  // Show close button only if there are multiple accounts
  const showClose = allAccounts.length > 1

  // UI store for navigation context
  const setTransactionNavigationSource = useUIStore((s) => s.setTransactionNavigationSource)

  // Clear navigation source when leaving transactions tab (unless going back to overview)
  useEffect(() => {
    // When tab changes away from transactions, clear the navigation source
    // (The back button handler sets expandedPaymentNumber before clearing)
    if (activeTab !== 'transactions') {
      // Small delay to allow back navigation to complete first
      const timer = setTimeout(() => {
        setTransactionNavigationSource(null)
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [activeTab, setTransactionNavigationSource])

  // Keyboard shortcuts
  useAccountPanelHotkeys({
    activeTab,
    onTabChange,
    accountIds,
    selectedAccountId: account.loanAccountId,
    onSwitchAccount,
    onClose,
    isActive: true,
  })

  // Handler for navigating from payment details to a transaction
  const handleNavigateToTransaction = useCallback(
    (_transactionId: string) => {
      // Switch to transactions tab - the TransactionsTab will read
      // the highlighted transaction ID from the UI store
      onTabChange('transactions')
    },
    [onTabChange]
  )

  // Render active tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <OverviewTab 
            account={account} 
            onNavigateToTransaction={handleNavigateToTransaction}
          />
        )
      case 'transactions':
        return (
          <TransactionsTab 
            loanAccountId={account.loanAccountId}
            onNavigateBack={() => onTabChange('overview')}
          />
        )
      case 'fees':
        return <FeesTab loanAccountId={account.loanAccountId} onBulkWaive={onBulkWaive} />
      case 'accruals':
        return <AccrualsTab loanAccountId={account.loanAccountId} accountNumber={account.accountNumber} />
      case 'ecl':
        return <ECLTab loanAccountId={account.loanAccountId} />
      case 'actions':
        return (
          <ActionsTab
            account={account}
            onRecordRepayment={onRecordRepayment}
            onWaiveFee={onWaiveFee}
            onRequestWriteOff={onRequestWriteOff}
            hasPendingWriteOff={hasPendingWriteOff}
            onTriggerDisbursement={onTriggerDisbursement}
            hasPendingDisbursement={hasPendingDisbursement}
          />
        )
      default:
        return <OverviewTab account={account} />
    }
  }

  return (
    <div className={styles.accountPanel} data-testid="account-panel">
      <AccountHeader
        account={account}
        onClose={onClose}
        showClose={showClose}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        hasPendingWriteOff={hasPendingWriteOff}
      />
      <AccountTabs
        activeTab={activeTab}
        onTabChange={onTabChange}
        feesCount={feesCount}
        showKeyboardHints={allAccounts.length > 0}
      />
      <div className={styles.accountPanelContent}>{renderTabContent()}</div>
      {otherAccounts.length > 0 && (
        <AccountSwitcher accounts={otherAccounts} onSelect={onSwitchAccount} />
      )}
    </div>
  )
}
