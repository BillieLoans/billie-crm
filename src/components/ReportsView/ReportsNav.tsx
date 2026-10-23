'use client'

import React, { useId, useState } from 'react'
import Link from 'next/link'
import { REPORT_CATEGORIES } from '@/lib/schemas/reports'
import { matchReports } from '@/lib/reports/catalogue'

export { matchReports }
import type { ReportSummary } from '@/hooks/queries/useReports'
import { useReportPins } from '@/hooks/queries/useReportPreferences'
import styles from './styles.module.css'

export interface ReportsNavProps {
  reports: ReportSummary[]
  canAuthor: boolean
  currentSlug: string
  isLoading: boolean
  error: Error | null
}

function ReportLink({ report, current }: { report: ReportSummary; current: boolean }) {
  return (
    <li>
      <Link
        href={`/admin/reports/${report.slug}`}
        className={`${styles.reportLink} ${current ? styles.reportLinkActive : ''}`}
        aria-current={current ? 'page' : undefined}
      >
        {report.title}
        {!report.published && <span className={styles.listTag}> (draft)</span>}
      </Link>
    </li>
  )
}

/**
 * The reports sidebar: a filter box, pinned reports, the catalogue by
 * category, and unpublished drafts for authors. On a phone it
 * folds into a "Reports" button so the report comes first.
 */
export function ReportsNav({ reports, canAuthor, currentSlug, isLoading, error }: ReportsNavProps) {
  const id = useId().replace(/:/g, '')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const { pinned } = useReportPins()

  const published = reports.filter((r) => r.published)
  const drafts = reports.filter((r) => !r.published)
  const matched = matchReports(published, query)
  const matchedDrafts = matchReports(drafts, query)
  const pinnedReports = pinned
    .map((slug) => published.find((r) => r.slug === slug))
    .filter((r): r is ReportSummary => Boolean(r))
  const current = reports.find((r) => r.slug === currentSlug)

  return (
    <nav className={styles.sidebar} aria-label="Reports">
      <button
        type="button"
        className={styles.navToggle}
        data-testid="reports-nav-toggle"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? `Reports: ${current.title}` : 'All reports'}
        <span aria-hidden="true"> {open ? '▴' : '▾'}</span>
      </button>
      <div id={`${id}-body`} className={`${styles.navBody} ${open ? styles.navBodyOpen : ''}`}>
        <div className={styles.sidebarHeader}>
          <Link href="/admin/reports" className={styles.sidebarTitle}>
            Reports home
          </Link>
          {canAuthor && (
            <Link className={styles.textLink} href="/admin/reports/new">
              New report
            </Link>
          )}
        </div>
        <Link
          className={styles.askLink}
          href="/admin/reports/ask"
          aria-current={currentSlug === 'ask' ? 'page' : undefined}
        >
          Ask Claude for a report
        </Link>
        <Link
          className={styles.textLink}
          href="/admin/reports/subscriptions"
          aria-current={currentSlug === 'subscriptions' ? 'page' : undefined}
        >
          Your emails and alerts
        </Link>
        <Link
          className={styles.textLink}
          href="/admin/reports/boards"
          aria-current={currentSlug === 'boards' ? 'page' : undefined}
        >
          Boards
        </Link>
        <label htmlFor={`${id}-filter`} className={styles.visuallyHidden}>
          Find a report
        </label>
        <input
          id={`${id}-filter`}
          type="search"
          className={styles.navFilter}
          placeholder="Find a report"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />

        {isLoading && <p className={styles.note}>Loading reports…</p>}
        {error && (
          <p className={styles.fieldError} role="alert">
            {error.message}
          </p>
        )}
        {!isLoading && !error && reports.length === 0 && (
          <p className={styles.note}>
            {canAuthor
              ? 'No reports are published yet. Create one with New report.'
              : 'No reports are shared with you yet.'}
          </p>
        )}

        {!query && pinnedReports.length > 0 && (
          <section className={styles.navGroup} aria-labelledby={`${id}-pinned`}>
            <h2 id={`${id}-pinned`} className={styles.navGroupTitle}>
              Pinned
            </h2>
            <ul className={styles.reportList}>
              {pinnedReports.map((r) => (
                <ReportLink key={r.slug} report={r} current={r.slug === currentSlug} />
              ))}
            </ul>
          </section>
        )}

        {query && matched.length === 0 && matchedDrafts.length === 0 && (
          <p className={styles.note}>No report matches &ldquo;{query}&rdquo;.</p>
        )}

        {REPORT_CATEGORIES.map((category) => {
          const inCategory = matched.filter((r) => r.category === category.value)
          if (inCategory.length === 0) return null
          return (
            <details
              key={category.value}
              className={styles.navGroup}
              open={
                Boolean(query) ||
                inCategory.some((r) => r.slug === currentSlug) ||
                !current ||
                undefined
              }
            >
              <summary className={styles.navGroupTitle}>
                {category.label} <span className={styles.navCount}>{inCategory.length}</span>
              </summary>
              <ul className={styles.reportList}>
                {inCategory.map((r) => (
                  <ReportLink key={r.slug} report={r} current={r.slug === currentSlug} />
                ))}
              </ul>
            </details>
          )
        })}

        {canAuthor && drafts.length > 0 && (
          <details
            className={styles.navGroup}
            open={drafts.some((r) => r.slug === currentSlug) || undefined}
          >
            <summary className={styles.navGroupTitle}>
              My drafts <span className={styles.navCount}>{drafts.length}</span>
            </summary>
            <ul className={styles.reportList}>
              {matchReports(drafts, query).map((r) => (
                <ReportLink key={r.slug} report={r} current={r.slug === currentSlug} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </nav>
  )
}
