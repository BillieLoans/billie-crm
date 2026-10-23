'use client'

import React from 'react'
import Link from 'next/link'
import {
  formatCalendarDate,
  formatDateMedium,
  formatNumber,
  formatOneDecimal,
  formatPercent,
} from '@/lib/formatters'
import { useReportUsage, type UsageSummary } from '@/hooks/queries/useReportUsage'
import styles from './styles.module.css'

function seconds(ms: number | null): string {
  return ms === null ? '–' : `${formatOneDecimal(ms / 1000)} s`
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.usageFigure}>
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
        {hint && <span className={styles.subscriptionMeta}>{hint}</span>}
      </dd>
    </div>
  )
}

function Weekly({ weeks }: { weeks: UsageSummary['weeks'] }) {
  if (weeks.length === 0) return <p className={styles.note}>No reports were opened.</p>
  const most = Math.max(...weeks.map((w) => w.viewers), 1)
  return (
    <table className={styles.table} data-testid="usage-weeks">
      <caption className={styles.visuallyHidden}>People opening reports each week</caption>
      <thead>
        <tr>
          <th scope="col">Week of</th>
          <th scope="col">People</th>
          <th scope="col">Report runs</th>
          <th scope="col">Runs per person</th>
        </tr>
      </thead>
      <tbody>
        {weeks.map((w) => (
          <tr key={w.week}>
            <th scope="row">{formatCalendarDate(w.week, 'axis')}</th>
            <td>
              <span className={styles.usageBar} style={{ width: `${(w.viewers / most) * 6}rem` }} />
              {formatNumber(w.viewers)}
            </td>
            <td>{formatNumber(w.runs)}</td>
            <td>{w.runsPerViewer === null ? '–' : formatOneDecimal(w.runsPerViewer)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * How Reports is used (report authors): people each week, each report's
 * readers, CSV downloads and subscribers, reports nobody opened, Ask
 * Claude's speed and save rate, and searches that found nothing opened.
 */
export function UsagePage({ canAuthor }: { canAuthor: boolean }) {
  const usage = useReportUsage(canAuthor)

  if (!canAuthor) {
    return (
      <div data-testid="usage-denied">
        <h1 className={styles.title}>Usage is for report authors</h1>
        <p className={styles.subtitle}>Admins and supervisors can see how Reports is used.</p>
      </div>
    )
  }
  if (usage.isLoading) return <p className={styles.note}>Loading the usage figures…</p>
  if (usage.error || !usage.data) {
    return (
      <p className={styles.errorSummary} role="alert">
        {(usage.error as Error | null)?.message ?? 'The usage figures could not be loaded.'}
      </p>
    )
  }
  const u = usage.data

  return (
    <section aria-labelledby="usage-title" data-testid="usage-page">
      <header className={styles.header}>
        <h1 id="usage-title" className={styles.title}>
          How Reports is used
        </h1>
        <p className={styles.subtitle}>
          The last {u.days} days unless it says otherwise. Runs from the report pages and boards;
          scheduled emails, authors&apos; drafts and comparison runs are not counted as reads.
        </p>
      </header>

      <h2 className={styles.sectionTitle}>Each week (last 8 weeks)</h2>
      <Weekly weeks={u.weeks} />

      <h2 className={styles.sectionTitle}>Ask Claude</h2>
      <dl className={styles.usageFigures} data-testid="usage-ask">
        <Figure
          label="Questions"
          value={formatNumber(u.ask.asks)}
          hint={`${formatNumber(u.ask.refines)} changes asked for`}
        />
        <Figure
          label="First output (median)"
          value={seconds(u.ask.firstOutputP50)}
          hint={`95% within ${seconds(u.ask.firstOutputP95)}`}
        />
        <Figure
          label="Finished draft (median)"
          value={seconds(u.ask.totalP50)}
          hint={`95% within ${seconds(u.ask.totalP95)}`}
        />
        <Figure
          label="Drafts saved"
          value={u.ask.saveRate === null ? '–' : formatPercent(u.ask.saveRate)}
          hint={`${formatNumber(u.ask.saves)} of ${formatNumber(u.ask.answered)} answered; ${formatNumber(u.ask.cancelled)} cancelled`}
        />
      </dl>

      <h2 className={styles.sectionTitle}>Reports</h2>
      {/* A scroll box: focusable so it scrolls from the keyboard. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Reports' readers">
        <table className={styles.table} data-testid="usage-reports">
          <caption className={styles.visuallyHidden}>Each report&apos;s readers</caption>
          <thead>
            <tr>
              <th scope="col">Report</th>
              <th scope="col">Runs</th>
              <th scope="col">People</th>
              <th scope="col">CSV per run</th>
              <th scope="col">Emailed to</th>
              <th scope="col">Last opened</th>
            </tr>
          </thead>
          <tbody>
            {u.reports
              .filter((r) => r.views > 0)
              .map((r) => (
                <tr key={r.slug}>
                  <th scope="row">
                    <Link className={styles.textLink} href={`/admin/reports/${r.slug}`}>
                      {r.title}
                    </Link>
                  </th>
                  <td>{formatNumber(r.views)}</td>
                  <td>{formatNumber(r.viewers)}</td>
                  <td>{r.csvPerView === null ? '–' : formatPercent(r.csvPerView)}</td>
                  <td>{formatNumber(r.subscribers)}</td>
                  <td>{r.lastViewed ? formatDateMedium(r.lastViewed) : '–'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <h2 className={styles.sectionTitle}>Not opened in {u.days} days</h2>
      {u.unopened.length === 0 ? (
        <p className={styles.note}>Every published report was opened.</p>
      ) : (
        <>
          <p className={styles.hint}>
            Candidates to improve, merge or retire. Subscriptions still send them.
          </p>
          <ul className={styles.plainList} data-testid="usage-unopened">
            {u.unopened.map((r) => (
              <li key={r.slug}>
                <Link className={styles.textLink} href={`/admin/reports/${r.slug}`}>
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className={styles.sectionTitle}>Searches that found nothing opened</h2>
      <p className={styles.hint}>
        {formatNumber(u.searches.unanswered)} of {formatNumber(u.searches.total)} searches had no
        report opened within ten minutes: words to add to report titles and descriptions, or reports
        to write.
      </p>
      {u.searches.top.length > 0 && (
        <ul className={styles.plainList} data-testid="usage-searches">
          {u.searches.top.map((s) => (
            <li key={s.query}>
              <q>{s.query}</q> ({formatNumber(s.searches)})
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
