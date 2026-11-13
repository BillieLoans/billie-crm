'use client'

import React, { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { NotificationBodyContent } from '@/components/ServicingView/Communications/NotificationBodyModal'
import type { NotificationData } from '@/hooks/queries/useNotifications'
import { getTemplateLabel, getFailureLabel } from '@/lib/notifications/templateLabels'
import styles from './styles.module.css'

export interface ReminderPreview {
  rung: number
  channel: string
  template: string
  subject: string
  body: string
}

export interface ReminderDetailModalProps {
  rung: number
  label: string
  /** Sends for this rung, newest first (an original plus any channel fallback or re-run series). */
  sends: NotificationData[]
  isLoading: boolean
  isError: boolean
  /** The engine's rendered preview, passed only when this rung is the next step. */
  preview: ReminderPreview | null
  onClose: () => void
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

function statusLabel(n: NotificationData): string {
  switch (n.status) {
    case 'sent':
      return 'Sent'
    case 'failed':
      return getFailureLabel(n.failure?.errorType ?? null)
    case 'blocked':
      return 'Blocked — notification suppression active'
    default:
      return n.status
  }
}

function SendDetail({
  send,
  expanded,
  onToggle,
}: {
  send: NotificationData
  expanded: boolean
  onToggle: () => void
}) {
  const isFallback = send.idempotencyKey?.endsWith(':fallback') ?? false
  const statusClass =
    send.status === 'sent'
      ? styles.reminderStatusSent
      : send.status === 'failed'
        ? styles.reminderStatusFailed
        : styles.reminderStatusBlocked
  const canShowBody = send.status === 'sent' || send.status === 'failed'

  return (
    <li className={styles.reminderSend} data-testid={`reminder-send-${send.id}`}>
      <dl className={styles.reminderDetails}>
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`${styles.reminderStatus} ${statusClass}`}>{statusLabel(send)}</span>
            {isFallback && <span className={styles.reminderFallbackTag}>Channel fallback</span>}
          </dd>
        </div>
        <div>
          <dt>{send.status === 'sent' ? 'Sent' : 'When'}</dt>
          <dd>{formatDateTime(send.sentAt ?? send.eventAt)}</dd>
        </div>
        <div>
          <dt>Channel</dt>
          <dd>{send.channel ? send.channel.toUpperCase() : '—'}</dd>
        </div>
        <div>
          <dt>Template</dt>
          <dd>
            {getTemplateLabel(send.templateName, send.tags ?? undefined)}
            {send.templateName && (
              <span className={styles.reminderTemplateRaw}> · {send.templateName}</span>
            )}
          </dd>
        </div>
        {send.provider && (
          <div>
            <dt>Provider</dt>
            <dd>{send.provider}</dd>
          </div>
        )}
        {send.failure?.attempt != null && send.failure.attempt > 1 && (
          <div>
            <dt>Attempt</dt>
            <dd>{send.failure.attempt}</dd>
          </div>
        )}
      </dl>

      {send.status !== 'sent' && send.failure?.errorMessage && (
        <p className={styles.reminderError}>{send.failure.errorMessage}</p>
      )}

      {canShowBody && (
        <>
          <button
            type="button"
            className={styles.reminderBodyToggle}
            aria-expanded={expanded}
            onClick={onToggle}
            data-testid={`reminder-body-toggle-${send.id}`}
          >
            {expanded ? 'Hide message' : 'Show message'}
          </button>
          {expanded && (
            <div className={styles.reminderBody}>
              <NotificationBodyContent notificationId={send.notificationId} />
            </div>
          )}
        </>
      )}
    </li>
  )
}

/**
 * What a customer was sent (or will be sent) at one collections rung: delivery
 * details plus the stored message body for each send. For an unsent next step
 * it shows the engine's rendered preview instead.
 */
export function ReminderDetailModal({
  rung,
  label,
  sends,
  isLoading,
  isError,
  preview,
  onClose,
}: ReminderDetailModalProps) {
  // Newest send opens with its message showing; the rest start collapsed.
  // `undefined` = the operator hasn't toggled anything yet, so follow the
  // newest send even if the list arrives after the modal opens.
  const [toggledId, setToggledId] = useState<string | null | undefined>(undefined)
  const expandedId = toggledId === undefined ? (sends[0]?.id ?? null) : toggledId

  let content: React.ReactNode
  if (isLoading) {
    content = <div className={styles.pendingPlaceholder}>Loading reminders…</div>
  } else if (isError) {
    content = (
      <div className={styles.pendingPlaceholder} data-testid="reminder-load-error">
        Could not load the reminders sent for this account.
      </div>
    )
  } else if (sends.length > 0) {
    content = (
      <ol className={styles.reminderSendList}>
        {sends.map((send) => (
          <SendDetail
            key={send.id}
            send={send}
            expanded={expandedId === send.id}
            onToggle={() => setToggledId(expandedId === send.id ? null : send.id)}
          />
        ))}
      </ol>
    )
  } else if (preview) {
    content = (
      <>
        <p className={styles.reminderNote}>
          Not sent yet. This is the next step — the customer will receive:
        </p>
        <div className={styles.previewCard} data-testid="reminder-preview">
          <div>
            <strong>Channel:</strong> {preview.channel ? preview.channel.toUpperCase() : '—'}
          </div>
          <div>
            <strong>Template:</strong>{' '}
            {getTemplateLabel(preview.template)}
            {preview.template && (
              <span className={styles.reminderTemplateRaw}> · {preview.template}</span>
            )}
          </div>
          {preview.subject && (
            <div>
              <strong>Subject:</strong> {preview.subject}
            </div>
          )}
          {preview.body && <div className={styles.previewBody}>{preview.body}</div>}
        </div>
      </>
    )
  } else if (rung === 6) {
    content = (
      <p className={styles.reminderNote} data-testid="reminder-none">
        Enforcement is the legal track after the automated reminders. It sends no automated
        message.
      </p>
    )
  } else {
    content = (
      <p className={styles.reminderNote} data-testid="reminder-none">
        Nothing has been sent at this step for this account.
      </p>
    )
  }

  return (
    <Modal title={label} onClose={onClose} testId="reminder-detail-modal" maxWidth="760px">
      <div className={styles.modalBody}>{content}</div>
    </Modal>
  )
}
