'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { formatDateMedium } from '@/lib/formatters'
import { FREQUENCY_LABELS, type SubscriptionFrequency } from '@/lib/reports/subscriptions'
import {
  useReportSubscriptions,
  type SubscriptionView,
} from '@/hooks/queries/useReportSubscriptions'
import {
  useDeleteSubscription,
  usePauseSubscription,
} from '@/hooks/mutations/useReportSubscriptionMutations'
import styles from './styles.module.css'

function describe(sub: SubscriptionView): string {
  const where = sub.channel === 'slack' ? 'to the Slack channel' : 'by email'
  if (sub.kind === 'alert') {
    return `Alert ${where} when ${sub.alert ?? 'the threshold is crossed'}`
  }
  const when = FREQUENCY_LABELS[(sub.frequency ?? 'weekly') as SubscriptionFrequency]
  return `${when}, ${where}${sub.rangeLabel ? `, covering ${sub.rangeLabel.toLowerCase()}` : ''}`
}

function history(sub: SubscriptionView): string {
  const parts: string[] = []
  if (sub.lastSentAt) parts.push(`Last sent ${formatDateMedium(sub.lastSentAt)}`)
  else parts.push('Not sent yet')
  if (sub.kind === 'alert' && sub.lastValue !== null) {
    parts.push(`last check ${sub.lastValue}${sub.alertActive ? ', over the line' : ''}`)
  }
  return parts.join('; ')
}

/**
 * The signed-in user's report emails and alerts: what each sends and when,
 * whether it worked last time, and pause, resume or remove.
 */
export function SubscriptionsPage() {
  const query = useReportSubscriptions()
  const pause = usePauseSubscription()
  const remove = useDeleteSubscription()
  const [status, setStatus] = useState('')
  const subs = query.data?.subscriptions ?? []

  const onPause = (sub: SubscriptionView) =>
    pause.mutate(
      { id: sub.id, paused: !sub.paused },
      {
        onSuccess: () => setStatus(`${sub.title}: ${sub.paused ? 'resumed' : 'paused'}.`),
        onError: (e) => setStatus((e as Error).message),
      },
    )
  const onRemove = (sub: SubscriptionView) => {
    if (!window.confirm(`Stop "${sub.title}" ${sub.kind === 'alert' ? 'alert' : 'emails'}?`)) {
      return
    }
    remove.mutate(sub.id, {
      onSuccess: () => setStatus(`${sub.title}: removed.`),
      onError: (e) => setStatus((e as Error).message),
    })
  }

  return (
    <section aria-labelledby="subscriptions-title" data-testid="subscriptions-page">
      <header className={styles.header}>
        <h1 id="subscriptions-title" className={styles.title}>
          Your report emails and alerts
        </h1>
        <p className={styles.subtitle}>
          Start one from any report with &ldquo;Email me this&rdquo; or &ldquo;Alert me&rdquo;. They
          go out at about 7am Sydney time.
        </p>
      </header>
      <p className={styles.status} aria-live="polite" data-testid="subscriptions-status">
        {status}
      </p>
      {query.isLoading ? (
        <p className={styles.note}>Loading…</p>
      ) : query.error ? (
        <p className={styles.errorSummary} role="alert">
          {(query.error as Error).message}
        </p>
      ) : subs.length === 0 ? (
        <p className={styles.note} data-testid="subscriptions-empty">
          You have no report emails or alerts. <Link href="/admin/reports">Find a report</Link>.
        </p>
      ) : (
        <ul className={styles.subscriptionList}>
          {subs.map((sub) => (
            <li
              key={sub.id}
              className={styles.subscriptionItem}
              data-paused={sub.paused}
              data-testid={`subscription-${sub.id}`}
            >
              <div>
                <strong>
                  {sub.slug ? (
                    <Link className={styles.textLink} href={`/admin/reports/${sub.slug}`}>
                      {sub.title}
                    </Link>
                  ) : (
                    sub.title
                  )}
                </strong>
                {sub.paused && <span className={styles.draftBadge}> Paused</span>}
                <p className={styles.subscriptionMeta}>{describe(sub)}</p>
                <p className={styles.subscriptionMeta}>{history(sub)}</p>
                {sub.lastError && <p className={styles.fieldError}>Last time: {sub.lastError}</p>}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => onPause(sub)}
                  aria-label={`${sub.paused ? 'Resume' : 'Pause'} ${sub.title}`}
                >
                  {sub.paused ? 'Resume' : 'Pause'}
                </button>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => onRemove(sub)}
                  aria-label={`Remove ${sub.title}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
