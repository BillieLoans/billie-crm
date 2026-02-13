'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DisburseLoanDrawer } from '@/components/ServicingView/DisburseLoanDrawer'
import styles from './styles.module.css'

interface PendingDisbursementItem {
  loanAccountId: string
  accountNumber: string
  customerId: string
  customerName: string
  loanAmount: number
  loanAmountFormatted: string
  totalOutstanding: number
  totalOutstandingFormatted: string
  createdAt: string
}

interface PendingDisbursementResponse {
  totalCount: number
  items: PendingDisbursementItem[]
}

function formatDate(value: string): string {
  const date = new Date(value)
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function PendingDisbursementsView() {
  const router = useRouter()
  const [items, setItems] = useState<PendingDisbursementItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedItem, setSelectedItem] = useState<PendingDisbursementItem | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const fetchPendingDisbursements = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/pending-disbursements?limit=100')
      const data = (await res.json()) as PendingDisbursementResponse

      if (!res.ok) {
        throw new Error((data as unknown as { error?: { message?: string } }).error?.message || 'Failed to fetch pending disbursements')
      }

      setItems(data.items || [])
      setTotalCount(data.totalCount || 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pending disbursements')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchPendingDisbursements()
  }, [fetchPendingDisbursements])

  const handleOpenDisburse = useCallback((item: PendingDisbursementItem) => {
    setSelectedItem(item)
    setIsDrawerOpen(true)
  }, [])

  const handleCloseDisburse = useCallback(() => {
    setIsDrawerOpen(false)
    setSelectedItem(null)
  }, [])

  const handleDisburseSuccess = useCallback(() => {
    void fetchPendingDisbursements()
  }, [fetchPendingDisbursements])

  const headerSubtitle = useMemo(() => {
    if (isLoading) return 'Loading...'
    if (totalCount === 0) return 'No loans awaiting disbursement'
    return `${totalCount} loan${totalCount !== 1 ? 's' : ''} awaiting disbursement`
  }, [isLoading, totalCount])

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Pending Disbursements</h1>
          <p className={styles.subtitle}>{headerSubtitle}</p>
        </div>
        <button className={styles.refreshButton} onClick={() => void fetchPendingDisbursements()}>
          Refresh
        </button>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      <div className={styles.tableWrapper}>
        {isLoading ? (
          <div className={styles.loading}>Loading pending disbursements...</div>
        ) : items.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>✅</span>
            <h3>No pending disbursements</h3>
            <p>All loans have been disbursed.</p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Account</th>
                <th>Customer</th>
                <th>Loan Amount</th>
                <th>Outstanding</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.loanAccountId}>
                  <td>{item.accountNumber}</td>
                  <td>{item.customerName}</td>
                  <td>{item.loanAmountFormatted}</td>
                  <td>{item.totalOutstandingFormatted}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        className={styles.disburseButton}
                        onClick={() => handleOpenDisburse(item)}
                      >
                        Disburse Loan
                      </button>
                      <button
                        className={styles.viewButton}
                        onClick={() =>
                          router.push(
                            `/admin/servicing/${item.customerId}?accountId=${encodeURIComponent(item.loanAccountId)}`,
                          )
                        }
                      >
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedItem && (
        <DisburseLoanDrawer
          isOpen={isDrawerOpen}
          onClose={handleCloseDisburse}
          onSuccess={handleDisburseSuccess}
          loanAccountId={selectedItem.loanAccountId}
          accountNumber={selectedItem.accountNumber}
          loanAmount={selectedItem.loanAmount}
        />
      )}
    </div>
  )
}
