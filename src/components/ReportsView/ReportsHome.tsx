'use client'

import React, { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { REPORT_CATEGORIES } from '@/lib/schemas/reports'
import { logReportEvent } from '@/lib/reports/events'
import type { ReportSummary } from '@/hooks/queries/useReports'
import { useReportPins } from '@/hooks/queries/useReportPreferences'
import { useReportsHome, type HomeTile } from '@/hooks/queries/useReportsHome'
import { useRecentReportsStore } from '@/stores/recentReports'
import { PinButton } from './PinButton'
import { matchReports } from '@/lib/reports/catalogue'
import { splitDescription } from './ReportPanel'
import styles from './styles.module.css'

/** How long the search box waits before it records a search. */
const SEARCH_LOG_DELAY_MS = 1_500

/** A small line of the headline over time, last point marked. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const width = 120
  const height = 32
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values.map((v, i) => [
    (i / (values.length - 1)) * (width - 4) + 2,
    height - 3 - ((v - min) / span) * (height - 6),
  ])
  const [lx, ly] = points[points.length - 1]
  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label} over the period`}
      preserveAspectRatio="none"
    >
      <polyline
        points={points.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke="var(--series-1)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lx} cy={ly} r="2.5" fill="var(--series-1)" />
    </svg>
  )
}

function KpiTile({ tile }: { tile: HomeTile }) {
  return (
    <Link href={`/admin/reports/${tile.slug}`} className={styles.kpiTile}>
      <span className={styles.headlineLabel}>{tile.label}</span>
      <span className={styles.headlineValue}>{tile.text}</span>
      {tile.change ? (
        <span className={`${styles.headlineChange} ${styles[`tone_${tile.change.tone}`]}`}>
          <span aria-hidden="true">
            {tile.change.direction === 'up'
              ? '▲'
              : tile.change.direction === 'down'
                ? '▼'
                : '–'}{' '}
          </span>
          {tile.change.text}
          {tile.previousLabel ? ` on ${tile.previousLabel}` : ''}
          {tile.change.tone !== 'neutral' && (
            <span className={styles.visuallyHidden}>
              {tile.change.tone === 'good' ? ' (better)' : ' (worse)'}
            </span>
          )}
        </span>
      ) : (
        <span className={styles.headlineChange}>{tile.title}</span>
      )}
      {tile.spark && (
        <span className={styles.chart}>
          <Sparkline values={tile.spark} label={tile.label} />
        </span>
      )}
    </Link>
  )
}

function CatalogueItem({ report, onOpen }: { report: ReportSummary; onOpen?: () => void }) {
  const [lead] = splitDescription(report.description)
  return (
    <li className={styles.catalogueItem}>
      <div className={styles.catalogueText}>
        <Link
          href={`/admin/reports/${report.slug}`}
          className={styles.catalogueTitle}
          onClick={onOpen}
        >
          {report.title}
          {!report.published && <span className={styles.listTag}> (draft)</span>}
        </Link>
        {lead && <p className={styles.catalogueLead}>{lead}</p>}
      </div>
      {report.published && <PinButton slug={report.slug} title={report.title} />}
    </li>
  )
}

export interface ReportsHomeProps {
  reports: ReportSummary[]
  canAuthor: boolean
  canAsk: boolean
  isLoading: boolean
  error: Error | null
}

/**
 * The Reports home: find a report or ask for one, the business's headline
 * numbers with their changes, then pinned, recent and every report by area.
 */
export function ReportsHome({ reports, canAuthor, canAsk, isLoading, error }: ReportsHomeProps) {
  const id = useId().replace(/:/g, '')
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [question, setQuestion] = useState('')
  const home = useReportsHome()
  const { pinned } = useReportPins()
  const recent = useRecentReportsStore((s) => s.reports)

  // Record what people look for, once they stop typing.
  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) return
    const timer = setTimeout(
      () => logReportEvent({ kind: 'search', query: text }),
      SEARCH_LOG_DELAY_MS,
    )
    return () => clearTimeout(timer)
  }, [query])

  const published = reports.filter((r) => r.published)
  const drafts = reports.filter((r) => !r.published)
  const results = query.trim() ? matchReports(reports, query) : []
  const pinnedReports = pinned
    .map((slug) => published.find((r) => r.slug === slug))
    .filter((r): r is ReportSummary => Boolean(r))
  const recentReports = recent
    .map((r) => reports.find((report) => report.slug === r.slug))
    .filter((r): r is ReportSummary => Boolean(r))

  const onAsk = (e: React.FormEvent) => {
    e.preventDefault()
    const text = question.trim()
    router.push(text ? `/admin/reports/ask?q=${encodeURIComponent(text)}` : '/admin/reports/ask')
  }

  return (
    <div className={styles.home} data-testid="reports-home">
      <header className={styles.header}>
        <h1 className={styles.title}>Reports</h1>
        <p className={styles.subtitle}>The business at a glance, and every report you can run.</p>
      </header>

      <div className={styles.homeSearchRow}>
        <div className={styles.field}>
          <label htmlFor={`${id}-search`} className={styles.fieldLabel}>
            Find a report
          </label>
          <input
            id={`${id}-search`}
            type="search"
            className={styles.input}
            placeholder="Search by name, topic or area"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
        {canAsk && (
          <form className={styles.homeAsk} onSubmit={onAsk}>
            <label htmlFor={`${id}-ask`} className={styles.fieldLabel}>
              Or ask a question
            </label>
            <div className={styles.homeAskRow}>
              <input
                id={`${id}-ask`}
                type="text"
                className={styles.input}
                placeholder="For example: approval rate by source each week this quarter"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={2000}
                autoComplete="off"
              />
              <button type="submit" className={styles.primaryButton}>
                Ask Claude
              </button>
            </div>
          </form>
        )}
      </div>

      {query.trim() ? (
        <section aria-labelledby={`${id}-results`} className={styles.homeSection}>
          <h2 id={`${id}-results`} className={styles.sectionTitle}>
            {results.length} {results.length === 1 ? 'report matches' : 'reports match'} &ldquo;
            {query.trim()}&rdquo;
          </h2>
          {results.length === 0 ? (
            <p className={styles.note}>
              Nothing yet.{' '}
              {canAsk ? (
                <Link
                  className={styles.textLink}
                  href={`/admin/reports/ask?q=${encodeURIComponent(query.trim())}`}
                >
                  Ask Claude to draft it
                </Link>
              ) : (
                'Ask a report author to add it.'
              )}
            </p>
          ) : (
            <ul className={styles.catalogue}>
              {results.map((r) => (
                <CatalogueItem
                  key={r.slug}
                  report={r}
                  onOpen={() =>
                    logReportEvent({ kind: 'search_open', query: query.trim(), reportSlug: r.slug })
                  }
                />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <section aria-labelledby={`${id}-kpis`} className={styles.homeSection}>
            <h2 id={`${id}-kpis`} className={styles.sectionTitle}>
              Headline numbers
            </h2>
            {home.isLoading && <p className={styles.note}>Loading the headline numbers…</p>}
            {home.error && (
              <p className={styles.note} role="alert">
                {(home.error as Error).message}
              </p>
            )}
            {home.data && home.data.length === 0 && (
              <p className={styles.note}>
                {canAuthor
                  ? 'No featured reports yet. Tick "Featured" on a report with headline numbers.'
                  : 'No headline numbers are shared with you yet.'}
              </p>
            )}
            {home.data && home.data.length > 0 && (
              <div className={styles.kpiGrid} data-testid="home-kpis">
                {home.data.map((tile) => (
                  <KpiTile key={tile.slug} tile={tile} />
                ))}
              </div>
            )}
          </section>

          {pinnedReports.length > 0 && (
            <section aria-labelledby={`${id}-pinned`} className={styles.homeSection}>
              <h2 id={`${id}-pinned`} className={styles.sectionTitle}>
                Pinned
              </h2>
              <ul className={styles.catalogue}>
                {pinnedReports.map((r) => (
                  <CatalogueItem key={r.slug} report={r} />
                ))}
              </ul>
            </section>
          )}

          {recentReports.length > 0 && (
            <section aria-labelledby={`${id}-recent`} className={styles.homeSection}>
              <h2 id={`${id}-recent`} className={styles.sectionTitle}>
                Recently viewed
              </h2>
              <ul className={styles.recentList}>
                {recentReports.map((r) => (
                  <li key={r.slug}>
                    <Link href={`/admin/reports/${r.slug}`} className={styles.textLink}>
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby={`${id}-all`} className={styles.homeSection}>
            <h2 id={`${id}-all`} className={styles.sectionTitle}>
              All reports
            </h2>
            {isLoading && <p className={styles.note}>Loading reports…</p>}
            {error && (
              <p className={styles.fieldError} role="alert">
                {error.message}
              </p>
            )}
            {!isLoading && !error && published.length === 0 && (
              <p className={styles.note}>
                {canAuthor
                  ? 'No reports are published yet. Ask Claude for one, or create one with New report.'
                  : 'No reports are shared with you yet.'}
              </p>
            )}
            <div className={styles.catalogueGroups}>
              {REPORT_CATEGORIES.map((category) => {
                const inCategory = published.filter((r) => r.category === category.value)
                if (inCategory.length === 0) return null
                return (
                  <section key={category.value} aria-label={category.label}>
                    <h3 className={styles.navGroupTitle}>{category.label}</h3>
                    <ul className={styles.catalogue}>
                      {inCategory.map((r) => (
                        <CatalogueItem key={r.slug} report={r} />
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          </section>

          {canAuthor && drafts.length > 0 && (
            <section aria-labelledby={`${id}-drafts`} className={styles.homeSection}>
              <h2 id={`${id}-drafts`} className={styles.sectionTitle}>
                Unpublished drafts
              </h2>
              <ul className={styles.catalogue}>
                {drafts.map((r) => (
                  <CatalogueItem key={r.slug} report={r} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
