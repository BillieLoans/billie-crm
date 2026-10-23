'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useAuth } from '@payloadcms/ui'
import { Breadcrumb } from '@/components/Breadcrumb'
import { hasAnyRole } from '@/lib/access'
import { useReports, type ReportSpec, type ReportSummary } from '@/hooks/queries/useReports'
import { DRAFT_KEY, ReportPanel, replaceQuery } from './ReportPanel'
import { AskPanel } from './AskPanel'
import styles from './styles.module.css'

export interface ReportsViewProps {
  /** The report in the URL (`/admin/reports/<slug>`), or '' for the list. */
  slug: string
}

/**
 * Reports (BTB-506): run a report with its parameters and see the chart,
 * the table and a CSV. Authors also see drafts and can run them. Reports are definitions in the
 * `report-definitions` collection, so a new report needs no deploy.
 */
export function ReportsView({ slug }: ReportsViewProps) {
  const { user } = useAuth()
  const allowed = hasAnyRole(user)
  const { data, isLoading, error } = useReports()

  if (!allowed) {
    return (
      <div className={styles.container}>
        <div className={styles.accessDenied} data-testid="access-denied">
          <h1 className={styles.title}>You cannot open reports</h1>
          <p className={styles.subtitle}>Ask an admin if you need access.</p>
        </div>
      </div>
    )
  }

  const reports = data?.reports ?? []
  const canAuthor = data?.canAuthor ?? false
  const selected = slug ? reports.find((r) => r.slug === slug) : undefined

  return (
    <div className={styles.container}>
      <Breadcrumb
        items={
          selected
            ? [{ label: 'Reports', href: '/admin/reports' }, { label: selected.title }]
            : slug === 'ask'
              ? [{ label: 'Reports', href: '/admin/reports' }, { label: 'Ask Claude' }]
              : [{ label: 'Reports' }]
        }
      />
      <div className={styles.layout}>
        <nav className={styles.sidebar} aria-label="Reports">
          <div className={styles.sidebarHeader}>
            <h2 className={styles.sidebarTitle}>Reports</h2>
            {canAuthor && (
              <Link className={styles.textLink} href="/admin/collections/report-definitions/create">
                New report
              </Link>
            )}
          </div>
          {canAuthor && (
            <Link
              className={styles.askLink}
              href="/admin/reports/ask"
              aria-current={slug === 'ask' ? 'page' : undefined}
            >
              Ask Claude for a report
            </Link>
          )}
          {isLoading && <p className={styles.note}>Loading reports…</p>}
          {error && (
            <p className={styles.fieldError} role="alert">
              {(error as Error).message}
            </p>
          )}
          {!isLoading && !error && reports.length === 0 && (
            <p className={styles.note}>
              {canAuthor
                ? 'No reports are published yet. Create one with New report.'
                : 'No reports are shared with you yet.'}
            </p>
          )}
          <ul className={styles.reportList}>
            {reports.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/admin/reports/${r.slug}`}
                  className={`${styles.reportLink} ${r.slug === slug ? styles.reportLinkActive : ''}`}
                  aria-current={r.slug === slug ? 'page' : undefined}
                >
                  {r.title}
                  {!r.published && <span className={styles.listTag}> (draft)</span>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.main}>
          {slug === 'ask' && canAuthor ? (
            <AskPanel />
          ) : selected ? (
            <ReportEntry key={selected.slug} report={selected} canAuthor={canAuthor} />
          ) : slug && !isLoading && !error ? (
            <div data-testid="report-not-found">
              <h1 className={styles.title}>Report not found</h1>
              <p className={styles.subtitle}>
                There is no published report at this link, or it is not shared with you. Choose a
                report from the list.
              </p>
            </div>
          ) : !slug ? (
            <div>
              <h1 className={styles.title}>Reports</h1>
              <p className={styles.subtitle}>Choose a report from the list to run it.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

interface EntryProps {
  report: ReportSummary
  canAuthor: boolean
}

/**
 * Holds the draft switch (kept in the link for authors). Switching remounts
 * the panel, because a draft can have different parameters and a different
 * chart from the published version.
 */
function ReportEntry({ report, canAuthor }: EntryProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const draftOnly = !report.published
  const [draftMode, setDraftMode] = useState(
    draftOnly || (canAuthor && Boolean(report.draft) && searchParams?.get(DRAFT_KEY) === '1'),
  )
  const spec: ReportSpec = draftMode && report.draft ? report.draft : report
  const onDraftChange = (draft: boolean) => {
    setDraftMode(draft)
    // A different version has different parameters: start from its defaults.
    replaceQuery(pathname, draft ? `${DRAFT_KEY}=1` : '')
  }
  return (
    <ReportPanel
      key={draftMode ? 'draft' : 'published'}
      report={report}
      spec={spec}
      draft={draftMode}
      draftOnly={draftOnly}
      canAuthor={canAuthor}
      onDraftChange={onDraftChange}
    />
  )
}
