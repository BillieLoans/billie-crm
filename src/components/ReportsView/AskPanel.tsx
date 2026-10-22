'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { formatNumber } from '@/lib/formatters'
import { chartSpecSchema } from '@/lib/schemas/reports'
import {
  AskClaudeFailure,
  useAskClaude,
  useSaveAskDraft,
  type DraftDefinition,
  type DraftOutcome,
} from '@/hooks/mutations/useAskClaude'
import { ReportChart } from './ReportChart'
import { ReportTable } from './ReportTable'
import styles from './styles.module.css'

/**
 * Ask Claude (BTB-508): draft a report from a question, check it, preview
 * it, refine it in plain language or by editing the SQL, and save it as an
 * unpublished draft for a supervisor to publish. Report authors only.
 */
export function AskPanel() {
  const id = useId().replace(/:/g, '')
  const [question, setQuestion] = useState('')
  const [refinement, setRefinement] = useState('')
  const [outcome, setOutcome] = useState<DraftOutcome | null>(null)
  const [definition, setDefinition] = useState<DraftDefinition | null>(null)
  const [sql, setSql] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const [saved, setSaved] = useState<{ slug: string } | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const ask = useAskClaude()
  const save = useSaveAskDraft()

  useEffect(() => {
    if (focusRequest > 0) summaryRef.current?.focus()
  }, [focusRequest])

  const errors = (outcome?.issues ?? []).filter((i) => i.level === 'error')
  const warnings = (outcome?.issues ?? []).filter((i) => i.level === 'warning')
  const sqlEdited = definition !== null && sql !== definition.sql

  const send = (params: Parameters<typeof ask.mutate>[0]) => {
    // Buttons stay focusable while a request runs; a second click does nothing.
    if (ask.isPending) return
    setFailure(null)
    setSaved(null)
    ask.mutate(params, {
      onSuccess: (result) => {
        setOutcome(result)
        if (result.definition) {
          setDefinition(result.definition)
          setSql(result.definition.sql)
        }
        if (result.status !== 'ok' || result.issues.some((i) => i.level === 'error')) {
          setFocusRequest((n) => n + 1)
        }
      },
      onError: (e) => {
        setFailure(e instanceof AskClaudeFailure ? e.message : 'The request failed. Try again.')
        setFocusRequest((n) => n + 1)
      },
    })
  }

  const onAsk = (e: React.FormEvent) => {
    e.preventDefault()
    if (!question.trim()) {
      setFailure('Enter a question')
      setFocusRequest((n) => n + 1)
      return
    }
    setOutcome(null)
    setDefinition(null)
    send({ mode: 'ask', question })
  }

  const onRefine = (e: React.FormEvent) => {
    e.preventDefault()
    if (!definition || !refinement.trim()) return
    send({
      mode: 'refine',
      question,
      definition: { ...definition, sql },
      refinement,
      issues: (outcome?.issues ?? []).map((i) => i.message),
    })
    setRefinement('')
  }

  const onCheck = () => {
    if (!definition) return
    send({ mode: 'check', question, definition: { ...definition, sql } })
  }

  const onSave = () => {
    if (!definition || save.isPending) return
    setFailure(null)
    save.mutate(
      { ...definition, sql },
      {
        onSuccess: (result) => setSaved({ slug: result.slug }),
        onError: (e) => {
          setFailure(e instanceof AskClaudeFailure ? e.message : 'The draft could not be saved.')
          setFocusRequest((n) => n + 1)
        },
      },
    )
  }

  const status = ask.isPending
    ? 'Claude is drafting the report. This usually takes under a minute.'
    : save.isPending
      ? 'Saving the draft…'
      : saved
        ? 'Draft saved.'
        : outcome?.status === 'ok' && outcome.preview
          ? `Draft ready: ${formatNumber(outcome.preview.rowCount)} row${outcome.preview.rowCount === 1 ? '' : 's'} on its default parameters.`
          : ''

  const showSummary =
    failure !== null || errors.length > 0 || (outcome !== null && outcome.status !== 'ok')
  const chart = definition?.chart != null ? chartSpecSchema.safeParse(definition.chart) : null

  return (
    <section aria-labelledby={`${id}-title`} data-testid="ask-panel">
      <header className={styles.header}>
        <h1 id={`${id}-title`} className={styles.title}>
          Ask Claude for a report
        </h1>
        <p className={styles.subtitle}>
          Describe the report you need. Claude drafts the query from the reporting schema; it never
          sees the results. Check the draft, then save it for a supervisor to publish.
        </p>
      </header>

      {showSummary && (
        <div
          ref={summaryRef}
          className={styles.errorSummary}
          role="alert"
          tabIndex={-1}
          data-testid="ask-error-summary"
        >
          <h2 className={styles.errorSummaryTitle}>There is a problem</h2>
          <ul className={styles.errorSummaryList}>
            {failure && <li>{failure}</li>}
            {outcome?.status === 'unanswerable' && (
              <li>
                The reporting data cannot answer this question
                {outcome.notAnswerableReason ? `: ${outcome.notAnswerableReason}` : '.'}
              </li>
            )}
            {(outcome?.status === 'refused' || outcome?.status === 'invalid_output') && (
              <li>{outcome.message}</li>
            )}
            {errors.map((issue) => (
              <li key={issue.code + issue.message}>
                {issue.code === 'RUN' || issue.code === 'SQL' || issue.code === 'PLACEHOLDERS' ? (
                  <a href={`#${id}-sql`}>{issue.message}</a>
                ) : (
                  issue.message
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className={styles.form} onSubmit={onAsk} noValidate>
        <div className={styles.field}>
          <label htmlFor={`${id}-question`} className={styles.fieldLabel}>
            Question
          </label>
          <p id={`${id}-question-hint`} className={styles.hint}>
            For example: decline rate by acquisition source for each week of the last quarter.
          </p>
          <textarea
            id={`${id}-question`}
            className={styles.textarea}
            rows={3}
            maxLength={2000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            aria-describedby={`${id}-question-hint`}
          />
        </div>
        <div className={styles.actions}>
          <button type="submit" className={styles.primaryButton} aria-disabled={ask.isPending}>
            {definition ? 'Ask again from scratch' : 'Draft the report'}
          </button>
        </div>
      </form>

      <p className={styles.status} aria-live="polite" data-testid="ask-status">
        {status}
      </p>

      {definition && (
        <div className={styles.results}>
          <div>
            <h2 className={styles.sectionTitle}>{definition.title}</h2>
            {definition.description && <p className={styles.subtitle}>{definition.description}</p>}
          </div>

          {outcome && outcome.assumptions.length > 0 && (
            <div>
              <h3 className={styles.subheading}>Claude assumed</h3>
              <ul className={styles.plainList}>
                {outcome.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            <div className={styles.warning} data-testid="ask-warnings">
              <strong>Check before saving:</strong>
              <ul className={styles.plainList}>
                {warnings.map((w) => (
                  <li key={w.code + w.message}>{w.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.field}>
            <label htmlFor={`${id}-sql`} className={styles.fieldLabel}>
              SQL
            </label>
            <p id={`${id}-sql-hint`} className={styles.hint}>
              Edit it directly if you prefer, then check it again.
            </p>
            <textarea
              id={`${id}-sql`}
              className={`${styles.textarea} ${styles.code}`}
              rows={Math.min(24, Math.max(8, sql.split('\n').length + 1))}
              value={sql}
              spellCheck={false}
              onChange={(e) => setSql(e.target.value)}
              aria-describedby={`${id}-sql-hint`}
            />
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onCheck}
              aria-disabled={ask.isPending}
            >
              Check the edited SQL
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={onSave}
              disabled={errors.length > 0 || sqlEdited || save.isPending}
            >
              Save as a draft report
            </button>
            {sqlEdited && <span className={styles.hint}>Check the edited SQL before saving.</span>}
          </div>
          {saved && (
            <p className={styles.note} data-testid="ask-saved">
              Saved as an unpublished draft.{' '}
              <Link className={styles.textLink} href={`/admin/reports/${saved.slug}`}>
                Open the draft
              </Link>
              . A supervisor publishes it from the report&apos;s edit page.
            </p>
          )}

          <form className={styles.form} onSubmit={onRefine} noValidate>
            <div className={styles.field}>
              <label htmlFor={`${id}-refine`} className={styles.fieldLabel}>
                Change something
              </label>
              <textarea
                id={`${id}-refine`}
                className={styles.textarea}
                rows={2}
                maxLength={2000}
                value={refinement}
                onChange={(e) => setRefinement(e.target.value)}
              />
            </div>
            <div className={styles.actions}>
              <button
                type="submit"
                className={styles.secondaryButton}
                aria-disabled={ask.isPending}
              >
                Ask Claude to change it
              </button>
            </div>
          </form>

          {outcome?.preview && outcome.preview.rowCount > 0 && (
            <>
              <h3 className={styles.subheading}>Preview on the default parameters</h3>
              {chart?.success && (
                <ReportChart
                  title={definition.title}
                  spec={chart.data}
                  columns={outcome.preview.columns}
                  rows={outcome.preview.rows}
                />
              )}
              <ReportTable
                caption={`${definition.title} (preview)`}
                columns={outcome.preview.columns}
                rows={outcome.preview.rows}
              />
            </>
          )}
          {outcome?.preview && outcome.preview.rowCount === 0 && (
            <p className={styles.note}>The query ran and returned no rows on its defaults.</p>
          )}
        </div>
      )}
    </section>
  )
}
