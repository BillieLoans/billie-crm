'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@payloadcms/ui'
import { useIssueReports, useOpenIssueCount } from '@/hooks'
import type { IssueReport } from '@/hooks'
import { isAdmin } from '@/lib/access'
import { formatDateShort } from '@/lib/formatters'
import { IssueReportDetail } from './IssueReportDetail'
import styles from './styles.module.css'

type StatusTab = 'open' | 'resolved' | 'all'

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
]

/**
 * Reporter email off a Payload relationship that may or may not be populated
 * (depth=1 usually populates it; a deleted user leaves a bare id or null).
 */
export function reporterEmail(ref: IssueReport['reportedBy'] | IssueReport['resolvedBy']): string {
  if (!ref) return 'Unknown'
  if (typeof ref === 'string') return 'Unknown'
  return ref.email ?? 'Unknown'
}

/** Status pill — open reads as an outstanding action, resolved as done. */
export const IssueStatusBadge: React.FC<{ status: IssueReport['status'] }> = ({ status }) => (
  <span
    className={`${styles.badge} ${status === 'resolved' ? styles.badgeResolved : styles.badgeOpen}`}
  >
    {status === 'resolved' ? 'Resolved' : 'Open'}
  </span>
)

/**
 * IssueReportsView — the admin triage surface for in-app problem reports at
 * `/admin/issue-reports`, plus the detail route `/admin/issue-reports/<id>`.
 *
 * Reports carry a diagnostics payload (and sometimes a screenshot) that can
 * name the pages and API calls of any operator, so the whole view — list and
 * detail — is admin-only.
 */
export const IssueReportsView: React.FC<{ reportId?: string }> = ({ reportId }) => {
  const { user } = useAuth()
  const router = useRouter()
  const [status, setStatus] = useState<StatusTab>('open')

  const admin = isAdmin(user)
  const { data, isLoading, isError } = useIssueReports(status === 'all' ? {} : { status })
  const { data: openCount = 0 } = useOpenIssueCount(admin)
  const docs = data?.docs ?? []

  if (!admin) {
    return (
      <div className={styles.container}>
        <div className={styles.accessDenied} data-testid="access-denied">
          <span className={styles.accessDeniedIcon}>🔒</span>
          <h2 className={styles.accessDeniedTitle}>Access Denied</h2>
          <p className={styles.accessDeniedText}>
            You don&apos;t have permission to view issue reports. Reports can include screenshots
            and diagnostics from other operators&apos; sessions, so this area is restricted to
            administrators.
          </p>
        </div>
      </div>
    )
  }

  if (reportId) {
    return <IssueReportDetail reportId={reportId} />
  }

  return (
    <div className={styles.container} data-testid="issue-reports-view">
      <div className={styles.header}>
        <h1 className={styles.headerTitle}>Issue Reports</h1>
        <p className={styles.headerSubtitle}>
          Problems staff reported from inside the app, with the diagnostics captured at the moment
          they hit them.
        </p>
      </div>

      <div className={styles.tabNav} role="group" aria-label="Status filter">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={styles.tabButton}
            data-active={status === tab.value}
            aria-pressed={status === tab.value}
            onClick={() => setStatus(tab.value)}
            data-testid={`tab-${tab.value}`}
          >
            {tab.label}
            {tab.value === 'open' && openCount > 0 && (
              <span className={styles.tabBadge}>{openCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className={styles.tableWrapper}>
        {isError ? (
          <div className={styles.emptyState}>Failed to load issue reports. Please retry.</div>
        ) : (
          <table className={styles.table}>
            <caption className={styles.tableCaption}>
              {status === 'open'
                ? 'Open issue reports, newest first'
                : status === 'resolved'
                  ? 'Resolved issue reports, newest first'
                  : 'All issue reports, newest first'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Reporter</th>
                <th scope="col">Created</th>
                <th scope="col">Status</th>
                <th scope="col">Trigger</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && docs.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.emptyCell}>
                    Loading issue reports…
                  </td>
                </tr>
              ) : docs.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.emptyCell}>
                    {status === 'open'
                      ? 'No open issue reports. 🎉'
                      : 'No issue reports match this filter.'}
                  </td>
                </tr>
              ) : (
                docs.map((report) => (
                  <tr
                    key={report.id}
                    className={styles.row}
                    onClick={() => router.push(`/admin/issue-reports/${report.id}`)}
                  >
                    <td>
                      <Link
                        href={`/admin/issue-reports/${report.id}`}
                        className={styles.titleLink}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {report.title || 'Untitled report'}
                      </Link>
                    </td>
                    <td>{reporterEmail(report.reportedBy)}</td>
                    <td>{report.createdAt ? formatDateShort(report.createdAt) : '—'}</td>
                    <td>
                      <IssueStatusBadge status={report.status} />
                    </td>
                    <td>
                      {report.triggerReason ? (
                        <span className={styles.chip}>auto · {report.triggerReason}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {docs.length > 0 && (
        <p className={styles.tableFooter}>
          Showing {docs.length} of {data?.totalDocs ?? docs.length} reports
        </p>
      )}
    </div>
  )
}

export default IssueReportsView
