'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DisburseLoanDrawer } from '@/components/ServicingView/DisburseLoanDrawer'
import { CutoffCountdown } from '@/components/DashboardView/CutoffCountdown'
import { formatCurrency } from '@/lib/formatters'
import { DisbursementSection, type QueueItem } from './DisbursementSection'
import { EarlyDisburseWarningModal } from './EarlyDisburseWarningModal'
import styles from './styles.module.css'

interface PendingDisbursementResponse {
  totalCount: number
  items: QueueItem[]
}

export function PendingDisbursementsView() {
  const router = useRouter()
  const [items, setItems] = useState<QueueItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [pendingEarly, setPendingEarly] = useState<QueueItem | null>(null)

  const [targetBucket, setTargetBucket] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setTargetBucket(new URLSearchParams(window.location.search).get('bucket'))
    }
  }, [])

  const fetchPendingDisbursements = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/pending-disbursements?limit=200')
      const data = (await res.json()) as PendingDisbursementResponse
      if (!res.ok) {
        throw new Error(
          (data as unknown as { error?: { message?: string } }).error?.message ||
            'Failed to fetch pending disbursements',
        )
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

  const openDrawer = useCallback((item: QueueItem) => {
    setSelectedItem(item)
    setIsDrawerOpen(true)
  }, [])

  const handleDisburse = useCallback(
    (item: QueueItem) => {
      if (item.bucket === 'scheduled') {
        setPendingEarly(item)
        return
      }
      openDrawer(item)
    },
    [openDrawer],
  )

  const handleView = useCallback(
    (item: QueueItem) => {
      router.push(
        `/admin/servicing/${item.customerId}?accountId=${encodeURIComponent(item.loanAccountId)}`,
      )
    },
    [router],
  )

  const handleCloseDrawer = useCallback(() => {
    setIsDrawerOpen(false)
    setSelectedItem(null)
  }, [])

  const handleDisburseSuccess = useCallback(() => {
    void fetchPendingDisbursements()
  }, [fetchPendingDisbursements])

  const byBucket = useCallback(
    (b: QueueItem['bucket']) => items.filter((i) => i.bucket === b),
    [items],
  )
  const subtotal = useCallback(
    (b: QueueItem['bucket']) =>
      formatCurrency(byBucket(b).reduce((s, i) => s + (i.loanAmount || 0), 0)),
    [byBucket],
  )

  useEffect(() => {
    if (isLoading || !targetBucket) return
    const el = document.getElementById(`section-${targetBucket}`)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [isLoading, targetBucket, items])

  const headerSubtitle = useMemo(() => {
    if (isLoading) return 'Loading...'
    if (totalCount === 0) return 'No loans awaiting disbursement'
    const total = formatCurrency(items.reduce((s, i) => s + (i.loanAmount || 0), 0))
    return `${totalCount} loan${totalCount !== 1 ? 's' : ''} awaiting · ${total} total`
  }, [isLoading, totalCount, items])

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Pending Disbursements</h1>
          <p className={styles.subtitle}>{headerSubtitle}</p>
        </div>
        <div className={styles.headerActions}>
          <CutoffCountdown />
          <button className={styles.refreshButton} onClick={() => void fetchPendingDisbursements()}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {isLoading ? (
        <div className={styles.loading}>Loading pending disbursements...</div>
      ) : (
        <div className={styles.sections}>
          <DisbursementSection
            bucket="overdue"
            items={byBucket('overdue')}
            totalFormatted={subtotal('overdue')}
            onDisburse={handleDisburse}
            onView={handleView}
          />
          <DisbursementSection
            bucket="today"
            items={byBucket('today')}
            totalFormatted={subtotal('today')}
            onDisburse={handleDisburse}
            onView={handleView}
          />
          <DisbursementSection
            bucket="scheduled"
            items={byBucket('scheduled')}
            totalFormatted={subtotal('scheduled')}
            defaultCollapsed={targetBucket !== 'scheduled'}
            onDisburse={handleDisburse}
            onView={handleView}
          />
        </div>
      )}

      {selectedItem && (
        <DisburseLoanDrawer
          isOpen={isDrawerOpen}
          onClose={handleCloseDrawer}
          onSuccess={handleDisburseSuccess}
          loanAccountId={selectedItem.loanAccountId}
          accountNumber={selectedItem.accountNumber}
          loanAmount={selectedItem.loanAmount}
          signedLoanAgreementUrl={selectedItem.signedLoanAgreementUrl}
        />
      )}

      <EarlyDisburseWarningModal
        isOpen={!!pendingEarly}
        accountNumber={pendingEarly?.accountNumber ?? ''}
        customerName={pendingEarly?.customerName ?? ''}
        loanAmountFormatted={pendingEarly?.loanAmountFormatted ?? ''}
        commencementDate={pendingEarly?.commencementDate ?? null}
        onCancel={() => setPendingEarly(null)}
        onConfirm={() => {
          const it = pendingEarly!
          setPendingEarly(null)
          openDrawer(it)
        }}
      />
    </div>
  )
}
