'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useDashboard } from '@/hooks/queries/useDashboard'
import { DisburseLoanDrawer } from '@/components/ServicingView/DisburseLoanDrawer'
import styles from './widgets.module.css'

/**
 * Pending Disbursements Widget
 *
 * Displays the count of loan accounts awaiting disbursement
 * and links to each account's servicing page.
 */
export function PendingDisbursementsWidget() {
  const router = useRouter()
  const { data, isLoading, refetch } = useDashboard()

  const count = data?.pendingDisbursementsCount ?? 0
  const accounts = data?.pendingDisbursements ?? []
  const previewAccounts = accounts.slice(0, 3)
  const [selectedAccount, setSelectedAccount] = React.useState<(typeof accounts)[number] | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false)

  const handleRowClick = (customerId: string, loanAccountId: string) => {
    router.push(`/admin/servicing/${customerId}?accountId=${encodeURIComponent(loanAccountId)}`)
  }

  const handleOpenDisburse = (account: (typeof accounts)[number]) => {
    setSelectedAccount(account)
    setIsDrawerOpen(true)
  }

  const handleCloseDisburse = () => {
    setIsDrawerOpen(false)
    setSelectedAccount(null)
  }

  const handleDisburseSuccess = () => {
    void refetch()
  }

  if (isLoading) {
    return (
      <div className={styles.widget}>
        <div className={styles.widgetHeader}>
          <span className={styles.widgetIcon}>🏦</span>
          <h3 className={styles.widgetTitle}>Pending Disbursements</h3>
        </div>
        <div className={styles.widgetSkeleton} />
      </div>
    )
  }

  return (
    <div className={styles.widget}>
      <div className={styles.widgetHeader}>
        <span className={styles.widgetIcon}>🏦</span>
        <h3 className={styles.widgetTitle}>Pending Disbursements</h3>
      </div>
      <div className={styles.widgetContent}>
        <div className={styles.metricRow}>
          <span className={styles.metricLabel}>Awaiting Disbursement</span>
          <span className={`${styles.metricValue} ${count > 0 ? styles.metricWarning : ''}`}>
            {count}
          </span>
        </div>
        {count > 0 && previewAccounts.length > 0 && (
          <div className={styles.pendingList}>
            {previewAccounts.map((account) => (
              <div
                key={account.loanAccountId}
                className={styles.pendingListItem}
                title={`${account.accountNumber} - ${account.customerName}`}
                onClick={() => handleRowClick(account.customerId, account.loanAccountId)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleRowClick(account.customerId, account.loanAccountId)
                  }
                }}
              >
                <span className={styles.pendingListAccount}>{account.accountNumber}</span>
                <span className={styles.pendingListCustomer}>{account.customerName}</span>
                <span className={styles.pendingListActions}>
                  <span className={styles.pendingListAmount}>{account.loanAmountFormatted}</span>
                  <button
                    type="button"
                    className={styles.disburseIconButton}
                    title="Disburse this loan"
                    aria-label={`Disburse loan ${account.accountNumber}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenDisburse(account)
                    }}
                  >
                    🏦
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        {count > 0 && (
          <Link
            href="/admin/pending-disbursements"
            className={styles.widgetLink}
          >
            Open disbursement queue →
          </Link>
        )}
        {count === 0 && (
          <div className={styles.widgetSuccess}>
            <span>✅</span>
            <span>All loans disbursed</span>
          </div>
        )}
      </div>
      {selectedAccount && (
        <DisburseLoanDrawer
          isOpen={isDrawerOpen}
          onClose={handleCloseDisburse}
          onSuccess={handleDisburseSuccess}
          loanAccountId={selectedAccount.loanAccountId}
          accountNumber={selectedAccount.accountNumber}
          loanAmount={selectedAccount.loanAmount}
          signedLoanAgreementUrl={selectedAccount.signedLoanAgreementUrl}
        />
      )}
    </div>
  )
}
