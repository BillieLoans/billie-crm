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
import { WaiveFeeDrawer } from './WaiveFeeDrawer'
import { RecordRepaymentDrawer } from './RecordRepaymentDrawer'
import { BulkWaiveFeeDrawer } from './BulkWaiveFeeDrawer'
import { WriteOffRequestDrawer } from './WriteOffRequestDrawer'
import { DisburseLoanDrawer } from './DisburseLoanDrawer'
import { ApplyFeeDrawer, type FeeType } from './ApplyFeeDrawer'
import { AccountPanel, type TabId } from './AccountPanel'
import type { SelectedFee } from './FeeList'
import { AccountRail } from './AccountRail'
import { AttentionStrip } from './AttentionStrip'
import { ContextPane } from './ContextPane'
import { getAttentionItems, sortAccountsForRail } from '@/lib/accountTriage'
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

  // Context pane toggle for mid-width screens (1101–1440px)
  const [contextOpen, setContextOpen] = useState(false)

  // Action drawer states
  const [waiveFeeOpen, setWaiveFeeOpen] = useState(false)
  const [recordRepaymentOpen, setRecordRepaymentOpen] = useState(false)
  const [bulkWaiveOpen, setBulkWaiveOpen] = useState(false)
  const [selectedFees, setSelectedFees] = useState<SelectedFee[]>([])
  const [writeOffOpen, setWriteOffOpen] = useState(false)
  const [disburseLoanOpen, setDisburseLoanOpen] = useState(false)
  const [applyFeeOpen, setApplyFeeOpen] = useState(false)
  const [applyFeeType, setApplyFeeType] = useState<FeeType>('late-fee')

  // Derive accounts and selected account
  const accounts = useMemo(() => customer?.loanAccounts ?? [], [customer?.loanAccounts])
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

  // Customer-level attention chips (vulnerable, overdue, pending disbursement, write-off pending)
  const attentionItems = useMemo(
    () =>
      getAttentionItems({
        vulnerable: customer?.vulnerableFlag ?? false,
        accounts,
        // NOTE: pending-write-off detection is intentionally scoped to the SELECTED account because
        // `usePendingWriteOff` is a per-account query and the design avoids firing extra fetches for
        // every account on the rail. A customer-level pending-write-off query would be a follow-up.
        pendingWriteOffAccountIds: selectedAccountId && hasPendingWriteOff ? [selectedAccountId] : [],
      }),
    [customer?.vulnerableFlag, accounts, selectedAccountId, hasPendingWriteOff]
  )

  // Auto-select top-triaged account or account from URL query parameter
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

    // Auto-select the top-triaged account (in-arrears first, then pending,
    // then active; falling back to the most recently closed) when nothing
    // is selected and no ?accountId= param applied above.
    if (!selectedAccountId && accounts.length > 0) {
      const { active, closed } = sortAccountsForRail(accounts)
      const top = active[0] ?? closed[0]
      if (top) setSelectedAccountId(top.loanAccountId)
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

  const handleOpenDisburseLoan = useCallback(() => {
    setDisburseLoanOpen(true)
  }, [])

  const handleCloseDisburseLoan = useCallback(() => {
    setDisburseLoanOpen(false)
  }, [])

  const handleOpenApplyLateFee = useCallback(() => {
    setApplyFeeType('late-fee')
    setApplyFeeOpen(true)
  }, [])

  const handleOpenApplyDishonourFee = useCallback(() => {
    setApplyFeeType('dishonour-fee')
    setApplyFeeOpen(true)
  }, [])

  const handleCloseApplyFee = useCallback(() => {
    setApplyFeeOpen(false)
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

      {/* Customer-level attention chips (replaces the vulnerable banner) */}
      <AttentionStrip items={attentionItems} onSelectAccount={handleSwitchAccount} />

      {/* Three-pane cockpit: triaged rail · account work-surface · customer context */}
      <div className={styles.cockpit}>
        <div className={styles.railCol}>
          <AccountRail
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            onSelectAccount={handleSelectAccount}
          />
        </div>

        <div className={styles.detailCol}>
          <button
            type="button"
            className={styles.contextToggle}
            onClick={() => setContextOpen((v) => !v)}
            data-testid="context-toggle"
          >
            {contextOpen ? 'Hide context' : 'Show context'}
          </button>
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
              onApplyLateFee={handleOpenApplyLateFee}
              onApplyDishonourFee={handleOpenApplyDishonourFee}
              onBulkWaive={handleBulkWaive}
              feesCount={feesCount}
              onRefresh={handleRefresh}
              isRefreshing={isFetchingData}
              onRequestWriteOff={handleOpenWriteOff}
              hasPendingWriteOff={hasPendingWriteOff}
              onDisburseLoan={handleOpenDisburseLoan}
            />
          ) : (
            <div className={styles.detailEmpty}>Select an account from the list.</div>
          )}
        </div>

        <div className={`${styles.contextCol}${contextOpen ? ` ${styles.contextOpen}` : ''}`}>
          {/* Tabbed context: Communications (contact notes + notification history) and
              Applications (loan origination conversations). customer.id is the Payload
              document ID for note queries; customerId (route param) is the business key. */}
          <ContextPane
            customerDocId={customer?.id ?? ''}
            customerBusinessId={customerId}
            customerName={customer?.fullName ?? undefined}
            selectedAccountId={selectedAccountId}
            accounts={accounts}
            onNavigateToAccount={handleSwitchAccount}
          />
        </div>
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

      {/* Apply Fee Drawer - overlay */}
      {selectedAccount && (
        <ApplyFeeDrawer
          isOpen={applyFeeOpen}
          onClose={handleCloseApplyFee}
          loanAccountId={selectedAccount.loanAccountId}
          feeType={applyFeeType}
        />
      )}

      {/* Disburse Loan Drawer - overlay */}
      {selectedAccount && (
        <DisburseLoanDrawer
          isOpen={disburseLoanOpen}
          onClose={handleCloseDisburseLoan}
          loanAccountId={selectedAccount.loanAccountId}
          accountNumber={selectedAccount.accountNumber}
          loanAmount={selectedAccount.loanTerms?.loanAmount ?? 0}
          signedLoanAgreementUrl={selectedAccount.signedLoanAgreementUrl}
        />
      )}
    </div>
  )
}

// Default export for Payload import map
export default ServicingView
