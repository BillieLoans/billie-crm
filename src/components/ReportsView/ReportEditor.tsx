'use client'

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  CHART_TYPES,
  COLUMN_FORMATS,
  HEADLINE_VALUES,
  REPORT_CATEGORIES,
  REPORT_VIEWER_ROLES,
  RESERVED_REPORT_SLUGS,
  chartsSchema,
  columnSpecsSchema,
  headlineSpecsSchema,
  reportParametersSchema,
  type ChartSpec,
  type ColumnSpec,
  type HeadlineSpec,
  type ReportCategory,
  type ReportColumn,
  type ReportParameter,
  type ReportViewerRole,
} from '@/lib/schemas/reports'
import { resolveColumns } from '@/lib/reports/columns'
import { buildNarrative, computeHeadline } from '@/lib/reports/headline'
import { changedFields, lineDiff, type DiffLine } from '@/lib/reports/diff'
import { reportsKeys, type ReportSummary } from '@/hooks/queries/useReports'
import { loadReportDefinition } from '@/hooks/mutations/useAskClaude'
import type { DraftPreview } from '@/server/reporting/ask/draft'
import type { ValidationIssue } from '@/server/reporting/ask/validate'
import { HeadlineStrip } from './HeadlineStrip'
import { ReportResults } from './ReportResults'
import { SqlEditor } from './SqlEditor'
import styles from './styles.module.css'

const PARAMETER_TYPES = ['date', 'text', 'integer', 'number', 'select', 'boolean'] as const
const FORMAT_LABELS: Record<string, string> = {
  number: 'Number',
  integer: 'Whole number',
  percent: 'Percentage (0–1)',
  percent100: 'Percentage (0–100)',
  currency: 'Dollars (AUD)',
  usd: 'US dollars',
  hours: 'Hours',
  days: 'Days',
  date: 'Date',
  text: 'Text',
}
const CHART_LABELS: Record<ChartSpec['type'], string> = {
  line: 'Line (over time)',
  area: 'Area (over time)',
  bar: 'Bars',
  'bar-horizontal': 'Bars, ranked (horizontal)',
  'stacked-100': 'Mix as shares of 100%',
}

export interface EditorDraft {
  title: string
  slug: string
  description: string
  category: ReportCategory
  featured: boolean
  roles: ReportViewerRole[]
  schedule: 'none' | 'weekly_monday'
  sql: string
  parameters: ReportParameter[]
  charts: ChartSpec[]
  headline: HeadlineSpec[]
  columnSettings: ColumnSpec[]
}

const EMPTY: EditorDraft = {
  title: '',
  slug: '',
  description: '',
  category: 'other',
  featured: false,
  roles: ['admin', 'supervisor'],
  schedule: 'none',
  sql: '',
  parameters: [
    { name: 'from', label: 'From', type: 'date', required: true, default: 'today-30' },
    { name: 'to', label: 'To', type: 'date', required: true, default: 'today-1' },
  ],
  charts: [],
  headline: [],
  columnSettings: [],
}

export function slugFromTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50)
      .replace(/^-+|-+$/g, '') || ''
  )
}

const NUMBER_RE = /^-?\d+(\.\d+)?$/

/**
 * A number parameter's default is typed as text (so "0." and "-" can be
 * typed on the way to a number); stored as a number when it is one.
 */
function numericDefault(p: ReportParameter): ReportParameter {
  if ((p.type === 'integer' || p.type === 'number') && typeof p.default === 'string') {
    const text = p.default.trim()
    if (text === '') return { ...p, default: undefined }
    if (NUMBER_RE.test(text)) return { ...p, default: Number(text) }
  }
  return p
}

/** What the report-definitions collection stores, from the editor's state. */
export function toDocument(draft: EditorDraft): Record<string, unknown> {
  return {
    title: draft.title.trim(),
    slug: draft.slug,
    description: draft.description.trim(),
    category: draft.category,
    featured: draft.featured,
    roles: draft.roles,
    schedule: draft.schedule,
    sql: draft.sql,
    parameters: draft.parameters.map(numericDefault),
    chart: draft.charts.length === 0 ? null : draft.charts,
    headline: draft.headline,
    columnSettings: draft.columnSettings,
  }
}

/** Problems that stop a save, before the server's own checks. */
export function draftProblems(draft: EditorDraft): string[] {
  const problems: string[] = []
  if (!draft.title.trim()) problems.push('Give the report a title')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug)) {
    problems.push('Give the report a link: lower case letters, digits and single hyphens')
  } else if (RESERVED_REPORT_SLUGS.includes(draft.slug)) {
    problems.push(`The link "${draft.slug}" is taken by Reports itself: choose another`)
  }
  if (!draft.sql.trim()) problems.push('Write the SQL')
  if (draft.roles.length === 0) problems.push('Choose who can run it')
  for (const p of draft.parameters.map(numericDefault)) {
    if ((p.type === 'integer' || p.type === 'number') && typeof p.default === 'string') {
      problems.push(`Parameters: the default for ${p.label || p.name} is not a number`)
    }
  }
  const params = reportParametersSchema.safeParse(draft.parameters.map(numericDefault))
  if (!params.success) problems.push(`Parameters: ${params.error.issues[0]?.message}`)
  if (draft.charts.length && !chartsSchema.safeParse(draft.charts).success) {
    problems.push('Charts: each needs a category axis and at least one series')
  }
  const headline = headlineSpecsSchema.safeParse(draft.headline)
  if (!headline.success) problems.push(`Headline: ${headline.error.issues[0]?.message}`)
  if (!columnSpecsSchema.safeParse(draft.columnSettings).success) {
    problems.push('Column settings are not valid')
  }
  return problems
}

/**
 * The editor's state from a stored definition, and the settings it could
 * not read (stored before a schema change, or hand-edited): those load
 * empty, and the editor says that saving replaces them.
 */
export function readDoc(doc: Record<string, unknown>): {
  draft: EditorDraft
  unreadable: string[]
} {
  const params = reportParametersSchema.safeParse(doc.parameters ?? [])
  const charts = chartsSchema.safeParse(doc.chart)
  const headline = headlineSpecsSchema.safeParse(doc.headline ?? [])
  const columns = columnSpecsSchema.safeParse(doc.columnSettings ?? [])
  const unreadable = [
    !params.success && 'parameters',
    doc.chart != null && !charts.success && 'charts',
    !headline.success && 'headline numbers',
    !columns.success && 'column settings',
  ].filter((x): x is string => Boolean(x))
  const draft: EditorDraft = {
    title: String(doc.title ?? ''),
    slug: String(doc.slug ?? ''),
    description: String(doc.description ?? ''),
    category: (doc.category as ReportCategory) ?? 'other',
    featured: doc.featured === true,
    roles: ((doc.roles as ReportViewerRole[]) ?? []).filter((r) =>
      (REPORT_VIEWER_ROLES as readonly string[]).includes(r),
    ),
    schedule: doc.schedule === 'weekly_monday' ? 'weekly_monday' : 'none',
    sql: String(doc.sql ?? ''),
    parameters: params.success ? params.data : [],
    charts: charts.success ? [charts.data].flat() : [],
    headline: headline.success ? headline.data : [],
    columnSettings: columns.success ? columns.data : [],
  }
  return { draft, unreadable }
}

export function fromDoc(doc: Record<string, unknown>): EditorDraft {
  return readDoc(doc).draft
}

/**
 * A definition as the collection would store it (parameters normalised, one
 * chart as a list), so the published version and the edit compare like for
 * like.
 */
export function comparable(doc: Record<string, unknown>): Record<string, unknown> {
  return toDocument(fromDoc(doc))
}

/** "a = A" lines for a select's options. */
function optionsText(options: ReportParameter['options']): string {
  return (options ?? []).map((o) => `${o.value} = ${o.label}`).join('\n')
}

function parseOptions(text: string): ReportParameter['options'] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, ...label] = line.split('=')
      const v = value.trim()
      return { value: v, label: label.join('=').trim() || v }
    })
}

/** Payload's error for a failed save, as one sentence. */
async function payloadError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    errors?: Array<{
      message?: string
      data?: { errors?: Array<{ message?: string; path?: string }> }
    }>
  } | null
  const first = body?.errors?.[0]
  const field = first?.data?.errors?.[0]
  if (field?.message) return `${field.path ? `${field.path}: ` : ''}${field.message}`
  return first?.message ?? 'The report could not be saved. Try again.'
}

interface PreviewOutcome {
  issues: ValidationIssue[]
  preview: DraftPreview | null
}

export interface ReportEditorProps {
  /** The report to edit; absent for a new one. */
  slug?: string
  reports: ReportSummary[]
}

/**
 * The report editor (authors): settings, the SQL with highlighting, form
 * builders for parameters, charts, headline and column settings, and a
 * live preview that redraws as the presentation changes. Saves a draft, or
 * publishes after showing what changed against the published version.
 */
export function ReportEditor({ slug, reports }: ReportEditorProps) {
  const id = useId().replace(/:/g, '')
  const router = useRouter()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<EditorDraft>(EMPTY)
  const [docId, setDocId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(!slug)
  const [slugTouched, setSlugTouched] = useState(Boolean(slug))
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState<DraftPreview | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [review, setReview] = useState<{ fields: string[]; sql: DiffLine[] | null } | null>(null)
  const [unreadable, setUnreadable] = useState<string[]>([])
  const summaryRef = useRef<HTMLDivElement>(null)
  // Only the latest preview's answer is shown; one save at a time.
  const previewSeq = useRef(0)
  const busy = useRef(false)
  // Stable keys for the parameter rows, kept in step with moves and removals.
  const nextKey = useRef(EMPTY.parameters.length)
  const [paramKeys, setParamKeys] = useState<number[]>(() => EMPTY.parameters.map((_, i) => i))

  const update = useCallback(<K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setDirty(true)
    // A review shows what would be published; any change makes it stale.
    setReview(null)
  }, [])

  /** Check and preview a definition (the Ask Claude check: no Claude call). */
  const runPreview = useCallback(async (current: EditorDraft): Promise<PreviewOutcome | null> => {
    const seq = ++previewSeq.current
    setRunning(true)
    setMessage('Running the preview…')
    try {
      const res = await fetch('/api/reports/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mode: 'check',
          question: `Report editor: ${current.title.trim() || current.slug || 'new report'}`,
          definition: toDocument(current),
        }),
      })
      const body = (await res.json().catch(() => null)) as {
        issues?: ValidationIssue[]
        preview?: DraftPreview | null
        error?: { message?: string }
      } | null
      if (seq !== previewSeq.current) return null
      if (!res.ok) {
        setIssues([
          {
            level: 'error',
            code: 'PREVIEW',
            message: body?.error?.message ?? 'The preview failed.',
          },
        ])
        setPreview(null)
        setMessage('The preview did not run.')
        return null
      }
      const outcome = { issues: body?.issues ?? [], preview: body?.preview ?? null }
      setIssues(outcome.issues)
      setPreview(outcome.preview)
      setMessage(
        body?.preview
          ? `Preview: ${body.preview.rowCount} row${body.preview.rowCount === 1 ? '' : 's'} on the defaults.`
          : 'The preview did not run. See the problems.',
      )
      return outcome
    } catch {
      if (seq !== previewSeq.current) return null
      setPreview(null)
      setMessage('The preview could not reach the server. Try again.')
      return null
    } finally {
      if (seq === previewSeq.current) setRunning(false)
    }
  }, [])

  // Load the report being edited (its latest version, draft or published).
  useEffect(() => {
    if (!slug) return
    let cancelled = false
    void loadReportDefinition(slug).then((doc) => {
      if (cancelled) return
      if (!doc) {
        setMessage('That report could not be loaded.')
        setLoaded(true)
        return
      }
      const { draft: next, unreadable: lost } = readDoc(doc as unknown as Record<string, unknown>)
      setDraft(next)
      setUnreadable(lost)
      setParamKeys(next.parameters.map(() => nextKey.current++))
      setDocId(doc.id)
      setLoaded(true)
      void runPreview(next)
    })
    return () => {
      cancelled = true
    }
  }, [slug, runPreview])

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    // Links inside the app change page without unloading: ask first.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      const link = (e.target as Element | null)?.closest?.('a[href]')
      if (!link || link.getAttribute('target') === '_blank') return
      if (!window.confirm('Leave the editor? Your changes are not saved.')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty])

  const columns: ReportColumn[] = preview?.columns ?? []
  const numeric = columns.filter((c) => c.kind === 'number').map((c) => c.name)
  const views = useMemo(
    () => (preview ? resolveColumns(preview.columns, draft.columnSettings) : []),
    [preview, draft.columnSettings],
  )
  const tiles = useMemo(
    () => (preview ? computeHeadline(draft.headline, views, preview.columns, preview.rows) : []),
    [preview, draft.headline, views],
  )
  const narrative = useMemo(
    () => (preview ? buildNarrative(tiles, views, preview.columns, preview.rows) : ''),
    [preview, tiles, views],
  )
  const validCharts = draft.charts.filter((c) => chartsSchema.safeParse(c).success)

  const save = async (publish: boolean) => {
    const found = draftProblems(draft)
    setProblems(found)
    if (found.length) {
      setTimeout(() => summaryRef.current?.focus(), 0)
      return
    }
    if (busy.current) return
    busy.current = true
    setSaving(true)
    setMessage(publish ? 'Publishing…' : 'Saving the draft…')
    try {
      const data = { ...toDocument(draft), _status: publish ? 'published' : 'draft' }
      const res = await fetch(
        docId
          ? `/api/report-definitions/${docId}${publish ? '' : '?draft=true'}`
          : `/api/report-definitions${publish ? '' : '?draft=true'}`,
        {
          method: docId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(data),
        },
      )
      if (!res.ok) {
        setProblems([await payloadError(res)])
        setMessage('')
        setTimeout(() => summaryRef.current?.focus(), 0)
        return
      }
      const body = (await res.json().catch(() => null)) as { doc?: { id?: string } } | null
      if (body?.doc?.id) setDocId(String(body.doc.id))
      setDirty(false)
      setReview(null)
      setProblems([])
      await queryClient.invalidateQueries({ queryKey: reportsKeys.all })
      setMessage(publish ? 'Published.' : 'Draft saved. Viewers still see the published version.')
      if (publish) router.push(`/admin/reports/${draft.slug}`)
      // A new report's draft now has a link of its own.
      else if (!slug) router.replace(`/admin/reports/${draft.slug}/edit`)
    } catch {
      setMessage('')
      setProblems(['The report could not be saved: the server did not answer. Try again.'])
      setTimeout(() => summaryRef.current?.focus(), 0)
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  const startPublish = async () => {
    const found = draftProblems(draft)
    setProblems(found)
    if (found.length) {
      setTimeout(() => summaryRef.current?.focus(), 0)
      return
    }
    if (busy.current) return
    busy.current = true
    try {
      // The same checks a Claude draft must pass before it can be published.
      const checked = await runPreview(draft)
      const blocking = checked
        ? checked.issues.filter((i) => i.level === 'error').map((i) => i.message)
        : ['The checks did not run, so the report cannot be published yet. Try again.']
      if (checked && !checked.preview && blocking.length === 0) {
        blocking.push('The query did not run on its defaults, so it cannot be published yet.')
      }
      if (blocking.length) {
        setProblems(blocking)
        setTimeout(() => summaryRef.current?.focus(), 0)
        return
      }
      // 404: never published. Any other failure: no review, rather than an empty one.
      let published: Record<string, unknown> | null = null
      if (slug) {
        const res = await fetch(
          `/api/reports/${encodeURIComponent(slug)}/definition?version=published`,
          { credentials: 'include' },
        ).catch(() => null)
        if (res?.ok) published = (await res.json()) as Record<string, unknown>
        else if (res?.status !== 404) {
          setProblems(['The published version could not be loaded to compare. Try again.'])
          setTimeout(() => summaryRef.current?.focus(), 0)
          return
        }
      }
      setReview({
        fields: changedFields(published && comparable(published), comparable(toDocument(draft))),
        sql: published ? lineDiff(String(published.sql ?? ''), draft.sql) : null,
      })
    } finally {
      busy.current = false
    }
  }

  if (!loaded) return <p className={styles.note}>Loading the report…</p>

  const setParam = (i: number, change: Partial<ReportParameter>) =>
    update(
      'parameters',
      draft.parameters.map((p, j) => (j === i ? ({ ...p, ...change } as ReportParameter) : p)),
    )
  const move = <T,>(list: T[], i: number, by: number): T[] => {
    const next = [...list]
    const [item] = next.splice(i, 1)
    next.splice(i + by, 0, item)
    return next
  }
  const moveParam = (i: number, by: number) => {
    update('parameters', move(draft.parameters, i, by))
    setParamKeys((keys) => move(keys, i, by))
  }
  const removeParam = (i: number) => {
    update(
      'parameters',
      draft.parameters.filter((_, j) => j !== i),
    )
    setParamKeys((keys) => keys.filter((_, j) => j !== i))
  }
  const addParam = () => {
    update('parameters', [
      ...draft.parameters,
      {
        name: `param_${draft.parameters.length + 1}`,
        label: 'New parameter',
        type: 'text',
        required: false,
      },
    ])
    setParamKeys((keys) => [...keys, nextKey.current++])
  }
  const setChart = (i: number, change: Partial<ChartSpec>) =>
    update(
      'charts',
      draft.charts.map((c, j) => (j === i ? { ...c, ...change } : c)),
    )
  const setHeadline = (i: number, change: Partial<HeadlineSpec>) =>
    update(
      'headline',
      draft.headline.map((h, j) => (j === i ? { ...h, ...change } : h)),
    )
  const setColumn = (name: string, change: Partial<ColumnSpec>) => {
    const existing = draft.columnSettings.find((c) => c.name === name) ?? { name }
    const merged = Object.fromEntries(
      Object.entries({ ...existing, ...change }).filter(([, v]) => v !== undefined && v !== ''),
    ) as ColumnSpec
    const rest = draft.columnSettings.filter((c) => c.name !== name)
    update('columnSettings', Object.keys(merged).length > 1 ? [...rest, merged] : rest)
  }
  const drillTargets = reports.filter((r) => r.published && r.slug !== slug)

  return (
    <section aria-labelledby={`${id}-title`} data-testid="report-editor">
      <header className={styles.header}>
        <h1 id={`${id}-title`} className={styles.title}>
          {slug ? `Edit "${draft.title || slug}"` : 'New report'}
        </h1>
        <p className={styles.subtitle}>
          Write the SQL, run the preview (Ctrl+Enter), then shape how it reads. Viewers see the
          published version until you publish.
        </p>
        {slug && (
          <div className={styles.builderActions}>
            <Link className={styles.textLink} href={`/admin/reports/${slug}`}>
              Back to the report
            </Link>
            <Link className={styles.textLink} href={`/admin/reports/ask?from=${slug}`}>
              Ask Claude to change it
            </Link>
            {docId && (
              <Link
                className={styles.textLink}
                href={`/admin/collections/report-definitions/${docId}`}
              >
                Versions and history
              </Link>
            )}
          </div>
        )}
      </header>

      {problems.length > 0 && (
        <div
          ref={summaryRef}
          className={styles.errorSummary}
          role="alert"
          tabIndex={-1}
          data-testid="editor-problems"
        >
          <h2 className={styles.errorSummaryTitle}>There is a problem</h2>
          <ul className={styles.errorSummaryList}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {unreadable.length > 0 && (
        <div className={styles.warning} role="status" data-testid="editor-unreadable">
          The stored {unreadable.join(', ')} could not be read and are shown empty. Saving replaces
          them; to keep them, fix them under Versions and history instead.
        </div>
      )}

      <div className={styles.editorGrid}>
        <div className={styles.editorColumn}>
          <fieldset className={styles.editorSection}>
            <legend>About the report</legend>
            <div className={styles.field}>
              <label htmlFor={`${id}-name`} className={styles.fieldLabel}>
                Title
              </label>
              <input
                id={`${id}-name`}
                className={styles.input}
                value={draft.title}
                maxLength={120}
                onChange={(e) => {
                  update('title', e.target.value)
                  if (!slugTouched) update('slug', slugFromTitle(e.target.value))
                }}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor={`${id}-slug`} className={styles.fieldLabel}>
                Link
              </label>
              <p id={`${id}-slug-hint`} className={styles.hint}>
                /admin/reports/{draft.slug || '…'}
                {slug ? ' (cannot change once created)' : ''}
              </p>
              <input
                id={`${id}-slug`}
                className={styles.input}
                value={draft.slug}
                disabled={Boolean(slug)}
                aria-describedby={`${id}-slug-hint`}
                onChange={(e) => {
                  setSlugTouched(true)
                  update('slug', e.target.value)
                }}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor={`${id}-desc`} className={styles.fieldLabel}>
                Description
              </label>
              <p id={`${id}-desc-hint`} className={styles.hint}>
                The first sentence shows under the title; the rest goes under &ldquo;About this
                report&rdquo;.
              </p>
              <textarea
                id={`${id}-desc`}
                className={styles.textarea}
                rows={3}
                maxLength={1000}
                value={draft.description}
                aria-describedby={`${id}-desc-hint`}
                onChange={(e) => update('description', e.target.value)}
              />
            </div>
            <div className={styles.paramGrid}>
              <div className={styles.field}>
                <label htmlFor={`${id}-cat`} className={styles.fieldLabel}>
                  Area
                </label>
                <select
                  id={`${id}-cat`}
                  className={styles.input}
                  value={draft.category}
                  onChange={(e) => update('category', e.target.value as ReportCategory)}
                >
                  {REPORT_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor={`${id}-schedule`} className={styles.fieldLabel}>
                  Email to supervisors
                </label>
                <select
                  id={`${id}-schedule`}
                  className={styles.input}
                  value={draft.schedule}
                  onChange={(e) => update('schedule', e.target.value as EditorDraft['schedule'])}
                >
                  <option value="none">Not scheduled</option>
                  <option value="weekly_monday">Weekly, Monday morning</option>
                </select>
              </div>
            </div>
            <fieldset className={styles.field}>
              <legend className={styles.fieldLabel}>Who can run it</legend>
              <div className={styles.builderActions}>
                {REPORT_VIEWER_ROLES.map((role) => (
                  <div key={role} className={styles.checkboxRow}>
                    <input
                      id={`${id}-role-${role}`}
                      type="checkbox"
                      className={styles.checkbox}
                      checked={draft.roles.includes(role)}
                      onChange={(e) =>
                        update(
                          'roles',
                          e.target.checked
                            ? [...draft.roles, role]
                            : draft.roles.filter((r) => r !== role),
                        )
                      }
                    />
                    <label htmlFor={`${id}-role-${role}`}>
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </label>
                  </div>
                ))}
              </div>
            </fieldset>
            <div className={styles.checkboxRow}>
              <input
                id={`${id}-featured`}
                type="checkbox"
                className={styles.checkbox}
                checked={draft.featured}
                onChange={(e) => update('featured', e.target.checked)}
              />
              <label htmlFor={`${id}-featured`}>
                Show its first headline number on the Reports home
              </label>
            </div>
          </fieldset>

          <fieldset className={styles.editorSection}>
            <legend>SQL</legend>
            <p id={`${id}-sql-hint`} className={styles.hint}>
              One SELECT or WITH over the reporting schema. Parameter 1 is $1, parameter 2 is $2,
              and so on, in the order below.
            </p>
            <SqlEditor
              id={`${id}-sql`}
              label="Report SQL"
              value={draft.sql}
              describedBy={`${id}-sql-hint`}
              onChange={(value) => update('sql', value)}
              onRun={() => void runPreview(draft)}
            />
            <div className={styles.builderActions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void runPreview(draft)}
                aria-disabled={running}
              >
                Run the preview
              </button>
            </div>
          </fieldset>

          <fieldset className={styles.editorSection}>
            <legend>Parameters</legend>
            {draft.parameters.map((p, i) => (
              <div
                key={paramKeys[i] ?? `p${i}`}
                className={styles.builderRow}
                data-testid={`param-${i}`}
              >
                <div className={styles.field}>
                  <label htmlFor={`${id}-p${i}-name`} className={styles.fieldLabel}>
                    ${i + 1} name
                  </label>
                  <input
                    id={`${id}-p${i}-name`}
                    className={styles.input}
                    value={p.name}
                    onChange={(e) => setParam(i, { name: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${id}-p${i}-label`} className={styles.fieldLabel}>
                    Label
                  </label>
                  <input
                    id={`${id}-p${i}-label`}
                    className={styles.input}
                    value={p.label}
                    onChange={(e) => setParam(i, { label: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${id}-p${i}-type`} className={styles.fieldLabel}>
                    Type
                  </label>
                  <select
                    id={`${id}-p${i}-type`}
                    className={styles.input}
                    value={p.type}
                    onChange={(e) =>
                      setParam(i, { type: e.target.value as ReportParameter['type'] })
                    }
                  >
                    {PARAMETER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${id}-p${i}-default`} className={styles.fieldLabel}>
                    Default
                  </label>
                  {p.type === 'boolean' ? (
                    <select
                      id={`${id}-p${i}-default`}
                      className={styles.input}
                      value={p.default === undefined ? '' : String(p.default === true)}
                      onChange={(e) =>
                        setParam(i, {
                          default: e.target.value === '' ? undefined : e.target.value === 'true',
                        })
                      }
                    >
                      <option value="">None</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <input
                      id={`${id}-p${i}-default`}
                      className={styles.input}
                      inputMode={
                        p.type === 'integer' || p.type === 'number' ? 'decimal' : undefined
                      }
                      placeholder={p.type === 'date' ? 'today-30' : ''}
                      value={p.default === undefined ? '' : String(p.default)}
                      // Kept as typed; a number default is stored as a number on save.
                      onChange={(e) =>
                        setParam(i, {
                          default: e.target.value === '' ? undefined : e.target.value,
                        })
                      }
                    />
                  )}
                </div>
                <div className={styles.checkboxRow}>
                  <input
                    id={`${id}-p${i}-req`}
                    type="checkbox"
                    className={styles.checkbox}
                    checked={p.required !== false}
                    onChange={(e) => setParam(i, { required: e.target.checked })}
                  />
                  <label htmlFor={`${id}-p${i}-req`}>Required</label>
                </div>
                {p.type === 'select' && (
                  <div className={styles.field}>
                    <label htmlFor={`${id}-p${i}-opts`} className={styles.fieldLabel}>
                      Options, one per line: value = Label
                    </label>
                    <textarea
                      id={`${id}-p${i}-opts`}
                      className={styles.textarea}
                      rows={3}
                      defaultValue={optionsText(p.options)}
                      onBlur={(e) => setParam(i, { options: parseOptions(e.target.value) })}
                    />
                  </div>
                )}
                <div className={styles.builderActions}>
                  <button
                    type="button"
                    className={styles.linkButton}
                    disabled={i === 0}
                    onClick={() => moveParam(i, -1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className={styles.linkButton}
                    disabled={i === draft.parameters.length - 1}
                    onClick={() => moveParam(i, 1)}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => removeParam(i)}
                  >
                    Remove {p.label || `parameter ${i + 1}`}
                  </button>
                </div>
              </div>
            ))}
            <div className={styles.builderActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={draft.parameters.length >= 10}
                onClick={addParam}
              >
                Add a parameter
              </button>
            </div>
          </fieldset>

          <fieldset className={styles.editorSection}>
            <legend>Charts</legend>
            {!preview && <p className={styles.hint}>Run the preview to choose columns.</p>}
            {draft.charts.map((chart, i) => (
              <div key={i} className={styles.builderRow} data-testid={`chart-${i}`}>
                <div className={styles.field}>
                  <label htmlFor={`${id}-c${i}-type`} className={styles.fieldLabel}>
                    Chart {i + 1}
                  </label>
                  <select
                    id={`${id}-c${i}-type`}
                    className={styles.input}
                    value={chart.type}
                    onChange={(e) => setChart(i, { type: e.target.value as ChartSpec['type'] })}
                  >
                    {CHART_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {CHART_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${id}-c${i}-x`} className={styles.fieldLabel}>
                    Category or time axis
                  </label>
                  <select
                    id={`${id}-c${i}-x`}
                    className={styles.input}
                    value={chart.x}
                    onChange={(e) => setChart(i, { x: e.target.value })}
                  >
                    <option value="">Choose…</option>
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                    {chart.x && !columns.some((c) => c.name === chart.x) && (
                      <option value={chart.x}>{chart.x}</option>
                    )}
                  </select>
                </div>
                <fieldset className={styles.field}>
                  <legend className={styles.fieldLabel}>Series</legend>
                  {[...new Set([...numeric, ...chart.series.map((s) => s.column)])].map((col) => {
                    const on = chart.series.some((s) => s.column === col)
                    return (
                      <div key={col} className={styles.checkboxRow}>
                        <input
                          id={`${id}-c${i}-s-${col}`}
                          type="checkbox"
                          className={styles.checkbox}
                          checked={on}
                          onChange={(e) =>
                            setChart(i, {
                              series: e.target.checked
                                ? [...chart.series, { column: col }]
                                : chart.series.filter((s) => s.column !== col),
                            })
                          }
                        />
                        <label htmlFor={`${id}-c${i}-s-${col}`}>{col}</label>
                      </div>
                    )
                  })}
                </fieldset>
                {(chart.type === 'bar' || chart.type === 'area') && (
                  <div className={styles.checkboxRow}>
                    <input
                      id={`${id}-c${i}-stacked`}
                      type="checkbox"
                      className={styles.checkbox}
                      checked={chart.stacked === true}
                      onChange={(e) => setChart(i, { stacked: e.target.checked || undefined })}
                    />
                    <label htmlFor={`${id}-c${i}-stacked`}>Stacked</label>
                  </div>
                )}
                <div className={styles.field}>
                  <label htmlFor={`${id}-c${i}-sort`} className={styles.fieldLabel}>
                    Order of categories
                  </label>
                  <select
                    id={`${id}-c${i}-sort`}
                    className={styles.input}
                    value={chart.sort ?? 'value'}
                    onChange={(e) =>
                      setChart(i, { sort: e.target.value === 'none' ? 'none' : undefined })
                    }
                  >
                    <option value="value">Largest first</option>
                    <option value="none">As the query returns them</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${id}-c${i}-avg`} className={styles.fieldLabel}>
                    Rolling average (days, daily lines)
                  </label>
                  <input
                    id={`${id}-c${i}-avg`}
                    className={styles.input}
                    inputMode="numeric"
                    placeholder="7 when longer than 3 weeks"
                    value={chart.rollingAverage === undefined ? '' : String(chart.rollingAverage)}
                    onChange={(e) =>
                      setChart(i, {
                        rollingAverage:
                          e.target.value === '' ? undefined : Number(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${id}-c${i}-drill`} className={styles.fieldLabel}>
                    Clicking a category opens
                  </label>
                  <select
                    id={`${id}-c${i}-drill`}
                    className={styles.input}
                    value={chart.drill?.report ?? ''}
                    onChange={(e) => {
                      const target = drillTargets.find((r) => r.slug === e.target.value)
                      const param = target?.parameters.find(
                        (p) => p.type === 'select' || p.type === 'text',
                      )
                      setChart(i, {
                        drill:
                          target && param
                            ? { report: target.slug, parameter: param.name }
                            : undefined,
                      })
                    }}
                  >
                    <option value="">Nothing</option>
                    {drillTargets
                      .filter((r) =>
                        r.parameters.some((p) => p.type === 'select' || p.type === 'text'),
                      )
                      .map((r) => (
                        <option key={r.slug} value={r.slug}>
                          {r.title}
                        </option>
                      ))}
                  </select>
                </div>
                {chart.drill && (
                  <div className={styles.field}>
                    <label htmlFor={`${id}-c${i}-drillp`} className={styles.fieldLabel}>
                      With the category as
                    </label>
                    <select
                      id={`${id}-c${i}-drillp`}
                      className={styles.input}
                      value={chart.drill.parameter}
                      onChange={(e) =>
                        setChart(i, {
                          drill: { report: chart.drill!.report, parameter: e.target.value },
                        })
                      }
                    >
                      {(drillTargets.find((r) => r.slug === chart.drill!.report)?.parameters ?? [])
                        .filter((p) => p.type === 'select' || p.type === 'text')
                        .map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.label}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                <div className={styles.builderActions}>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() =>
                      update(
                        'charts',
                        draft.charts.filter((_, j) => j !== i),
                      )
                    }
                  >
                    Remove chart {i + 1}
                  </button>
                </div>
              </div>
            ))}
            <div className={styles.builderActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={draft.charts.length >= 2}
                onClick={() =>
                  update('charts', [
                    ...draft.charts,
                    {
                      type: columns[0]?.kind === 'date' ? 'line' : 'bar',
                      x: columns[0]?.name ?? '',
                      series: numeric.slice(0, 1).map((column) => ({ column })),
                    },
                  ])
                }
              >
                Add a chart
              </button>
            </div>
          </fieldset>

          <fieldset className={styles.editorSection}>
            <legend>Headline numbers</legend>
            {draft.headline.map((h, i) => (
              <div key={i} className={styles.builderRow} data-testid={`headline-${i}`}>
                <div className={styles.field}>
                  <label htmlFor={`${id}-h${i}-col`} className={styles.fieldLabel}>
                    Number {i + 1}
                  </label>
                  <select
                    id={`${id}-h${i}-col`}
                    className={styles.input}
                    value={h.column}
                    onChange={(e) => setHeadline(i, { column: e.target.value })}
                  >
                    {[...new Set([...numeric, h.column])].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${id}-h${i}-label`} className={styles.fieldLabel}>
                    Label
                  </label>
                  <input
                    id={`${id}-h${i}-label`}
                    className={styles.input}
                    value={h.label ?? ''}
                    onChange={(e) => setHeadline(i, { label: e.target.value || undefined })}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor={`${id}-h${i}-value`} className={styles.fieldLabel}>
                    Value
                  </label>
                  <select
                    id={`${id}-h${i}-value`}
                    className={styles.input}
                    value={h.value ?? 'total'}
                    onChange={(e) =>
                      setHeadline(i, { value: e.target.value as HeadlineSpec['value'] })
                    }
                  >
                    {HEADLINE_VALUES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                {h.value === 'ratio' &&
                  (['numerator', 'denominator'] as const).map((side) => (
                    <div key={side} className={styles.field}>
                      <label htmlFor={`${id}-h${i}-${side}`} className={styles.fieldLabel}>
                        {side === 'numerator' ? 'Count on top' : 'Count underneath'}
                      </label>
                      <select
                        id={`${id}-h${i}-${side}`}
                        className={styles.input}
                        value={h[side] ?? ''}
                        onChange={(e) => setHeadline(i, { [side]: e.target.value || undefined })}
                      >
                        <option value="">Choose…</option>
                        {numeric.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                <div className={styles.field}>
                  <label htmlFor={`${id}-h${i}-better`} className={styles.fieldLabel}>
                    A rise is
                  </label>
                  <select
                    id={`${id}-h${i}-better`}
                    className={styles.input}
                    value={h.better ?? ''}
                    onChange={(e) =>
                      setHeadline(i, {
                        better: (e.target.value || undefined) as HeadlineSpec['better'],
                      })
                    }
                  >
                    <option value="">Neither good nor bad</option>
                    <option value="higher">Good news</option>
                    <option value="lower">Bad news</option>
                  </select>
                </div>
                <div className={styles.builderActions}>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() =>
                      update(
                        'headline',
                        draft.headline.filter((_, j) => j !== i),
                      )
                    }
                  >
                    Remove number {i + 1}
                  </button>
                </div>
              </div>
            ))}
            <div className={styles.builderActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={draft.headline.length >= 4 || numeric.length === 0}
                onClick={() =>
                  update('headline', [...draft.headline, { column: numeric[0], value: 'total' }])
                }
              >
                Add a headline number
              </button>
            </div>
          </fieldset>

          {columns.length > 0 && (
            <fieldset className={styles.editorSection}>
              <legend>Columns</legend>
              <p className={styles.hint}>
                Formats follow the column names unless you choose one. A rate&apos;s base is the
                count it is a share of; rates on fewer cases than the threshold are flagged.
              </p>
              {columns.map((col) => {
                const spec = draft.columnSettings.find((c) => c.name === col.name)
                return (
                  <div
                    key={col.name}
                    className={styles.builderRow}
                    data-testid={`column-${col.name}`}
                  >
                    <div className={styles.field}>
                      <label htmlFor={`${id}-col-${col.name}-label`} className={styles.fieldLabel}>
                        {col.name}: heading
                      </label>
                      <input
                        id={`${id}-col-${col.name}-label`}
                        className={styles.input}
                        placeholder={views.find((v) => v.name === col.name)?.label}
                        value={spec?.label ?? ''}
                        onChange={(e) =>
                          setColumn(col.name, { label: e.target.value || undefined })
                        }
                      />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`${id}-col-${col.name}-format`} className={styles.fieldLabel}>
                        Format
                      </label>
                      <select
                        id={`${id}-col-${col.name}-format`}
                        className={styles.input}
                        value={spec?.format ?? ''}
                        onChange={(e) =>
                          setColumn(col.name, {
                            format: (e.target.value || undefined) as ColumnSpec['format'],
                          })
                        }
                      >
                        <option value="">From the name</option>
                        {COLUMN_FORMATS.map((f) => (
                          <option key={f} value={f}>
                            {FORMAT_LABELS[f]}
                          </option>
                        ))}
                      </select>
                    </div>
                    {col.kind === 'number' && (
                      <div className={styles.field}>
                        <label htmlFor={`${id}-col-${col.name}-base`} className={styles.fieldLabel}>
                          Rate of
                        </label>
                        <select
                          id={`${id}-col-${col.name}-base`}
                          className={styles.input}
                          value={spec?.base ?? ''}
                          onChange={(e) =>
                            setColumn(col.name, { base: e.target.value || undefined })
                          }
                        >
                          <option value="">Not a rate, or no count</option>
                          {numeric
                            .filter((c) => c !== col.name)
                            .map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                    <div className={styles.field}>
                      <label htmlFor={`${id}-col-${col.name}-desc`} className={styles.fieldLabel}>
                        What it means
                      </label>
                      <input
                        id={`${id}-col-${col.name}-desc`}
                        className={styles.input}
                        maxLength={300}
                        value={spec?.description ?? ''}
                        onChange={(e) =>
                          setColumn(col.name, { description: e.target.value || undefined })
                        }
                      />
                    </div>
                  </div>
                )
              })}
            </fieldset>
          )}

          <div className={styles.saveBox}>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={startPublish}
                aria-disabled={saving}
                aria-expanded={review !== null}
              >
                Publish…
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void save(false)}
                aria-disabled={saving}
              >
                Save as a draft
              </button>
            </div>
            {review && (
              <div className={styles.publishBox} data-testid="editor-review">
                <h2 className={styles.sectionTitle}>Publish these changes?</h2>
                {review.fields.length === 0 ? (
                  <p className={styles.note}>Nothing has changed since the published version.</p>
                ) : (
                  <ul className={styles.plainList}>
                    {review.fields.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
                {review.sql && review.fields.includes('SQL') && (
                  // A scroll box: focusable so it scrolls from the keyboard.
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                  <div className={styles.diff} role="region" aria-label="SQL changes" tabIndex={0}>
                    {review.sql.map((line, i) => (
                      <div
                        key={i}
                        className={
                          line.type === 'add'
                            ? styles.diffAdd
                            : line.type === 'remove'
                              ? styles.diffRemove
                              : undefined
                        }
                      >
                        <span aria-hidden="true">
                          {line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  '}
                        </span>
                        <span className={styles.visuallyHidden}>
                          {line.type === 'add'
                            ? 'Added: '
                            : line.type === 'remove'
                              ? 'Removed: '
                              : ''}
                        </span>
                        {line.text}
                      </div>
                    ))}
                  </div>
                )}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void save(true)}
                    aria-disabled={saving}
                  >
                    Publish
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setReview(null)}
                  >
                    Not yet
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={styles.previewPane} aria-labelledby={`${id}-preview`} role="region">
          <h2 id={`${id}-preview`} className={styles.sectionTitle}>
            Preview
          </h2>
          <p className={styles.status} aria-live="polite" data-testid="editor-status">
            {message}
          </p>
          {issues.length > 0 && (
            <div
              className={
                issues.some((i) => i.level === 'error') ? styles.errorSummary : styles.warning
              }
              data-testid="editor-issues"
            >
              <ul className={styles.plainList}>
                {issues.map((i) => (
                  <li key={i.code + i.message}>
                    <strong>{i.level === 'error' ? 'Problem' : 'Check'}:</strong> {i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview && preview.rowCount > 0 && (
            <>
              <HeadlineStrip tiles={tiles} narrative={narrative} />
              <ReportResults
                title={`${draft.title || 'New report'} (preview)`}
                charts={validCharts}
                columnSpecs={draft.columnSettings}
                columns={preview.columns}
                rows={preview.rows}
              />
            </>
          )}
          {preview && preview.rowCount === 0 && (
            <p className={styles.note}>The query ran and returned no rows on its defaults.</p>
          )}
        </div>
      </div>
    </section>
  )
}
