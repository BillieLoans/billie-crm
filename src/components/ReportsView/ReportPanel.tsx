'use client'

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { formatNumber } from '@/lib/formatters'
import { dateRangeParameters, describeDataAsAt, sydneyToday } from '@/lib/reports/periods'
import { resultHints } from '@/lib/reports/quality'
import { bindParameters, parameterDefault, type ReportParameter } from '@/lib/schemas/reports'
import type { ReportSpec, ReportSummary } from '@/hooks/queries/useReports'
import {
  ReportRunFailure,
  useReportRun,
  type ReportRunRequest,
  type ReportRunResponse,
} from '@/hooks/queries/useReportRun'
import { logReportEvent } from '@/lib/reports/events'
import { useRecentReportsStore } from '@/stores/recentReports'
import { HeadlineStrip } from './HeadlineStrip'
import { PinButton } from './PinButton'
import { ParameterForm, parameterInputId, type ParameterValues } from './ParameterForm'
import { RangePicker } from './RangePicker'
import { SubscribePanel } from './SubscribePanel'
import { AddToBoard } from './AddToBoard'
import { useReportHeadline } from './useReportHeadline'
import { ReportResults } from './ReportResults'
import { csvFileName, downloadText, toCsv } from './csv'
import styles from './styles.module.css'

/** Query-string keys the view owns. Parameter names cannot start with "_". */
export const COMPARE_KEY = '_compare'
export const DRAFT_KEY = '_draft'

/** How long a change to the parameters waits before the report re-runs. */
export const AUTO_RUN_DELAY_MS = 300

/** The form's starting values: the link's, else each parameter's default. */
export function initialValues(
  parameters: readonly ReportParameter[],
  query?: { get(name: string): string | null } | null,
): ParameterValues {
  const values: ParameterValues = {}
  for (const p of parameters) {
    const fromLink = query?.get(p.name)
    if (fromLink !== null && fromLink !== undefined) {
      values[p.name] = p.type === 'boolean' ? fromLink === 'true' : fromLink
      continue
    }
    const v = parameterDefault(p)
    values[p.name] = p.type === 'boolean' ? v === true : v === undefined ? '' : String(v)
  }
  return values
}

/**
 * The link for these values: parameters by name, then the view's own keys.
 * A false yes/no is written out, since its default may be true.
 */
export function reportQuery(
  values: ParameterValues,
  options: { compare: boolean; draft: boolean },
): string {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) {
    if (value === '') continue
    query.set(name, String(value))
  }
  if (options.compare) query.set(COMPARE_KEY, '1')
  if (options.draft) query.set(DRAFT_KEY, '1')
  return query.toString()
}

/**
 * Put a query in the address bar without a navigation. Next keeps
 * useSearchParams in step with history.replaceState, and no server render
 * runs, which router.replace would do on every change.
 */
export function replaceQuery(pathname: string, query: string): void {
  window.history.replaceState(window.history.state, '', `${pathname}${query ? `?${query}` : ''}`)
}

/** The description's first sentence, and the rest. */
export function splitDescription(text: string | null): [string, string] {
  if (!text) return ['', '']
  const match = /^(.+?[.!?])\s+(.*)$/s.exec(text.trim())
  return match ? [match[1], match[2]] : [text.trim(), '']
}

export interface ReportPanelProps {
  report: ReportSummary
  spec: ReportSpec
  draft: boolean
  draftOnly: boolean
  canAuthor: boolean
  onDraftChange: (draft: boolean) => void
}

/**
 * One report: its period and parameters (kept in the link, so a view can be
 * shared), the headline and what it says, the charts and the data. Runs on
 * open when every parameter has a default, and again shortly after any
 * change; "Run report" stays for keyboard users and slow reports.
 */
export function ReportPanel({
  report,
  spec,
  draft,
  draftOnly,
  canAuthor,
  onDraftChange,
}: ReportPanelProps) {
  const idPrefix = useId().replace(/:/g, '')
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const today = useMemo(() => sydneyToday(), [])
  const range = useMemo(() => dateRangeParameters(spec.parameters), [spec.parameters])
  const [values, setValues] = useState<ParameterValues>(() =>
    initialValues(spec.parameters, searchParams),
  )
  const [compare, setCompare] = useState(() => searchParams?.get(COMPARE_KEY) === '1')
  const [clientErrors, setClientErrors] = useState<Record<string, string> | null>(null)
  // Problems found while editing: shown at their fields, without moving focus.
  const [inlineErrors, setInlineErrors] = useState<Record<string, string> | null>(null)
  const [linkStatus, setLinkStatus] = useState('')
  // Run straight away when every parameter has a usable value. Decided once,
  // when the panel mounts; a refetch of the report list cannot re-run it.
  const [request, setRequest] = useState<ReportRunRequest | null>(() => {
    const start = initialValues(spec.parameters, searchParams)
    return bindParameters(spec.parameters, start).ok
      ? {
          slug: report.slug,
          parameters: start,
          draft,
          compare: searchParams?.get(COMPARE_KEY) === '1' && range !== null,
          attempt: 0,
        }
      : null
  })
  const run = useReportRun(request)
  const summaryRef = useRef<HTMLDivElement>(null)
  const firstRender = useRef(true)
  const addRecent = useRecentReportsStore((st) => st.addReport)

  // Remember the report for the Reports home's "Recently viewed".
  useEffect(() => {
    if (report.published) addRecent(report.slug, report.title)
  }, [addRecent, report.published, report.slug, report.title])

  // Keep the link in step with the form, and re-run shortly after a change.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    replaceQuery(pathname, reportQuery(values, { compare, draft: draft && !draftOnly }))
    const timer = setTimeout(() => {
      const check = bindParameters(spec.parameters, values)
      if (!check.ok) {
        // Never leave results on screen for inputs they do not match.
        setRequest(null)
        setInlineErrors(check.errors)
        return
      }
      setInlineErrors(null)
      setClientErrors(null)
      setRequest((prev) => ({
        slug: report.slug,
        parameters: values,
        draft,
        compare: compare && range !== null,
        attempt: (prev?.attempt ?? 0) + 1,
      }))
    }, AUTO_RUN_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on the inputs only
  }, [values, compare])

  const runError =
    run.error instanceof ReportRunFailure
      ? run.error
      : run.error
        ? new ReportRunFailure('The report could not be run. Try again.', 'QUERY_FAILED')
        : null
  const fieldErrors = clientErrors ?? inlineErrors ?? runError?.fields ?? {}
  // The summary (which takes focus) is for a run the user asked for.
  const errorEntries = Object.entries(clientErrors ?? runError?.fields ?? {})
  const generalError = !clientErrors && runError && !runError.fields ? runError : null
  const hasErrors = errorEntries.length > 0 || generalError !== null
  const result: ReportRunResponse | undefined = run.data

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
    setInlineErrors(null)
    setRequest((prev) => ({
      slug: report.slug,
      parameters: values,
      draft,
      compare: compare && range !== null,
      attempt: (prev?.attempt ?? 0) + 1,
    }))
  }

  const { views, previousRows, previousLabel, tiles, narrative } = useReportHeadline(result, spec)

  let status = ''
  if (run.isFetching) status = 'Running the report…'
  else if (run.isError) status = 'The report did not run.'
  else if (result) {
    status = `Showing ${formatNumber(result.rowCount)} row${result.rowCount === 1 ? '' : 's'}${
      result.truncated ? ', cut at the row limit' : ''
    }.`
  }

  const [lead, more] = splitDescription(spec.description)
  const definitions = spec.columns.filter((c) => c.description)
  // A drill-down opens the next report on the same period.
  const carryParameters = range
    ? Object.fromEntries(
        [range.from.name, range.to.name]
          .filter((name) => typeof values[name] === 'string' && values[name])
          .map((name) => [name, String(values[name])]),
      )
    : undefined

  const copyLink = async () => {
    const query = reportQuery(values, { compare, draft: false })
    const url = `${window.location.origin}${pathname}${query ? `?${query}` : ''}`
    try {
      await navigator.clipboard.writeText(url)
      setLinkStatus('Link copied. It opens this report with these settings.')
      logReportEvent({ kind: 'copy_link', reportSlug: report.slug })
    } catch {
      setLinkStatus(`Copying is blocked in this browser. The link is ${url}`)
    }
  }

  return (
    <section aria-labelledby={`${idPrefix}-title`}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 id={`${idPrefix}-title`} className={styles.title}>
            {spec.title}
          </h1>
          {report.published && <PinButton slug={report.slug} title={report.title} />}
        </div>
        {lead && <p className={styles.subtitle}>{lead}</p>}
      </header>

      {canAuthor && (
        <div className={styles.authorBar} data-testid="author-toolbar">
          <span className={styles.authorBarLabel}>For authors:</span>
          {draftOnly ? (
            <span className={styles.draftBadge}>
              <strong>Not published.</strong> Only report authors can see and run this draft.
            </span>
          ) : report.draft ? (
            <div className={styles.segmented} role="radiogroup" aria-label="Version to run">
              <label className={styles.segment}>
                <input
                  type="radio"
                  name={`${idPrefix}-version`}
                  checked={!draft}
                  onChange={() => onDraftChange(false)}
                />
                <span>Published</span>
              </label>
              <label className={styles.segment}>
                <input
                  type="radio"
                  name={`${idPrefix}-version`}
                  checked={draft}
                  onChange={() => onDraftChange(true)}
                />
                <span>Latest draft</span>
              </label>
            </div>
          ) : null}
          <Link className={styles.textLink} href={`/admin/reports/${report.slug}/edit`}>
            Edit report
          </Link>
          <Link className={styles.textLink} href={`/admin/reports/ask?from=${report.slug}`}>
            Ask Claude to change it
          </Link>
          {report.published && !draft && (
            <AddToBoard slug={report.slug} parameters={request?.parameters ?? values} />
          )}
        </div>
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
        {range && (
          <RangePicker
            idPrefix={idPrefix}
            from={range.from}
            to={range.to}
            fromValue={String(values[range.from.name] ?? '')}
            toValue={String(values[range.to.name] ?? '')}
            today={today}
            errors={fieldErrors}
            inputId={(name) => parameterInputId(idPrefix, name)}
            onChange={(from, to) =>
              setValues((prev) => ({ ...prev, [range.from.name]: from, [range.to.name]: to }))
            }
          />
        )}
        <ParameterForm
          idPrefix={idPrefix}
          parameters={spec.parameters}
          values={values}
          errors={fieldErrors}
          exclude={range ? [range.from.name, range.to.name] : []}
          onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
        />
        <div className={styles.actions}>
          {/* Never disabled while running, so keyboard focus stays on it. */}
          <button type="submit" className={styles.primaryButton}>
            Run report
          </button>
          {range && (
            <div className={styles.checkboxRow}>
              <input
                id={`${idPrefix}-compare`}
                type="checkbox"
                className={styles.checkbox}
                checked={compare}
                onChange={(e) => setCompare(e.target.checked)}
              />
              <label htmlFor={`${idPrefix}-compare`} className={styles.fieldLabel}>
                Compare with the previous period
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
              logReportEvent({ kind: 'csv', reportSlug: report.slug })
            }}
          >
            Download CSV
          </button>
          <button type="button" className={styles.secondaryButton} onClick={copyLink}>
            Copy link
          </button>
          <span className={styles.hint} aria-live="polite">
            {linkStatus}
          </span>
        </div>
      </form>

      {report.published && !draft && (
        <SubscribePanel
          slug={report.slug}
          spec={spec}
          // The values the results on screen were run with.
          values={request?.parameters ?? values}
          result={result}
        />
      )}

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
          {compare && range && result.previous === null && (
            <p className={styles.note}>
              The previous period could not be run, so there is no comparison.
            </p>
          )}
          {result.rowCount === 0 ? (
            <p className={styles.note}>No rows match these parameters.</p>
          ) : (
            <>
              <HeadlineStrip tiles={tiles} narrative={narrative} previousLabel={previousLabel} />
              {canAuthor && <QualityHints columns={result.columns} rows={result.rows} />}
              <ReportResults
                title={spec.title}
                charts={spec.charts}
                columnSpecs={spec.columns}
                columns={result.columns}
                rows={result.rows}
                previousRows={previousRows}
                carryParameters={carryParameters}
                reportSlug={report.slug}
                periodStarts={
                  result.previous && range
                    ? {
                        current: String(request?.parameters[range.from.name] ?? ''),
                        previous: result.previous.from,
                      }
                    : undefined
                }
              />
            </>
          )}
          <p className={styles.freshness} data-testid="report-freshness">
            {[
              result.dataAsAt ? `Data to ${describeDataAsAt(result.dataAsAt)}` : null,
              'Sydney dates',
              spec.excludesMock ? 'mock applications excluded' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      )}

      {(more || definitions.length > 0) && (
        <details className={styles.about}>
          <summary>About this report</summary>
          {more && <p>{more}</p>}
          {definitions.length > 0 && (
            <dl className={styles.definitions}>
              {definitions.map((c) => (
                <div key={c.name}>
                  <dt>{c.label ?? views.find((v) => v.name === c.name)?.label ?? c.name}</dt>
                  <dd>{c.description}</dd>
                </div>
              ))}
            </dl>
          )}
        </details>
      )}
    </section>
  )
}

/** Authors only: checks on the rows that usually mean a query mistake. */
function QualityHints({
  columns,
  rows,
}: {
  columns: ReportRunResponse['columns']
  rows: ReportRunResponse['rows']
}) {
  const hints = resultHints(columns, rows)
  if (hints.length === 0) return null
  return (
    <div className={styles.warning} data-testid="report-quality-hints">
      <strong>Check this report (shown to authors):</strong>
      <ul className={styles.plainList}>
        {hints.map((h) => (
          <li key={h.code + h.message}>{h.message}</li>
        ))}
      </ul>
    </div>
  )
}
