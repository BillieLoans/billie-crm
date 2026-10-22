'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@payloadcms/ui'
import { Breadcrumb } from '@/components/Breadcrumb'
import { hasAnyRole } from '@/lib/access'
import { formatNumber } from '@/lib/formatters'
import { bindParameters, parameterDefault, type ReportParameter } from '@/lib/schemas/reports'
import { useReports, type ReportSpec, type ReportSummary } from '@/hooks/queries/useReports'
import { ReportRunFailure, useReportRun, type ReportRunRequest } from '@/hooks/queries/useReportRun'
import { ParameterForm, parameterInputId, type ParameterValues } from './ParameterForm'
import { ReportChart } from './ReportChart'
import { ReportTable } from './ReportTable'
import { csvFileName, downloadText, toCsv } from './csv'
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
          {selected ? (
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

function initialValues(parameters: ReportParameter[]): ParameterValues {
  const values: ParameterValues = {}
  for (const p of parameters) {
    const v = parameterDefault(p)
    values[p.name] = p.type === 'boolean' ? v === true : v === undefined ? '' : String(v)
  }
  return values
}

interface EntryProps {
  report: ReportSummary
  canAuthor: boolean
}

/**
 * Holds the draft switch. Switching remounts the panel, because a draft can
 * have different parameters and a different chart from the published
 * version.
 */
function ReportEntry({ report, canAuthor }: EntryProps) {
  const draftOnly = !report.published
  const [draftMode, setDraftMode] = useState(draftOnly)
  const spec: ReportSpec = draftMode && report.draft ? report.draft : report
  return (
    <ReportPanel
      key={draftMode ? 'draft' : 'published'}
      report={report}
      spec={spec}
      draft={draftMode}
      draftOnly={draftOnly}
      canAuthor={canAuthor}
      onDraftChange={setDraftMode}
    />
  )
}

interface PanelProps {
  report: ReportSummary
  spec: ReportSpec
  draft: boolean
  draftOnly: boolean
  canAuthor: boolean
  onDraftChange: (draft: boolean) => void
}

function ReportPanel({ report, spec, draft, draftOnly, canAuthor, onDraftChange }: PanelProps) {
  const idPrefix = useId().replace(/:/g, '')
  const [values, setValues] = useState<ParameterValues>(() => initialValues(spec.parameters))
  const [clientErrors, setClientErrors] = useState<Record<string, string> | null>(null)
  // Run straight away when every parameter has a usable default. Decided
  // once, when the panel mounts; a refetch of the report list cannot re-run it.
  const [request, setRequest] = useState<ReportRunRequest | null>(() => {
    const defaults = initialValues(spec.parameters)
    return bindParameters(spec.parameters, defaults).ok
      ? { slug: report.slug, parameters: defaults, draft, attempt: 0 }
      : null
  })
  const run = useReportRun(request)
  const summaryRef = useRef<HTMLDivElement>(null)

  const runError =
    run.error instanceof ReportRunFailure
      ? run.error
      : run.error
        ? new ReportRunFailure('The report could not be run. Try again.', 'QUERY_FAILED')
        : null
  const fieldErrors = clientErrors ?? runError?.fields ?? {}
  const errorEntries = Object.entries(fieldErrors)
  const generalError = !clientErrors && runError && !runError.fields ? runError : null
  const hasErrors = errorEntries.length > 0 || generalError !== null
  const result = run.data

  // Move focus to the error summary when new errors appear (DOM only).
  useEffect(() => {
    if (hasErrors) summaryRef.current?.focus()
  }, [hasErrors, clientErrors, run.error])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const check = bindParameters(spec.parameters, values)
    if (!check.ok) {
      setClientErrors(check.errors)
      // Clear the previous results so the page never shows rows for other inputs.
      setRequest(null)
      return
    }
    setClientErrors(null)
    setRequest((prev) => ({
      slug: report.slug,
      parameters: values,
      draft,
      attempt: (prev?.attempt ?? 0) + 1,
    }))
  }

  let status = ''
  if (run.isFetching) status = 'Running the report…'
  else if (run.isError) status = 'The report did not run.'
  else if (result) {
    const took =
      result.durationMs < 100
        ? 'under a tenth of a second'
        : `${(result.durationMs / 1000).toFixed(1)} seconds`
    status = `${formatNumber(result.rowCount)} row${result.rowCount === 1 ? '' : 's'} in ${took}${result.truncated ? ', cut at the row limit' : ''}.`
  }

  return (
    <section aria-labelledby={`${idPrefix}-title`}>
      <header className={styles.header}>
        <h1 id={`${idPrefix}-title`} className={styles.title}>
          {spec.title}
        </h1>
        {spec.description && <p className={styles.subtitle}>{spec.description}</p>}
        {canAuthor && (
          <Link
            className={styles.textLink}
            href={`/admin/collections/report-definitions/${report.id}`}
          >
            Edit report
          </Link>
        )}
      </header>

      {draftOnly && (
        <p className={styles.draftBadge}>
          <strong>Not published.</strong> Only report authors can see and run this draft.
        </p>
      )}

      {hasErrors && (
        <div
          ref={summaryRef}
          className={styles.errorSummary}
          role="alert"
          tabIndex={-1}
          data-testid="report-error-summary"
        >
          <h2 className={styles.errorSummaryTitle}>There is a problem</h2>
          <ul className={styles.errorSummaryList}>
            {errorEntries.map(([name, message]) => (
              <li key={name}>
                <a href={`#${parameterInputId(idPrefix, name)}`}>{message}</a>
              </li>
            ))}
            {generalError && <li>{generalError.message}</li>}
          </ul>
          {generalError?.detail && (
            <details className={styles.errorDetail}>
              <summary>Database message (shown to report authors)</summary>
              <code>{generalError.detail}</code>
            </details>
          )}
        </div>
      )}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <ParameterForm
          idPrefix={idPrefix}
          parameters={spec.parameters}
          values={values}
          errors={fieldErrors}
          onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
        />
        <div className={styles.actions}>
          {/* Never disabled while running, so keyboard focus stays on it. */}
          <button type="submit" className={styles.primaryButton}>
            Run report
          </button>
          {canAuthor && (
            <div className={styles.checkboxRow}>
              <input
                id={`${idPrefix}-draft`}
                type="checkbox"
                className={styles.checkbox}
                checked={draft}
                disabled={draftOnly}
                onChange={(e) => onDraftChange(e.target.checked)}
              />
              <label htmlFor={`${idPrefix}-draft`} className={styles.fieldLabel}>
                Run the latest draft
              </label>
            </div>
          )}
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={!result || result.rowCount === 0}
            onClick={() => {
              if (!result) return
              downloadText(toCsv(result.columns, result.rows), csvFileName(report.slug))
            }}
          >
            Download CSV
          </button>
        </div>
      </form>

      <p className={styles.status} aria-live="polite" data-testid="report-status">
        {status}
      </p>

      {result && (
        <div className={styles.results}>
          {result.report.draft && (
            <p className={styles.draftBadge}>
              <strong>Draft:</strong> these results come from the unpublished draft.
            </p>
          )}
          {result.truncated && (
            <p className={styles.warning} data-testid="report-truncated">
              <strong>Not all rows are shown.</strong> Reports stop at{' '}
              {formatNumber(result.rowCount)} rows. Narrow the parameters to see the rest.
            </p>
          )}
          {result.rowCount === 0 ? (
            <p className={styles.note}>No rows match these parameters.</p>
          ) : (
            <>
              {spec.chart && (
                <ReportChart
                  title={spec.title}
                  spec={spec.chart}
                  columns={result.columns}
                  rows={result.rows}
                />
              )}
              <ReportTable caption={spec.title} columns={result.columns} rows={result.rows} />
            </>
          )}
        </div>
      )}
    </section>
  )
}
