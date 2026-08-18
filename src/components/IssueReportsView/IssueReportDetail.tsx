'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useIssueReport, useResolveIssue } from '@/hooks'
import { formatDateShort } from '@/lib/formatters'
import { IssueStatusBadge, reporterEmail } from './IssueReportsView'
import styles from './styles.module.css'

/** Em-dash fallback for any diagnostics field the capture missed. */
const or = (value: unknown): string =>
  value === null || value === undefined || value === '' ? '—' : String(value)

/** Timestamps inside diagnostics arrays are ISO strings, but never trusted. */
const at = (value: unknown): string => {
  if (typeof value !== 'string' || !value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : formatDateShort(parsed)
}

/** Two-column facts table used for the context and device blocks. */
const FactsTable: React.FC<{ caption: string; rows: [string, string][] }> = ({ caption, rows }) => (
  <table className={styles.factsTable}>
    <caption className={styles.tableCaption}>{caption}</caption>
    <tbody>
      {rows.map(([label, value]) => (
        <tr key={label}>
          <th scope="row">{label}</th>
          <td>{value}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

/**
 * Collapsible diagnostics trail. Each entry renders as one monospace line —
 * `timestamp · summary` — because these are read as a sequence, not compared
 * field by field.
 */
const Trail: React.FC<{
  title: string
  entries: unknown[] | undefined
  summarise: (entry: never) => string
}> = ({ title, entries, summarise }) => {
  const list = entries ?? []
  return (
    <details className={styles.trail}>
      <summary className={styles.trailSummary}>
        {title} <span className={styles.trailCount}>{list.length}</span>
      </summary>
      {list.length === 0 ? (
        <p className={styles.trailEmpty}>Nothing captured.</p>
      ) : (
        <ol className={styles.trailList}>
          {list.map((entry, index) => (
            <li key={index} className={styles.trailLine}>
              <span className={styles.trailTime}>{at((entry as { at?: unknown } | null)?.at)}</span>
              <span aria-hidden="true"> · </span>
              {summarise(entry as never)}
            </li>
          ))}
        </ol>
      )}
    </details>
  )
}

/**
 * IssueReportDetail — one problem report at `/admin/issue-reports/<id>`: what
 * the reporter said, the diagnostics captured alongside it, and the resolve
 * panel. Diagnostics are rendered defensively throughout: the payload is
 * whatever the browser managed to collect, and older reports may predate any
 * given field.
 */
export const IssueReportDetail: React.FC<{ reportId: string }> = ({ reportId }) => {
  const { data: report, isLoading, isError } = useIssueReport(reportId)
  const resolveIssue = useResolveIssue()
  const [note, setNote] = useState('')

  // Prefill the note from the saved resolution once the report lands, and
  // again if a resolve round-trip rewrites it. Adjusted during render rather
  // than in an effect (React's "adjusting state when props change" pattern —
  // an effect here would render the stale note first, then flip it), and keyed
  // on the persisted value so a background refetch never clobbers typing.
  const savedNote = report?.resolutionNote ?? ''
  const [syncedNote, setSyncedNote] = useState<string | null>(null)
  if (savedNote !== syncedNote) {
    setSyncedNote(savedNote)
    setNote(savedNote)
  }

  if (isLoading) {
    return (
      <div className={styles.container}>
        <p className={styles.emptyState}>Loading issue report…</p>
      </div>
    )
  }

  if (isError || !report) {
    return (
      <div className={styles.container}>
        <p className={styles.emptyState}>
          This issue report could not be loaded. It may have been deleted.
        </p>
        <Link href="/admin/issue-reports" className={styles.backLink}>
          ← Back to issue reports
        </Link>
      </div>
    )
  }

  const diagnostics = report.diagnostics
  const context = diagnostics?.context
  const device = diagnostics?.device
  const failedActions = diagnostics?.failedActions ?? []
  const isResolved = report.status === 'resolved'

  const toggleResolved = () => {
    resolveIssue.mutate({
      id: report.id,
      status: isResolved ? 'open' : 'resolved',
      resolutionNote: note,
    })
  }

  return (
    <div className={styles.container} data-testid="issue-report-detail">
      <Link href="/admin/issue-reports" className={styles.backLink}>
        ← Back to issue reports
      </Link>

      <div className={styles.detailHeader}>
        <div className={styles.detailHeading}>
          <h1 className={styles.headerTitle}>{report.title || 'Untitled report'}</h1>
          <IssueStatusBadge status={report.status} />
          {report.triggerReason && (
            <span className={styles.chip}>auto · {report.triggerReason}</span>
          )}
        </div>
        <p className={styles.detailMeta}>
          Reported by {reporterEmail(report.reportedBy)} ·{' '}
          {report.createdAt ? formatDateShort(report.createdAt) : '—'}
        </p>
      </div>

      <section className={styles.panel} aria-labelledby="resolve-heading">
        <h2 id="resolve-heading" className={styles.panelTitle}>
          Resolution
        </h2>
        {isResolved && (
          <p className={styles.detailMeta}>
            Resolved {report.resolvedAt ? formatDateShort(report.resolvedAt) : '—'} by{' '}
            {reporterEmail(report.resolvedBy)}
          </p>
        )}
        <label className={styles.fieldLabel} htmlFor="issue-resolution-note">
          Resolution note
        </label>
        <textarea
          id="issue-resolution-note"
          className={styles.textarea}
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What was wrong, and what fixed it?"
        />
        <button
          type="button"
          className={styles.primaryButton}
          onClick={toggleResolved}
          disabled={resolveIssue.isPending}
        >
          {resolveIssue.isPending ? 'Saving…' : isResolved ? 'Reopen' : 'Mark resolved'}
        </button>
      </section>

      <section className={styles.panel} aria-labelledby="said-heading">
        <h2 id="said-heading" className={styles.panelTitle}>
          What the user said
        </h2>
        <p className={styles.description}>{report.description || '—'}</p>
      </section>

      <section className={styles.panel} aria-labelledby="facts-heading">
        <h2 id="facts-heading" className={styles.panelTitle}>
          Where and when
        </h2>
        <div className={styles.factsGrid}>
          <FactsTable
            caption="Page context at capture"
            rows={[
              ['URL', or(context?.url)],
              ['Route', or(context?.route)],
              ['Build', or(context?.buildSha)],
              ['Timezone', or(context?.timezone)],
              [
                'Time on page',
                context?.timeOnPageSec === undefined || context?.timeOnPageSec === null
                  ? '—'
                  : `${context.timeOnPageSec}s`,
              ],
              ['Captured at', at(context?.capturedAt)],
            ]}
          />
          <FactsTable
            caption="Device and connection"
            rows={[
              ['User agent', or(device?.userAgent)],
              ['Platform', or(device?.platform)],
              ['Viewport', device?.viewport ? `${device.viewport.w} × ${device.viewport.h}` : '—'],
              ['Screen', device?.screen ? `${device.screen.w} × ${device.screen.h}` : '—'],
              ['Device pixel ratio', or(device?.dpr)],
              [
                'Online',
                device?.online === undefined || device?.online === null
                  ? '—'
                  : device.online
                    ? 'Yes'
                    : 'No',
              ],
              [
                'Connection',
                device?.connection
                  ? [
                      or(device.connection.effectiveType),
                      device.connection.downlink === null ||
                      device.connection.downlink === undefined
                        ? null
                        : `${device.connection.downlink} Mbps`,
                      device.connection.rtt === null || device.connection.rtt === undefined
                        ? null
                        : `${device.connection.rtt} ms RTT`,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : '—',
              ],
            ]}
          />
        </div>
      </section>

      {report.screenshotUri && (
        <section className={styles.panel} aria-labelledby="screenshot-heading">
          <h2 id="screenshot-heading" className={styles.panelTitle}>
            Screenshot
          </h2>
          <figure className={styles.figure}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/issues/${report.id}/screenshot`}
              alt="Screenshot attached to this report"
              loading="lazy"
              className={styles.screenshot}
            />
            <figcaption className={styles.figCaption}>
              Held privately in the reports bucket and served only to administrators — it can show
              customer data that was on screen, so treat it as customer information.
            </figcaption>
          </figure>
        </section>
      )}

      <section className={styles.panel} aria-labelledby="trails-heading">
        <h2 id="trails-heading" className={styles.panelTitle}>
          Diagnostics trail
        </h2>

        <Trail
          title="Interactions"
          entries={diagnostics?.interactions}
          summarise={(e: { type?: string; target?: string; label?: string | null }) =>
            `${or(e?.type)} on ${or(e?.target)}${e?.label ? ` — "${e.label}"` : ''}`
          }
        />
        <Trail
          title="Route changes"
          entries={diagnostics?.routes}
          summarise={(e: { from?: string | null; to?: string }) =>
            `${e?.from ?? '(entry)'} → ${or(e?.to)}`
          }
        />
        <Trail
          title="API calls"
          entries={diagnostics?.apiCalls}
          summarise={(e: {
            method?: string
            path?: string
            status?: number | null
            ok?: boolean
            durationMs?: number
            error?: string | null
          }) =>
            `${or(e?.method)} ${or(e?.path)} → ${e?.status ?? (e?.ok ? 'ok' : 'failed')} in ${or(
              e?.durationMs,
            )}ms${e?.error ? ` — ${e.error}` : ''}`
          }
        />
        <Trail
          title="Errors"
          entries={diagnostics?.errors}
          summarise={(e: { source?: string; message?: string; stack?: string | null }) =>
            `[${or(e?.source)}] ${or(e?.message)}${e?.stack ? `\n${e.stack}` : ''}`
          }
        />

        {failedActions.length > 0 && (
          <details className={styles.trail}>
            <summary className={styles.trailSummary}>
              Failed actions <span className={styles.trailCount}>{failedActions.length}</span>
            </summary>
            <pre className={styles.json}>{JSON.stringify(failedActions, null, 2)}</pre>
          </details>
        )}
      </section>
    </div>
  )
}

export default IssueReportDetail
