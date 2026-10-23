'use client'

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { formatNumber } from '@/lib/formatters'
import {
  columnSpecsSchema,
  headlineSpecsSchema,
  normaliseCharts,
  REPORT_CATEGORIES,
  REPORT_VIEWER_ROLES,
  type ReportCategory,
  type ReportViewerRole,
} from '@/lib/schemas/reports'
import { resolveColumns } from '@/lib/reports/columns'
import { buildNarrative, computeHeadline } from '@/lib/reports/headline'
import {
  AskClaudeFailure,
  findExistingReports,
  loadRecentAsk,
  loadReportDefinition,
  useAskClaude,
  useRecentAsks,
  useSaveAskDraft,
  type AskStage,
  type DraftDefinition,
  type DraftOutcome,
  type ExistingReportMatch,
  type ReportDefinitionDoc,
} from '@/hooks/mutations/useAskClaude'
import { HeadlineStrip } from './HeadlineStrip'
import { ReportResults } from './ReportResults'
import styles from './styles.module.css'

const STORAGE_KEY = 'billie-ask-draft'

const EXAMPLES = [
  'Approval rate by acquisition source for each week of the last quarter',
  'Loans funded and amount lent each day this month',
  'Decline reasons by credit ruleset version over the last 30 days',
  'How long from starting an application to money, by source',
]

const QUICK_CHANGES = [
  'Make it monthly',
  'Add an All total row',
  'Split it by acquisition source',
  'Show rates as percentages',
  'Cover the last 90 days by default',
]

const STAGE_LABELS: Record<AskStage, string> = {
  matching: 'Looking for a report that already answers it',
  planning: 'Reading the reporting schema and planning',
  writing_sql: 'Writing the SQL',
  checking: 'Checking it and running a preview',
}
const STAGE_ORDER: AskStage[] = ['planning', 'writing_sql', 'checking']

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

interface StoredDraft {
  question: string
  definition: DraftDefinition
  sql: string
  plan: string[]
  assumptions: string[]
  fromSlug?: string
  askId?: string
}

function readStored(): StoredDraft | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredDraft) : null
  } catch {
    return null
  }
}

function writeStored(draft: StoredDraft | null): void {
  try {
    if (draft) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Keeping the draft across pages is a convenience only.
  }
}

export interface AskPanelProps {
  initialQuestion?: string
  /** Change this existing report (authors). */
  fromSlug?: string
  /** Report authors can see the SQL and save; others only ask. */
  canAuthor?: boolean
}

/**
 * Ask Claude (BTB-508): describe a report, watch Claude plan it, check the
 * preview, change it in words, and (authors) save or publish it. Staff who
 * are not authors can ask too, and see the preview marked as not reviewed.
 * Before Claude is asked, an existing report that already answers the
 * question is offered.
 */
export function AskPanel({ initialQuestion = '', fromSlug, canAuthor = true }: AskPanelProps) {
  const id = useId().replace(/:/g, '')
  const [question, setQuestion] = useState(initialQuestion.slice(0, 2000))
  const [refinement, setRefinement] = useState('')
  const [outcome, setOutcome] = useState<DraftOutcome | null>(null)
  const [definition, setDefinition] = useState<DraftDefinition | null>(null)
  const [plan, setPlan] = useState<string[]>([])
  const [assumptions, setAssumptions] = useState<string[]>([])
  const [sql, setSql] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ question?: string; refine?: string }>({})
  const [focusRequest, setFocusRequest] = useState(0)
  const [saved, setSaved] = useState<{ slug: string; published: boolean } | null>(null)
  const [matches, setMatches] = useState<ExistingReportMatch[] | null>(null)
  const [base, setBase] = useState<ReportDefinitionDoc | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [publishCategory, setPublishCategory] = useState<ReportCategory>('other')
  const [publishRoles, setPublishRoles] = useState<ReportViewerRole[]>(['admin', 'supervisor'])
  const [restored, setRestored] = useState(false)
  const [askId, setAskId] = useState<string | undefined>(undefined)
  const [matching, setMatching] = useState(false)
  // The report this draft was saved as, so later saves update it.
  const [savedReportId, setSavedReportId] = useState<string | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())
  const summaryRef = useRef<HTMLDivElement>(null)
  const refineRef = useRef<HTMLTextAreaElement>(null)
  const ask = useAskClaude()
  const save = useSaveAskDraft()
  const recent = useRecentAsks(!definition && !ask.isPending)

  useEffect(() => {
    if (focusRequest > 0) summaryRef.current?.focus()
  }, [focusRequest])

  // The timer while Claude works.
  useEffect(() => {
    if (!ask.isPending) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [ask.isPending])

  const adopt = (result: DraftOutcome, keepPlan = false) => {
    setOutcome(result)
    if (result.askId) setAskId(result.askId)
    if (result.definition) {
      setDefinition(result.definition)
      setSql(result.definition.sql)
      setPublishCategory((result.definition.category as ReportCategory) ?? 'other')
    }
    if (!keepPlan || result.plan.length) setPlan(result.plan)
    if (!keepPlan || result.assumptions.length) setAssumptions(result.assumptions)
    if (result.status !== 'ok' || result.issues.some((i) => i.level === 'error')) {
      setFocusRequest((n) => n + 1)
    }
  }

  const send = async (params: Parameters<typeof ask.run>[0], onDone?: () => void) => {
    setFailure(null)
    setFieldErrors({})
    setSaved(null)
    setConfirming(false)
    try {
      const result = await ask.run(params)
      adopt(result, params.mode === 'check')
      onDone?.()
    } catch (e) {
      if (e instanceof AskClaudeFailure && e.code === 'CANCELLED') return
      setFailure(e instanceof AskClaudeFailure ? e.message : 'The request failed. Try again.')
      setFocusRequest((n) => n + 1)
    }
  }

  // Start from an existing report (Ask Claude to change it), or reopen the
  // draft from earlier in this session.
  useEffect(() => {
    let cancelled = false
    if (fromSlug) {
      void loadReportDefinition(fromSlug).then((doc) => {
        if (cancelled || !doc) {
          if (!cancelled) setFailure('That report could not be loaded to change.')
          return
        }
        setBase(doc)
        setPublishRoles(doc.roles.length ? doc.roles : ['admin', 'supervisor'])
        setQuestion(`Change the report "${doc.title}"`)
        void send({ mode: 'check', question: `Change the report "${doc.title}"`, definition: doc })
      })
    } else if (!initialQuestion) {
      const stored = readStored()
      if (stored && !stored.fromSlug) {
        setQuestion(stored.question)
        setPlan(stored.plan)
        setAssumptions(stored.assumptions)
        setRestored(true)
        void send({
          mode: 'check',
          question: stored.question,
          definition: { ...stored.definition, sql: stored.sql },
        })
      }
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, [])

  // Keep the draft for this session, so leaving the page loses nothing.
  useEffect(() => {
    if (!definition) return
    writeStored({ question, definition, sql, plan, assumptions, fromSlug, askId })
  }, [question, definition, sql, plan, assumptions, fromSlug, askId])

  const errors = (outcome?.issues ?? []).filter((i) => i.level === 'error')
  const warnings = (outcome?.issues ?? []).filter((i) => i.level === 'warning')
  const sqlEdited = definition !== null && sql !== definition.sql

  const showFieldError = (field: 'question' | 'refine', message: string) => {
    setFailure(null)
    setFieldErrors({ [field]: message })
    setFocusRequest((n) => n + 1)
  }

  const draftNew = () => {
    setSavedReportId(undefined)
    setOutcome(null)
    setDefinition(null)
    setPlan([])
    setAssumptions([])
    setMatches(null)
    setRestored(false)
    void send({ mode: 'ask', question })
  }

  const onAsk = async (e: React.FormEvent) => {
    e.preventDefault()
    // Buttons stay focusable while a request runs; a second click does nothing.
    if (ask.isPending || matching) return
    if (!question.trim()) return showFieldError('question', 'Enter a question')
    if (base) return draftNew()
    setMatches(null)
    setMatching(true)
    try {
      const found = await findExistingReports(question)
      if (found.length > 0) {
        setMatches(found)
        return
      }
    } finally {
      setMatching(false)
    }
    draftNew()
  }

  const onRefine = (e?: React.FormEvent, text?: string) => {
    e?.preventDefault()
    const change = (text ?? refinement).trim()
    if (ask.isPending || !definition) return
    if (!change) return showFieldError('refine', 'Say what to change')
    void send(
      {
        mode: 'refine',
        question,
        definition: { ...definition, sql },
        refinement: change,
        issues: (outcome?.issues ?? []).map((i) => ({ code: i.code, message: i.message })),
        askId,
      },
      () => setRefinement(''),
    )
  }

  const onCheck = () => {
    if (ask.isPending || !definition) return
    void send({ mode: 'check', question, definition: { ...definition, sql }, askId })
  }

  const reopen = async (recentId: string) => {
    const found = await loadRecentAsk(recentId)
    if (!found) return setFailure('That question could not be reopened.')
    setQuestion(found.question)
    setPlan([])
    setAssumptions([])
    setAskId(recentId)
    void send({
      mode: 'check',
      question: found.question,
      definition: found.definition,
      askId: recentId,
    })
  }

  // Saving needs a draft that was checked as it stands, with no errors, and
  // not already saved. The server checks again before saving.
  const saveBlocker = !definition
    ? null
    : sqlEdited
      ? 'Check the edited SQL before saving.'
      : outcome?.status !== 'ok'
        ? 'Ask again or check the SQL before saving.'
        : errors.length > 0
          ? 'Fix the problems above before saving.'
          : saved
            ? 'This report is saved.'
            : null

  const onSave = (publish: boolean) => {
    if (!definition || save.isPending || saveBlocker) return
    setFailure(null)
    save.mutate(
      {
        definition: { ...definition, sql },
        publish,
        ...(publish ? { roles: publishRoles, category: publishCategory } : {}),
        ...(base || savedReportId ? { reportId: base?.id ?? savedReportId } : {}),
      },
      {
        onSuccess: (result) => {
          setSaved({ slug: result.slug, published: result.published })
          setSavedReportId(result.id)
          setConfirming(false)
          writeStored(null)
        },
        onError: (e) => {
          setFailure(e instanceof AskClaudeFailure ? e.message : 'The report could not be saved.')
          setFocusRequest((n) => n + 1)
        },
      },
    )
  }

  const startAgain = () => {
    ask.cancel()
    writeStored(null)
    setQuestion('')
    setRefinement('')
    setOutcome(null)
    setDefinition(null)
    setPlan([])
    setAssumptions([])
    setSql('')
    setMatches(null)
    setSaved(null)
    setSavedReportId(undefined)
    setAskId(undefined)
    setRestored(false)
    setFailure(null)
  }

  // The preview, presented as the saved report will be.
  const preview = outcome?.preview
  const charts = normaliseCharts(definition?.chart)
  const columnSpecs = useMemo(() => {
    const parsed = columnSpecsSchema.safeParse(definition?.columnSettings ?? [])
    return parsed.success ? parsed.data : []
  }, [definition])
  const headlineSpecs = useMemo(() => {
    const parsed = headlineSpecsSchema.safeParse(definition?.headline ?? [])
    return parsed.success ? parsed.data : []
  }, [definition])
  const views = useMemo(
    () => (preview ? resolveColumns(preview.columns, columnSpecs) : []),
    [preview, columnSpecs],
  )
  const tiles = useMemo(
    () => (preview ? computeHeadline(headlineSpecs, views, preview.columns, preview.rows) : []),
    [preview, headlineSpecs, views],
  )
  const narrative = useMemo(
    () => (preview ? buildNarrative(tiles, views, preview.columns, preview.rows) : ''),
    [preview, tiles, views],
  )

  const progress = ask.progress
  const partial = progress?.partial
  const reached = new Set(progress?.stages.map((s) => s.stage))
  const currentStage = progress?.stages.at(-1)?.stage

  const status = ask.isPending
    ? `Claude is working: ${STAGE_LABELS[currentStage ?? 'planning'].toLowerCase()}.`
    : save.isPending
      ? 'Saving…'
      : saved
        ? saved.published
          ? 'Published.'
          : 'Draft saved.'
        : outcome?.status === 'ok' && preview
          ? `Draft ready: ${formatNumber(preview.rowCount)} row${preview.rowCount === 1 ? '' : 's'} on its default parameters.`
          : ''

  const showSummary =
    failure !== null ||
    Object.keys(fieldErrors).length > 0 ||
    errors.length > 0 ||
    (outcome !== null && outcome.status !== 'ok')

  const title = base ? `Change "${base.title}" with Claude` : 'Ask Claude for a report'

  return (
    <section aria-labelledby={`${id}-title`} data-testid="ask-panel">
      <header className={styles.header}>
        <h1 id={`${id}-title`} className={styles.title}>
          {title}
        </h1>
        <p className={styles.subtitle}>
          {base
            ? 'Say what to change. Claude revises the report; you check the preview, then save a draft or publish.'
            : 'Describe the report you need. Claude plans it from the reporting schema and never sees the results. Check the preview, change it in words, then save it.'}
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
            {fieldErrors.question && (
              <li>
                <a href={`#${id}-question`}>{fieldErrors.question}</a>
              </li>
            )}
            {fieldErrors.refine && (
              <li>
                <a href={`#${id}-refine`}>{fieldErrors.refine}</a>
              </li>
            )}
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
                {canAuthor &&
                (issue.code === 'RUN' || issue.code === 'SQL' || issue.code === 'PLACEHOLDERS') ? (
                  <a href={`#${id}-sql-details`}>{issue.message}</a>
                ) : (
                  issue.message
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!base && (
        <form className={styles.form} onSubmit={onAsk} noValidate>
          <div className={styles.field}>
            <label htmlFor={`${id}-question`} className={styles.fieldLabel}>
              Question
            </label>
            <p id={`${id}-question-hint`} className={styles.hint}>
              Say what to count, how to split it and over what period. Don&apos;t include customer
              names or contact details.
            </p>
            {fieldErrors.question && (
              <p id={`${id}-question-error`} className={styles.fieldError}>
                {fieldErrors.question}
              </p>
            )}
            <textarea
              id={`${id}-question`}
              className={styles.textarea}
              rows={3}
              maxLength={2000}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              aria-invalid={fieldErrors.question ? true : undefined}
              aria-describedby={
                fieldErrors.question
                  ? `${id}-question-error ${id}-question-hint`
                  : `${id}-question-hint`
              }
            />
          </div>
          {!question && !definition && (
            <div className={styles.chips} aria-label="Example questions" role="group">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className={styles.chip}
                  onClick={() => setQuestion(example)}
                >
                  {example}
                </button>
              ))}
            </div>
          )}
          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.primaryButton}
              aria-disabled={ask.isPending || matching}
            >
              {definition ? 'Ask again from scratch' : 'Draft the report'}
            </button>
            {ask.isPending && (
              <button type="button" className={styles.secondaryButton} onClick={ask.cancel}>
                Cancel
              </button>
            )}
            {(definition || restored) && !ask.isPending && (
              <button type="button" className={styles.secondaryButton} onClick={startAgain}>
                Start again
              </button>
            )}
          </div>
        </form>
      )}

      <p className={styles.status} aria-live="polite" data-testid="ask-status">
        {status}
      </p>

      {restored && definition && !ask.isPending && (
        <p className={styles.note}>Your draft from earlier is back. Carry on, or start again.</p>
      )}

      {matches && matches.length > 0 && !ask.isPending && (
        <div className={styles.matchCard} data-testid="ask-matches">
          <h2 className={styles.sectionTitle}>
            {matches.length === 1
              ? 'A report already answers this'
              : 'Reports that may answer this'}
          </h2>
          <ul className={styles.plainList}>
            {matches.map((m) => {
              const query = new URLSearchParams(m.parameters).toString()
              return (
                <li key={m.slug}>
                  <Link
                    className={styles.textLink}
                    href={`/admin/reports/${m.slug}${query ? `?${query}` : ''}`}
                  >
                    Open {m.title}
                  </Link>
                  {m.description && (
                    <span className={styles.hint}> {m.description.split('. ')[0]}.</span>
                  )}
                </li>
              )
            })}
          </ul>
          <button type="button" className={styles.secondaryButton} onClick={draftNew}>
            Draft a new one anyway
          </button>
        </div>
      )}

      {ask.isPending && progress && (
        <div className={styles.askProgress} role="status" data-testid="ask-progress">
          <div className={styles.askProgressHead}>
            <strong>{partial?.title ?? 'Claude is working on it'}</strong>
            <span
              className={styles.timer}
              aria-label={`${elapsed(now - progress.startedAt)} elapsed`}
            >
              {elapsed(now - progress.startedAt)}
            </span>
          </div>
          <ol className={styles.stages}>
            {STAGE_ORDER.map((stage, i) => {
              const at = progress.stages.find((s) => s.stage === stage)?.atMs
              const next = progress.stages.find((s) => s.stage === STAGE_ORDER[i + 1])?.atMs
              const state =
                stage === currentStage ? 'live' : reached.has(stage) ? 'done' : 'waiting'
              return (
                <li key={stage} className={styles[`stage_${state}`]}>
                  <span className={styles.stageDot} aria-hidden="true" />
                  <span>
                    {STAGE_LABELS[stage]}
                    <span className={styles.visuallyHidden}>
                      {state === 'done' ? ' (done)' : state === 'live' ? ' (in progress)' : ''}
                    </span>
                  </span>
                  <span className={styles.stageTime}>
                    {at !== undefined && next !== undefined
                      ? `${((next - at) / 1000).toFixed(1)}s`
                      : ''}
                  </span>
                </li>
              )
            })}
          </ol>
          {partial && partial.plan.length > 0 && (
            <div className={styles.planBox}>
              <h3 className={styles.subheading}>Plan</h3>
              <ol className={styles.plainList}>
                {partial.plan.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          )}
          {partial && partial.assumptions.length > 0 && (
            <div className={styles.planBox}>
              <h3 className={styles.subheading}>Assuming</h3>
              <ul className={styles.plainList}>
                {partial.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {!definition && !ask.isPending && !base && (recent.data?.length ?? 0) > 0 && (
        <details className={styles.about}>
          <summary>Your recent questions</summary>
          <ul className={styles.plainList}>
            {recent.data!.map((r) => (
              <li key={r.id}>
                <button type="button" className={styles.linkButton} onClick={() => reopen(r.id)}>
                  {r.title ?? r.question}
                </button>
                {r.title && <span className={styles.hint}> {r.question}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {definition && !ask.isPending && (
        <div className={styles.results}>
          <div>
            <h2 className={styles.sectionTitle}>
              {definition.title}
              {!canAuthor && (
                <span className={styles.notReviewed} data-testid="ask-not-reviewed">
                  Not reviewed
                </span>
              )}
            </h2>
            {!canAuthor && (
              <p className={styles.hint}>
                A report author has not checked this query. Use it to explore, and ask an author to
                save it before relying on it.
              </p>
            )}
            {definition.description && <p className={styles.subtitle}>{definition.description}</p>}
          </div>

          {plan.length > 0 && (
            <div className={styles.planBox}>
              <h3 className={styles.subheading}>Plan</h3>
              <ol className={styles.plainList}>
                {plan.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          {preview && preview.rowCount > 0 && (
            <>
              <HeadlineStrip tiles={tiles} narrative={narrative} />
              <ReportResults
                title={`${definition.title} (preview)`}
                charts={charts}
                columnSpecs={columnSpecs}
                columns={preview.columns}
                rows={preview.rows}
              />
            </>
          )}
          {preview && preview.rowCount === 0 && (
            <p className={styles.note}>The query ran and returned no rows on its defaults.</p>
          )}

          {assumptions.length > 0 && (
            <div>
              <h3 className={styles.subheading}>Claude assumed</h3>
              <p className={styles.hint}>Choose one to change it.</p>
              <div className={styles.chips}>
                {assumptions.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={styles.chip}
                    onClick={() => {
                      setRefinement(`Instead of "${a}": `)
                      refineRef.current?.focus()
                    }}
                  >
                    {a}
                  </button>
                ))}
              </div>
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

          <form className={styles.form} onSubmit={onRefine} noValidate>
            <div className={styles.field}>
              <label htmlFor={`${id}-refine`} className={styles.fieldLabel}>
                Change something
              </label>
              <div className={styles.chips} role="group" aria-label="Quick changes">
                {QUICK_CHANGES.map((change) => (
                  <button
                    key={change}
                    type="button"
                    className={styles.chip}
                    onClick={() => onRefine(undefined, change)}
                  >
                    {change}
                  </button>
                ))}
              </div>
              {fieldErrors.refine && (
                <p id={`${id}-refine-error`} className={styles.fieldError}>
                  {fieldErrors.refine}
                </p>
              )}
              <textarea
                id={`${id}-refine`}
                ref={refineRef}
                className={styles.textarea}
                rows={2}
                maxLength={2000}
                value={refinement}
                onChange={(e) => setRefinement(e.target.value)}
                aria-invalid={fieldErrors.refine ? true : undefined}
                aria-describedby={fieldErrors.refine ? `${id}-refine-error` : undefined}
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

          {canAuthor && (
            <details
              id={`${id}-sql-details`}
              className={styles.sqlDetails}
              open={sqlEdited || errors.length > 0 || undefined}
            >
              <summary>Show the SQL</summary>
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
              </div>
            </details>
          )}

          {canAuthor ? (
            <div className={styles.saveBox}>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => setConfirming(true)}
                  aria-disabled={saveBlocker !== null || save.isPending}
                  aria-expanded={confirming}
                  aria-controls={`${id}-publish`}
                  aria-describedby={saveBlocker ? `${id}-save-blocker` : undefined}
                >
                  {base ? 'Publish the change…' : 'Save and publish…'}
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => onSave(false)}
                  aria-disabled={saveBlocker !== null || save.isPending}
                  aria-describedby={saveBlocker ? `${id}-save-blocker` : undefined}
                >
                  {base ? 'Save as a draft of the report' : 'Save as a draft'}
                </button>
                {saveBlocker && (
                  <span id={`${id}-save-blocker`} className={styles.hint}>
                    {saveBlocker}
                  </span>
                )}
              </div>
              {confirming && !saveBlocker && (
                <fieldset
                  id={`${id}-publish`}
                  className={styles.publishBox}
                  data-testid="ask-publish"
                >
                  <legend className={styles.fieldLabel}>Publish</legend>
                  <div className={styles.field}>
                    <label htmlFor={`${id}-category`} className={styles.fieldLabel}>
                      Area
                    </label>
                    <select
                      id={`${id}-category`}
                      className={styles.input}
                      value={publishCategory}
                      onChange={(e) => setPublishCategory(e.target.value as ReportCategory)}
                    >
                      {REPORT_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <fieldset className={styles.field}>
                    <legend className={styles.fieldLabel}>Who can run it</legend>
                    {REPORT_VIEWER_ROLES.map((role) => (
                      <div key={role} className={styles.checkboxRow}>
                        <input
                          id={`${id}-role-${role}`}
                          type="checkbox"
                          className={styles.checkbox}
                          checked={publishRoles.includes(role)}
                          onChange={(e) =>
                            setPublishRoles((prev) =>
                              e.target.checked ? [...prev, role] : prev.filter((r) => r !== role),
                            )
                          }
                        />
                        <label htmlFor={`${id}-role-${role}`}>
                          {role.charAt(0).toUpperCase() + role.slice(1)}
                        </label>
                      </div>
                    ))}
                  </fieldset>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => onSave(true)}
                      aria-disabled={publishRoles.length === 0 || save.isPending}
                    >
                      Publish
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => setConfirming(false)}
                    >
                      Not yet
                    </button>
                    {publishRoles.length === 0 && (
                      <span className={styles.hint}>Choose at least one role.</span>
                    )}
                  </div>
                </fieldset>
              )}
              {saved && (
                <p className={styles.note} data-testid="ask-saved">
                  {saved.published ? 'Published.' : 'Saved as an unpublished draft.'}{' '}
                  <Link className={styles.textLink} href={`/admin/reports/${saved.slug}`}>
                    Open the report
                  </Link>
                  {!saved.published && '. Publish it from here or from the report when ready.'}
                </p>
              )}
            </div>
          ) : (
            <p className={styles.note}>
              Only report authors (supervisors and admins) can save reports. Send them your question
              if this is worth keeping.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
