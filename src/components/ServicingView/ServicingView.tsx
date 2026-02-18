'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useCustomer, type LoanAccountData } from '@/hooks/queries/useCustomer'
import { transactionsQueryKey } from '@/hooks/queries/useTransactions'
import { useFeesCount } from '@/hooks/queries/useFeesCount'
import { accruedYieldQueryKey, accrualHistoryQueryKey } from '@/hooks/queries/useAccruedYield'
import { eclAllowanceQueryKey } from '@/hooks/queries/useECLAllowance'
import { CustomerHeader } from './CustomerHeader'
import { CustomerHeaderSkeleton } from './CustomerHeaderSkeleton'
import { LoanAccountsSkeleton } from './LoanAccountsSkeleton'
import { TransactionsSkeleton } from './TransactionsSkeleton'
import { VulnerableCustomerBanner } from './VulnerableCustomerBanner'
import { LoanAccountCard } from './LoanAccountCard'
import { WaiveFeeDrawer } from './WaiveFeeDrawer'
import { RecordRepaymentDrawer } from './RecordRepaymentDrawer'
import { BulkWaiveFeeDrawer } from './BulkWaiveFeeDrawer'
import { WriteOffRequestDrawer } from './WriteOffRequestDrawer'
import { RecordDisbursementDrawer } from './RecordDisbursementDrawer'
import { AccountPanel, type TabId } from './AccountPanel'
import type { SelectedFee } from './FeeList'
import { usePendingWriteOff } from '@/hooks/queries/usePendingWriteOff'
import { useTrackCustomerView } from '@/hooks/useTrackCustomerView'
import { Breadcrumb } from '@/components/Breadcrumb'
import styles from './styles.module.css'

export interface ServicingViewProps {
  customerId: string
}

/**
 * Error state component for customer not found.
 */
const CustomerNotFound: React.FC = () => {
  return (
    <div className={styles.errorContainer}>
      <svg
        className={styles.errorIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <h2 className={styles.errorTitle}>Customer not found</h2>
      <p className={styles.errorMessage}>
        The customer you&apos;re looking for doesn&apos;t exist or may have been removed.
      </p>
      <Link href="/admin/dashboard" className={styles.errorLink}>
        ← Back to Dashboard
      </Link>
      <p className={styles.errorHint}>Press ⌘K to search for another customer</p>
    </div>
  )
}

/**
 * Loan Accounts list with live balance display.
 */
interface LoanAccountsListProps {
  accounts: LoanAccountData[]
  selectedAccountId: string | null
  onSelectAccount: (account: LoanAccountData) => void
}

// Hoisted currency formatter
const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

const LoanAccountsList: React.FC<LoanAccountsListProps> = ({
  accounts,
  selectedAccountId,
  onSelectAccount,
}) => {
  // Calculate total across all accounts
  const total = useMemo(() => {
    return accounts.reduce((sum, account) => {
      const outstanding = account.liveBalance
        ? account.liveBalance.totalOutstanding
        : account.balances?.totalOutstanding ?? 0
      return sum + outstanding
    }, 0)
  }, [accounts])

  if (accounts.length === 0) {
    return (
      <div className={styles.accountsSection}>
        <h3 className={styles.sectionTitle}>Loan Accounts</h3>
        <p className={styles.placeholderText}>No loan accounts found</p>
      </div>
    )
  }

  return (
    <div className={styles.accountsSection}>
      <div className={styles.accountsSectionHeader}>
        <h3 className={styles.sectionTitle}>Loan Accounts ({accounts.length})</h3>
        {accounts.length > 1 && (
          <span className={styles.accountsTotal}>
            Total: {currencyFormatter.format(total)}
          </span>
        )}
      </div>
      <div className={styles.accountsList}>
        {accounts.map((account) => (
          <LoanAccountCard
            key={account.id}
            account={account}
            isSelected={account.loanAccountId === selectedAccountId}
            onSelect={onSelectAccount}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Placeholder shown when no account is selected.
 */
const AccountSelectionPrompt: React.FC = () => {
  return (
    <div className={styles.selectionPrompt}>
      <div className={styles.selectionPromptIcon}>👆</div>
      <h3 className={styles.selectionPromptTitle}>Select an Account</h3>
      <p className={styles.selectionPromptText}>
        Click on a loan account above to view details, transactions, and take actions.
      </p>
      <p className={styles.selectionPromptHint}>
        Use <kbd>1</kbd>-<kbd>4</kbd> to switch tabs, <kbd>↑</kbd><kbd>↓</kbd> to navigate accounts
      </p>
    </div>
  )
}

/**
 * ServicingView - Main customer servicing dashboard.
 *
 * Displays customer profile, loan accounts with tabbed detail panel.
 * Uses skeleton loaders while data is being fetched.
 */
export const ServicingView: React.FC<ServicingViewProps> = ({ customerId }) => {
  const queryClient = useQueryClient()
  const { data: customer, isLoading, isError, isFetching: isCustomerFetching, refetch: refetchCustomer } = useCustomer(customerId)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Track this customer view for "Recent Customers" feature
  // Only track after successful customer data load (Task 3.2 requirement)
  useTrackCustomerView(!isLoading && !isError && customer ? customerId : undefined)

  // Account selection and tab state
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  // Action drawer states
  const [waiveFeeOpen, setWaiveFeeOpen] = useState(false)
  const [recordRepaymentOpen, setRecordRepaymentOpen] = useState(false)
  const [bulkWaiveOpen, setBulkWaiveOpen] = useState(false)
  const [selectedFees, setSelectedFees] = useState<SelectedFee[]>([])
  const [writeOffOpen, setWriteOffOpen] = useState(false)
  const [disbursementOpen, setDisbursementOpen] = useState(false)

  // Derive accounts and selected account
  const accounts = customer?.loanAccounts ?? []
  const selectedAccount = useMemo(() => {
    if (!selectedAccountId) return null
    return accounts.find((a) => a.loanAccountId === selectedAccountId) ?? null
  }, [accounts, selectedAccountId])

  // Get fees count for badge
  const feesCount = useFeesCount(selectedAccountId)

  // Check for pending write-off (fail open: allow action if query errors)
  const { data: pendingWriteOff, isError: pendingWriteOffError } = usePendingWriteOff(selectedAccountId)
  // Only block if we have confirmed pending data; allow if error/loading (fail open for UX)
  const hasPendingWriteOff = !pendingWriteOffError && !!pendingWriteOff

  // Auto-select single account or account from URL query parameter
  useEffect(() => {
    if (accounts.length === 0) return

    // Check for account selection in URL query parameter
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      const accountIdParam = urlParams.get('accountId')
      if (accountIdParam) {
        // Find account by loanAccountId
        const account = accounts.find((a) => a.loanAccountId === accountIdParam)
        if (account && !selectedAccountId) {
          setSelectedAccountId(account.loanAccountId)
          // Clean up URL by removing query parameter
          urlParams.delete('accountId')
          const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ''}`
          window.history.replaceState({}, '', newUrl)
          return
        }
      }
    }

    // Auto-select if only one account
    if (accounts.length === 1 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].loanAccountId)
    }
  }, [accounts, selectedAccountId])

  // Account selection handlers
  const handleSelectAccount = useCallback((account: LoanAccountData) => {
    setSelectedAccountId(account.loanAccountId)
    setActiveTab('overview') // Reset to overview on new selection
  }, [])

  const handleClosePanel = useCallback(() => {
    setSelectedAccountId(null)
    setActiveTab('overview')
  }, [])

  const handleSwitchAccount = useCallback((accountId: string) => {
    setSelectedAccountId(accountId)
    setActiveTab('overview') // Reset to overview on switch
  }, [])

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab)
  }, [])

  // Action handlers
  const handleOpenWaiveFee = useCallback(() => {
    setWaiveFeeOpen(true)
  }, [])

  const handleCloseWaiveFee = useCallback(() => {
    setWaiveFeeOpen(false)
  }, [])

  const handleOpenRecordRepayment = useCallback(() => {
    setRecordRepaymentOpen(true)
  }, [])

  const handleCloseRecordRepayment = useCallback(() => {
    setRecordRepaymentOpen(false)
  }, [])

  const handleBulkWaive = useCallback((fees: SelectedFee[]) => {
    setSelectedFees(fees)
    setBulkWaiveOpen(true)
  }, [])

  const handleCloseBulkWaive = useCallback(() => {
    setBulkWaiveOpen(false)
    setSelectedFees([])
  }, [])

  const handleBulkWaiveSuccess = useCallback(() => {
    setSelectedFees([])
  }, [])

  const handleOpenWriteOff = useCallback(() => {
    setWriteOffOpen(true)
  }, [])

  const handleCloseWriteOff = useCallback(() => {
    setWriteOffOpen(false)
  }, [])

  const handleOpenDisbursement = useCallback(() => {
    setDisbursementOpen(true)
  }, [])

  const handleCloseDisbursement = useCallback(() => {
    setDisbursementOpen(false)
  }, [])

  // Refresh handler - invalidates appropriate queries based on active tab
  const handleRefresh = useCallback(async () => {
    if (!selectedAccountId) return

    setIsRefreshing(true)
    try {
      if (activeTab === 'overview' || activeTab === 'actions') {
        // Refresh customer data (includes account balances)
        await refetchCustomer()
      } else if (activeTab === 'transactions' || activeTab === 'fees') {
        // Refresh transactions (fees are derived from transactions)
        await queryClient.invalidateQueries({
          queryKey: transactionsQueryKey(selectedAccountId, {}),
          exact: false,
        })
      } else if (activeTab === 'accruals') {
        // Refresh accruals data (accrued yield and history)
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: accruedYieldQueryKey(selectedAccountId),
            exact: false,
          }),
          queryClient.invalidateQueries({
            queryKey: accrualHistoryQueryKey(selectedAccountId),
            exact: false,
          }),
        ])
      } else if (activeTab === 'ecl') {
        // Refresh ECL allowance data
        await queryClient.invalidateQueries({
          queryKey: eclAllowanceQueryKey(selectedAccountId),
          exact: false,
        })
      }
    } finally {
      setIsRefreshing(false)
    }
  }, [activeTab, selectedAccountId, refetchCustomer, queryClient])

  // Combined refreshing state
  const isFetchingData = isRefreshing || isCustomerFetching

  // Error state
  if (isError) {
    return (
      <div className={styles.container}>
        <CustomerNotFound />
      </div>
    )
  }

  // Loading state with skeletons
  if (isLoading) {
    return (
      <div className={styles.container}>
        {/* Breadcrumb navigation (Story 6.3) */}
        <Breadcrumb
          items={[
            { label: `Customer ${customerId}` },
            { label: 'Loading...' },
          ]}
        />
        <div className={styles.header}>
          <h1 className={styles.headerTitle}>Customer Servicing</h1>
        </div>

        {/* Compact customer header skeleton */}
        <CustomerHeaderSkeleton />

        {/* Full-width content */}
        <div className={styles.content}>
          <LoanAccountsSkeleton />
          <TransactionsSkeleton />
        </div>
      </div>
    )
  }

  // Data loaded
  const isVulnerable = customer?.vulnerableFlag ?? false

  return (
    <div className={styles.container}>
      {/* Breadcrumb navigation (Story 6.3) */}
      <Breadcrumb
        items={[
          { label: `Customer ${customerId}` },
          { label: customer?.fullName || 'Loading...' },
        ]}
      />
      <div className={styles.header}>
        <h1 className={styles.headerTitle}>Customer Servicing</h1>
      </div>

      {/* Compact horizontal customer header */}
      {customer && <CustomerHeader customer={customer} />}

      {/* Vulnerable customer warning banner */}
      {isVulnerable && <VulnerableCustomerBanner />}

      {/* Full-width content - no sidebar */}
      <div className={styles.content}>
        {/* Account cards - always visible */}
        <LoanAccountsList
          accounts={accounts}
          selectedAccountId={selectedAccountId}
          onSelectAccount={handleSelectAccount}
        />

        {/* Account panel - shown when account selected */}
        {selectedAccount ? (
          <AccountPanel
            account={selectedAccount}
            allAccounts={accounts}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            onClose={handleClosePanel}
            onSwitchAccount={handleSwitchAccount}
            onWaiveFee={handleOpenWaiveFee}
            onRecordRepayment={handleOpenRecordRepayment}
            onBulkWaive={handleBulkWaive}
            feesCount={feesCount}
            onRefresh={handleRefresh}
            isRefreshing={isFetchingData}
            onRequestWriteOff={handleOpenWriteOff}
            hasPendingWriteOff={hasPendingWriteOff}
            onTriggerDisbursement={handleOpenDisbursement}
            hasPendingDisbursement={false}
          />
        ) : (
          <AccountSelectionPrompt />
        )}
      </div>

      {/* Waive Fee Drawer - overlay */}
      {selectedAccount && (
        <WaiveFeeDrawer
          isOpen={waiveFeeOpen}
          onClose={handleCloseWaiveFee}
          loanAccountId={selectedAccount.loanAccountId}
          currentFeeBalance={selectedAccount.liveBalance?.feeBalance ?? 0}
        />
      )}

      {/* Record Repayment Drawer - overlay */}
      {selectedAccount && (
        <RecordRepaymentDrawer
          isOpen={recordRepaymentOpen}
          onClose={handleCloseRecordRepayment}
          loanAccountId={selectedAccount.loanAccountId}
          totalOutstanding={
            selectedAccount.liveBalance?.totalOutstanding ??
            selectedAccount.balances?.totalOutstanding ??
            0
          }
        />
      )}

      {/* Bulk Waive Fee Drawer - overlay */}
      {selectedAccount && selectedFees.length > 0 && (
        <BulkWaiveFeeDrawer
          isOpen={bulkWaiveOpen}
          onClose={handleCloseBulkWaive}
          loanAccountId={selectedAccount.loanAccountId}
          selectedFees={selectedFees}
          onSuccess={handleBulkWaiveSuccess}
        />
      )}

      {/* Write-Off Request Drawer - overlay */}
      {selectedAccount && (
        <WriteOffRequestDrawer
          isOpen={writeOffOpen}
          onClose={handleCloseWriteOff}
          loanAccountId={selectedAccount.loanAccountId}
          customerId={customerId}
          customerName={customer?.fullName ?? undefined}
          accountNumber={selectedAccount.accountNumber}
          totalOutstanding={
            selectedAccount.liveBalance?.totalOutstanding ??
            selectedAccount.balances?.totalOutstanding ??
            0
          }
        />
      )}

      {/* Record Disbursement Drawer - overlay (GAP-07) */}
      {selectedAccount && (
        <RecordDisbursementDrawer
          isOpen={disbursementOpen}
          onClose={handleCloseDisbursement}
          loanAccountId={selectedAccount.loanAccountId}
          disbursementAmount={
            selectedAccount.liveBalance?.totalOutstanding ??
            selectedAccount.balances?.totalOutstanding ??
            0
          }
        />
      )}
    </div>
  )
}

// Default export for Payload import map
export default ServicingView
