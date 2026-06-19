'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useDashboard } from '@/hooks/queries/useDashboard'
import { useRecentCustomersStore } from '@/stores/recentCustomers'
import { useFailedActionsStore } from '@/stores/failed-actions'
import { formatRelativeTime } from '@/lib/formatters'
import { SystemHealthStrip } from './SystemHealthStrip'
import { DisbursementTriagePanel } from './DisbursementTriagePanel'
import { OverdueHeroTile } from './OverdueHeroTile'
import { ApprovalsHeroTile } from './ApprovalsHeroTile'
import { MoneyFlowsRow } from './MoneyFlowsRow'
import { PortfolioHealthSection } from './PortfolioHealthSection'
import styles from './styles.module.css'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function getShortcutLabel(): string {
  if (typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')) {
    return '⌘K'
  }
  return 'Ctrl+K'
}

/**
 * Dashboard home page view.
 *
 * Operational triage screen for ops staff. Four-zone layout (top→bottom):
 *   1. System health strip (only visible when degraded)
 *   2. Personalised greeting header
 *   3. Failed-actions alert banner (only when count > 0)
 *   4. Zone "Act now": Disbursement triage + Overdue / Approvals hero tiles
 *   5. Zone "Today's flows": Money flows
 *   6. Recent customers
 *   7. Portfolio Health & Risk (ECL — demoted financial KPIs)
 */
export function DashboardView() {
  const { data, isLoading, error } = useDashboard()
  const recentCustomers = useRecentCustomersStore((s) => s.customers)
  const failedActionsCount = useFailedActionsStore((s) => s.getActiveCount())
  const [shortcutLabel, setShortcutLabel] = useState('⌘K')

  useEffect(() => {
    setShortcutLabel(getShortcutLabel())
  }, [])

  useEffect(() => {
    useFailedActionsStore.getState().loadFromStorage()
  }, [])

  const greeting = getGreeting()
  const firstName = data?.user?.firstName ?? 'there'
  const canSeeApprovals = data?.user?.role === 'admin' || data?.user?.role === 'supervisor'

  const customerSummaryMap = new Map(
    data?.recentCustomersSummary?.map((c) => [c.customerId, c]) ?? [],
  )

  if (isLoading) {
    return (
      <div className={styles.container} data-testid="dashboard-loading">
        <div className={styles.header}>
          <div className={styles.skeletonTitle} />
        </div>
        <div className={styles.heroRow}>
          <div className={styles.skeletonCard} />
          <div className={styles.skeletonCard} />
          <div className={styles.skeletonCard} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.container} data-testid="dashboard-error">
        <div className={styles.errorCard}>
          <span className={styles.errorIcon}>⚠️</span>
          <h2>Unable to load dashboard</h2>
          <p>{error.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container} data-testid="dashboard-view">
      <SystemHealthStrip />

      <div className={styles.header}>
        <h1 className={styles.greeting} data-testid="dashboard-greeting">
          {greeting}, {firstName}!
        </h1>
      </div>

      {failedActionsCount > 0 && (
        <button
          type="button"
          className={styles.failedBanner}
          data-testid="failed-actions-link"
          onClick={() => {
            // TODO: Open failed actions panel
          }}
        >
          <span aria-hidden="true">⚠️</span>
          <span>
            {failedActionsCount} Failed Action{failedActionsCount !== 1 ? 's' : ''} — click to
            review
          </span>
        </button>
      )}

      <h2 className={styles.zoneHeading}>Act now</h2>

      <DisbursementTriagePanel />

      <div className={styles.heroRow} data-testid="hero-tiles">
        <OverdueHeroTile />
        {canSeeApprovals && <ApprovalsHeroTile />}
      </div>

      <h2 className={styles.zoneHeading}>Today&apos;s flows</h2>

      <MoneyFlowsRow />

      <div className={styles.card} data-testid="recent-customers-card">
        <h2 className={styles.cardTitle}>Recent Customers</h2>
        {recentCustomers.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No recently viewed customers.</p>
            <p className={styles.emptyHint}>
              Use {shortcutLabel} to search for a customer to get started.
            </p>
          </div>
        ) : (
          <div className={styles.customerList}>
            <div className={styles.customerHeader}>
              <span>Customer</span>
              <span>Accounts</span>
              <span>Outstanding</span>
              <span>Last Viewed</span>
            </div>
            {recentCustomers.slice(0, 5).map((recent) => {
              const summary = customerSummaryMap.get(recent.customerId)
              return (
                <Link
                  key={recent.customerId}
                  href={`/admin/servicing/${recent.customerId}`}
                  className={styles.customerRow}
                  data-testid={`customer-row-${recent.customerId}`}
                >
                  <span className={styles.customerName}>
                    <span className={styles.customerId}>{recent.customerId}</span>
                    <span className={styles.customerFullName}>{summary?.name ?? 'Loading...'}</span>
                  </span>
                  <span className={styles.customerAccounts}>{summary?.accountCount ?? '—'}</span>
                  <span className={styles.customerOutstanding}>
                    {summary?.totalOutstanding ?? '—'}
                  </span>
                  <span className={styles.customerLastViewed}>
                    {formatRelativeTime(new Date(recent.viewedAt))}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      <PortfolioHealthSection />

      {/* TODO Phase 3: replace this footer with a search input in the admin chrome */}
      <div className={styles.tipFooter} data-testid="keyboard-tip">
        <span className={styles.tipIcon}>💡</span>
        <span className={styles.tipText}>
          Press <kbd className={styles.kbd}>{shortcutLabel}</kbd> to quickly search for any customer
        </span>
      </div>
    </div>
  )
}

export default DashboardView
