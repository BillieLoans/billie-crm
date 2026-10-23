'use client'

import React, { useId, useMemo, useState } from 'react'
import Link from 'next/link'
import { formatValue, resolveColumns, type ColumnView } from '@/lib/reports/columns'
import { RANGE_PRESETS, dateRangeParameters, presetFor, sydneyToday } from '@/lib/reports/periods'
import {
  DEFAULT_RANGE,
  FREQUENCY_LABELS,
  FREQUENCY_PHRASES,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_RANGES,
  alertRows,
  alertValue,
  type AlertOperator,
  type SubscriptionChannel,
  type SubscriptionFrequency,
} from '@/lib/reports/subscriptions'
import type { ReportSpec } from '@/hooks/queries/useReports'
import type { ReportRunResponse } from '@/hooks/queries/useReportRun'
import { SubscriptionFailure, useReportSubscriptions } from '@/hooks/queries/useReportSubscriptions'
import { useCreateSubscription } from '@/hooks/mutations/useReportSubscriptionMutations'
import styles from './styles.module.css'

const MANAGE_HREF = '/admin/reports/subscriptions'

export interface SubscribePanelProps {
  slug: string
  spec: ReportSpec
  /**
   * The values of the results on screen: a subscription keeps the ones that
   * are not the period, and an alert's "it is X now" reads those results.
   */
  values: Record<string, unknown>
  result: ReportRunResponse | undefined
}

type Mode = 'digest' | 'alert' | null
type Setting = string | number | boolean

/** The periods a subscription can cover (complete days only). */
const PERIODS = RANGE_PRESETS.filter((p) =>
  (SUBSCRIPTION_RANGES as readonly string[]).includes(p.key),
)

/**
 * "Email me this" and "Alert me": a report sent on a schedule with the
 * settings on screen (the period moves with each delivery), or an email
 * when one of its numbers crosses a threshold.
 */
export function SubscribePanel({ slug, spec, values, result }: SubscribePanelProps) {
  const id = useId().replace(/:/g, '')
  const [mode, setMode] = useState<Mode>(null)
  const [done, setDone] = useState('')
  const subscriptions = useReportSubscriptions(mode !== null)
  const range = useMemo(() => dateRangeParameters(spec.parameters), [spec.parameters])
  const kept = useMemo(() => {
    const skip = new Set(range ? [range.from.name, range.to.name] : [])
    return Object.fromEntries(
      Object.entries(values).filter(
        (entry): entry is [string, Setting] =>
          !skip.has(entry[0]) &&
          entry[1] !== '' &&
          ['string', 'number', 'boolean'].includes(typeof entry[1]),
      ),
    )
  }, [values, range])
  const shownSettings = spec.parameters
    .filter((p) => Object.hasOwn(kept, p.name))
    .map((p) => {
      const v = kept[p.name]
      const option = p.options?.find((o) => o.value === String(v))
      return `${p.label}: ${typeof v === 'boolean' ? (v ? 'yes' : 'no') : (option?.label ?? v)}`
    })

  const toggle = (next: Mode) => {
    setDone('')
    setMode((m) => (m === next ? null : next))
  }
  const canAlert = Boolean(
    result && result.rowCount > 0 && result.columns.some((c) => c.kind === 'number'),
  )

  return (
    <div className={styles.subscribe}>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondaryButton}
          aria-expanded={mode === 'digest'}
          aria-controls={`${id}-panel`}
          onClick={() => toggle('digest')}
        >
          Email me this…
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          aria-expanded={mode === 'alert'}
          aria-controls={`${id}-panel`}
          onClick={() => toggle('alert')}
          disabled={!canAlert}
          title={canAlert ? undefined : 'Run the report first: an alert watches one of its numbers'}
        >
          Alert me…
        </button>
      </div>
      <p className={styles.status} aria-live="polite" data-testid="subscribe-status">
        {done && (
          <>
            {done}{' '}
            <Link className={styles.textLink} href={MANAGE_HREF}>
              Your report emails and alerts
            </Link>
          </>
        )}
      </p>
      <div id={`${id}-panel`}>
        {mode === 'digest' && (
          <DigestForm
            id={id}
            slug={slug}
            hasRange={range !== null}
            parameters={kept}
            settings={shownSettings}
            slack={subscriptions.data?.slack ?? false}
            onDone={(text) => {
              setMode(null)
              setDone(text)
            }}
            onCancel={() => setMode(null)}
          />
        )}
        {mode === 'alert' && result && (
          <AlertForm
            id={id}
            slug={slug}
            spec={spec}
            result={result}
            hasRange={range !== null}
            shownPreset={
              range
                ? (presetFor(
                    String(values[range.from.name] ?? ''),
                    String(values[range.to.name] ?? ''),
                    sydneyToday(),
                  )?.key ?? null)
                : null
            }
            parameters={kept}
            settings={shownSettings}
            slack={subscriptions.data?.slack ?? false}
            onDone={(text) => {
              setMode(null)
              setDone(text)
            }}
            onCancel={() => setMode(null)}
          />
        )}
      </div>
    </div>
  )
}

interface FormProps {
  id: string
  slug: string
  hasRange: boolean
  parameters: Record<string, Setting>
  settings: string[]
  slack: boolean
  onDone: (message: string) => void
  onCancel: () => void
}

function ChannelChoice({
  id,
  value,
  onChange,
}: {
  id: string
  value: SubscriptionChannel
  onChange: (c: SubscriptionChannel) => void
}) {
  return (
    <fieldset className={styles.field}>
      <legend className={styles.fieldLabel}>Send it to</legend>
      <div className={styles.segmented}>
        {(
          [
            ['email', 'My email'],
            ['slack', 'The Slack channel'],
          ] as const
        ).map(([c, label]) => (
          <label key={c} className={styles.segment}>
            <input
              type="radio"
              name={`${id}-channel`}
              checked={value === c}
              onChange={() => onChange(c)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Problem({ error }: { error: unknown }) {
  if (!error) return null
  const failure = error instanceof SubscriptionFailure ? error : null
  return (
    <div className={styles.errorSummary} role="alert" data-testid="subscribe-error">
      <p>{failure?.message ?? 'That could not be saved. Try again.'}</p>
      {failure?.fields && (
        <ul className={styles.errorSummaryList}>
          {Object.values(failure.fields).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SettingsNote({ settings, hasRange }: { settings: string[]; hasRange: boolean }) {
  if (settings.length === 0 && !hasRange) return null
  return (
    <p className={styles.hint}>
      {settings.length > 0 ? `With the settings on screen (${settings.join(', ')}). ` : ''}
      {hasRange ? 'The period moves forward with each one.' : ''}
    </p>
  )
}

function DigestForm({
  id,
  slug,
  hasRange,
  parameters,
  settings,
  slack,
  onDone,
  onCancel,
}: FormProps) {
  const create = useCreateSubscription()
  const [frequency, setFrequency] = useState<SubscriptionFrequency>('weekly')
  const [rangeKey, setRangeKey] = useState<string | null>(null)
  const [channel, setChannel] = useState<SubscriptionChannel>('email')
  const period = rangeKey ?? DEFAULT_RANGE[frequency]

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (create.isPending) return
    create.mutate(
      {
        kind: 'digest',
        slug,
        frequency,
        range: hasRange ? period : null,
        parameters,
        channel,
      },
      {
        onSuccess: () =>
          onDone(
            `Done: ${FREQUENCY_PHRASES[frequency]}, ${channel === 'slack' ? 'to the Slack channel' : 'by email'}.`,
          ),
      },
    )
  }

  return (
    <form className={styles.publishBox} onSubmit={submit} data-testid="digest-form">
      <h2 className={styles.sectionTitle}>Email me this report</h2>
      <Problem error={create.error} />
      <fieldset className={styles.field}>
        <legend className={styles.fieldLabel}>How often</legend>
        <div className={styles.segmented}>
          {SUBSCRIPTION_FREQUENCIES.map((f) => (
            <label key={f} className={styles.segment}>
              <input
                type="radio"
                name={`${id}-frequency`}
                checked={frequency === f}
                onChange={() => setFrequency(f)}
              />
              <span>{FREQUENCY_LABELS[f]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {hasRange && (
        <div className={styles.field}>
          <label htmlFor={`${id}-range`} className={styles.fieldLabel}>
            Each one covers
          </label>
          <select
            id={`${id}-range`}
            className={styles.input}
            value={period}
            onChange={(e) => setRangeKey(e.target.value)}
          >
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <SettingsNote settings={settings} hasRange={hasRange} />
      {slack && <ChannelChoice id={id} value={channel} onChange={setChannel} />}
      <p className={styles.hint}>
        Sent at about 7am Sydney time, with the headline numbers, the chart and the data as a CSV.
      </p>
      <div className={styles.actions}>
        <button type="submit" className={styles.primaryButton} aria-disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Start sending'}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** A threshold as typed, in the column's units, as the stored value (rates 0–1). */
export function thresholdValue(text: string, view: ColumnView | undefined): number | null {
  const trimmed = text.trim().replace(/[,$%\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null
  const n = Number(trimmed)
  return view?.format === 'percent' ? n / 100 : n
}

function AlertForm({
  id,
  slug,
  spec,
  result,
  hasRange,
  shownPreset,
  parameters,
  settings,
  slack,
  onDone,
  onCancel,
}: FormProps & {
  spec: ReportSpec
  result: ReportRunResponse
  /** The preset the results on screen cover, if they cover one. */
  shownPreset: string | null
}) {
  const create = useCreateSubscription()
  const views = useMemo(
    () => resolveColumns(result.columns, spec.columns),
    [result.columns, spec.columns],
  )
  const numeric = views.filter(
    (v) => result.columns.find((c) => c.name === v.name)?.kind === 'number',
  )
  const rows = useMemo(() => alertRows(result.columns, result.rows), [result])
  const [column, setColumn] = useState(
    spec.headline.find((h) => numeric.some((v) => v.name === h.column))?.column ??
      numeric[0]?.name ??
      '',
  )
  const [row, setRow] = useState('')
  // Checks read the period on screen when it is a preset, so "now" matches.
  const [rangeKey, setRangeKey] = useState(
    shownPreset && PERIODS.some((p) => p.key === shownPreset) ? shownPreset : 'last-7',
  )
  const sameAsShown = !hasRange || rangeKey === shownPreset
  const [operator, setOperator] = useState<AlertOperator>('above')
  const [threshold, setThreshold] = useState('')
  const [channel, setChannel] = useState<SubscriptionChannel>('email')
  const [problem, setProblem] = useState('')
  const view = views.find((v) => v.name === column)
  const current = alertValue(
    { column, row: row || undefined, operator, threshold: 0 },
    views,
    result.columns,
    result.rows,
  )
  const unit =
    view?.format === 'percent' || view?.format === 'percent100'
      ? '%'
      : view?.format === 'currency'
        ? '$'
        : ''

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (create.isPending) return
    const value = thresholdValue(threshold, view)
    if (value === null) {
      setProblem('Enter the threshold as a number')
      return
    }
    setProblem('')
    create.mutate(
      {
        kind: 'alert',
        slug,
        range: hasRange ? rangeKey : null,
        parameters,
        channel,
        alert: { column, row: row || undefined, operator, threshold: value },
      },
      {
        onSuccess: () =>
          onDone(
            `Done: you will hear when ${view?.label ?? column} goes ${operator} ${formatValue(value, view?.format ?? 'number')}.`,
          ),
      },
    )
  }

  return (
    <form className={styles.publishBox} onSubmit={submit} data-testid="alert-form" noValidate>
      <h2 className={styles.sectionTitle}>Alert me when a number crosses a line</h2>
      <Problem error={create.error} />
      <div className={styles.paramGrid}>
        <div className={styles.field}>
          <label htmlFor={`${id}-column`} className={styles.fieldLabel}>
            Watch
          </label>
          <select
            id={`${id}-column`}
            className={styles.input}
            value={column}
            onChange={(e) => setColumn(e.target.value)}
          >
            {numeric.map((v) => (
              <option key={v.name} value={v.name}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        {rows.length > 0 && (
          <div className={styles.field}>
            <label htmlFor={`${id}-row`} className={styles.fieldLabel}>
              For
            </label>
            <select
              id={`${id}-row`}
              className={styles.input}
              value={row}
              onChange={(e) => setRow(e.target.value)}
            >
              <option value="">The headline figure</option>
              {rows.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <fieldset className={styles.field}>
        <legend className={styles.fieldLabel}>When it goes</legend>
        <div className={styles.segmented}>
          {(['above', 'below'] as const).map((o) => (
            <label key={o} className={styles.segment}>
              <input
                type="radio"
                name={`${id}-operator`}
                checked={operator === o}
                onChange={() => setOperator(o)}
              />
              <span>{o === 'above' ? 'Above' : 'Below'}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={styles.field}>
        <label htmlFor={`${id}-threshold`} className={styles.fieldLabel}>
          Threshold{unit ? ` (${unit})` : ''}
        </label>
        <p id={`${id}-threshold-hint`} className={styles.hint}>
          {!sameAsShown
            ? `The results on screen cover another period; run the report on ${RANGE_PRESETS.find((p) => p.key === rangeKey)?.label.toLowerCase()} to see where it stands.`
            : current !== null
              ? `It is ${formatValue(current, view?.format ?? 'number')} now.`
              : 'No value for this on screen now.'}{' '}
          Checked every morning; you hear when it crosses, not every day it stays there.
        </p>
        {problem && (
          <p className={styles.fieldError} id={`${id}-threshold-error`}>
            {problem}
          </p>
        )}
        <input
          id={`${id}-threshold`}
          className={styles.input}
          inputMode="decimal"
          value={threshold}
          aria-invalid={problem ? true : undefined}
          aria-describedby={`${id}-threshold-hint${problem ? ` ${id}-threshold-error` : ''}`}
          onChange={(e) => setThreshold(e.target.value)}
        />
      </div>
      <SettingsNote settings={settings} hasRange={hasRange} />
      {hasRange && (
        <div className={styles.field}>
          <label htmlFor={`${id}-alert-range`} className={styles.fieldLabel}>
            Each check covers
          </label>
          <select
            id={`${id}-alert-range`}
            className={styles.input}
            value={rangeKey}
            onChange={(e) => setRangeKey(e.target.value)}
          >
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {slack && <ChannelChoice id={id} value={channel} onChange={setChannel} />}
      <div className={styles.actions}>
        <button type="submit" className={styles.primaryButton} aria-disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Create the alert'}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
