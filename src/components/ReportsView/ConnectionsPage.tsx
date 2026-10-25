'use client'

import React, { useState } from 'react'
import { formatDateMedium } from '@/lib/formatters'
import { useReportConnections, type ConnectionView } from '@/hooks/queries/useReportConnections'
import { useDeleteConnection } from '@/hooks/mutations/useReportConnectionMutations'
import styles from './styles.module.css'

function describe(c: ConnectionView): string {
  const parts = [`Sends you back to ${c.redirectHost}`]
  if (c.createdAt) parts.push(`connected ${formatDateMedium(c.createdAt)}`)
  return parts.join('; ')
}

function history(c: ConnectionView): string {
  const parts: string[] = []
  parts.push(c.lastUsedAt ? `Last used ${formatDateMedium(c.lastUsedAt)}` : 'Not used yet')
  if (c.expiresAt) parts.push(`ends ${formatDateMedium(c.expiresAt)} unless removed first`)
  return parts.join('; ')
}

/**
 * The signed-in person's connected Claude apps (MCP connections made by
 * signing in to the CRM from claude.ai or Claude Code), with a way to cut
 * each one. Admins see everyone's under Reporting, MCP connections.
 */
export function ConnectionsPage() {
  const query = useReportConnections()
  const remove = useDeleteConnection()
  const [status, setStatus] = useState('')
  const connections = query.data?.connections ?? []

  const onRemove = (c: ConnectionView) => {
    if (
      !window.confirm(
        `Disconnect "${c.clientName}" (${c.redirectHost})? It will have to sign in again.`,
      )
    ) {
      return
    }
    remove.mutate(c.id, {
      onSuccess: () => setStatus(`${c.clientName}: disconnected.`),
      onError: (e) => setStatus((e as Error).message),
    })
  }

  return (
    <section aria-labelledby="connections-title" data-testid="connections-page">
      <header className={styles.header}>
        <h1 id="connections-title" className={styles.title}>
          Your connected apps
        </h1>
        <p className={styles.subtitle}>
          Claude apps you have connected to CRM reporting by signing in. Each one can do what your
          role allows, and sees the results of what it runs. Disconnect any you do not recognise or
          no longer use.
        </p>
      </header>
      <p className={styles.status} aria-live="polite" data-testid="connections-status">
        {status}
      </p>
      {query.isLoading ? (
        <p className={styles.note}>Loading…</p>
      ) : query.error ? (
        <p className={styles.errorSummary} role="alert">
          {(query.error as Error).message}
        </p>
      ) : connections.length === 0 ? (
        <p className={styles.note} data-testid="connections-empty">
          You have no connected apps. Add the CRM reporting connector in claude.ai or Claude Code
          and sign in to make one.
        </p>
      ) : (
        <ul className={styles.subscriptionList}>
          {connections.map((c) => (
            <li key={c.id} className={styles.subscriptionItem} data-testid={`connection-${c.id}`}>
              <div>
                <strong>{c.clientName}</strong>
                <span className={styles.subscriptionMeta}> (the name the app gave)</span>
                <p className={styles.subscriptionMeta}>{describe(c)}</p>
                <p className={styles.subscriptionMeta}>{history(c)}</p>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => onRemove(c)}
                  aria-label={`Disconnect ${c.clientName} at ${c.redirectHost}`}
                >
                  Disconnect
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
