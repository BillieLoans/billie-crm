'use client'

import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@payloadcms/ui'
import { Breadcrumb } from '@/components/Breadcrumb'
import { hasAnyRole } from '@/lib/access'
import { formatNumber } from '@/lib/formatters'
import { bindParameters, parameterDefault, type ReportParameter } from '@/lib/schemas/reports'
import { useReports, type ReportSummary } from '@/hooks/queries/useReports'
import {
  ReportRunFailure,
  useRunReport,
  type ReportRunResponse,
} from '@/hooks/mutations/useRunReport'
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
 * Reports (BTB-506): run a published report with its parameters and see
 * the chart, the table and a CSV. Reports are definitions in the
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
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.main}>
          {selected ? (
            <ReportPanel key={selected.slug} report={selected} canAuthor={canAuthor} />
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

interface PanelProps {
  report: ReportSummary
  canAuthor: boolean
}

function ReportPanel({ report, canAuthor }: PanelProps) {
  const idPrefix = useId().replace(/:/g, '')
  const [values, setValues] = useState<ParameterValues>(() => initialValues(report.parameters))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [runError, setRunError] = useState<ReportRunFailure | null>(null)
  const [draft, setDraft] = useState(false)
  const [result, setResult] = useState<ReportRunResponse | null>(null)
  const [status, setStatus] = useState('')
  const summaryRef = useRef<HTMLDivElement>(null)
  // Bumped to move focus to the error summary once it has rendered.
  const [focusRequest, setFocusRequest] = useState(0)
  const { mutate, isPending } = useRunReport()

  useEffect(() => {
    if (focusRequest > 0) summaryRef.current?.focus()
  }, [focusRequest])

  const execute = useCallback(
    (submitted: ParameterValues, asDraft: boolean, focusErrors: boolean) => {
      const check = bindParameters(report.parameters, submitted)
      if (!check.ok) {
        setFieldErrors(check.errors)
        setRunError(null)
        if (focusErrors) setFocusRequest((n) => n + 1)
        return
      }
      setFieldErrors({})
      setRunError(null)
      setStatus('Running the report…')
      mutate(
        { slug: report.slug, parameters: submitted, draft: asDraft },
        {
          onSuccess: (data) => {
            setResult(data)
            const took =
              data.durationMs < 100
                ? 'under a tenth of a second'
                : `${(data.durationMs / 1000).toFixed(1)} seconds`
            setStatus(
              `${formatNumber(data.rowCount)} row${data.rowCount === 1 ? '' : 's'} in ${took}${data.truncated ? ', cut at the row limit' : ''}.`,
            )
          },
          onError: (error) => {
            const failure =
              error instanceof ReportRunFailure
                ? error
                : new ReportRunFailure('The report could not be run. Try again.', 'QUERY_FAILED')
            setFieldErrors(failure.fields ?? {})
            setRunError(failure.fields ? null : failure)
            setStatus('The report did not run.')
            setFocusRequest((n) => n + 1)
          },
        },
      )
    },
    [mutate, report.parameters, report.slug],
  )

  // Run straight away when every parameter has a usable default. `execute`
  // is stable, so this runs once per mount. No run-once ref: under React
  // Strict Mode the first mount's mutation loses its observer, and the
  // remount must start a fresh one.
  useEffect(() => {
    const defaults = initialValues(report.parameters)
    if (bindParameters(report.parameters, defaults).ok) execute(defaults, false, false)
  }, [execute, report.parameters])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    execute(values, draft, true)
  }

  const errorEntries = Object.entries(fieldErrors)
  const hasErrors = errorEntries.length > 0 || runError !== null

  return (
    <section aria-labelledby={`${idPrefix}-title`}>
      <header className={styles.header}>
        <h1 id={`${idPrefix}-title`} className={styles.title}>
          {report.title}
        </h1>
        {report.description && <p className={styles.subtitle}>{report.description}</p>}
        {canAuthor && (
          <Link
            className={styles.textLink}
            href={`/admin/collections/report-definitions/${report.id}`}
          >
            Edit report
          </Link>
        )}
      </header>

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
            {runError && <li>{runError.message}</li>}
          </ul>
          {runError?.detail && (
            <details className={styles.errorDetail}>
              <summary>Database message (shown to report authors)</summary>
              <code>{runError.detail}</code>
            </details>
          )}
        </div>
      )}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <ParameterForm
          idPrefix={idPrefix}
          parameters={report.parameters}
          values={values}
          errors={fieldErrors}
          onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
        />
        <div className={styles.actions}>
          <button type="submit" className={styles.primaryButton} disabled={isPending}>
            {isPending ? 'Running…' : 'Run report'}
          </button>
          {canAuthor && (
            <div className={styles.checkboxRow}>
              <input
                id={`${idPrefix}-draft`}
                type="checkbox"
                className={styles.checkbox}
                checked={draft}
                onChange={(e) => setDraft(e.target.checked)}
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
              {report.chart && (
                <ReportChart
                  title={report.title}
                  spec={report.chart}
                  columns={result.columns}
                  rows={result.rows}
                />
              )}
              <ReportTable caption={report.title} columns={result.columns} rows={result.rows} />
            </>
          )}
        </div>
      )}
    </section>
  )
}
