'use client'

import React, { useState, useMemo } from 'react'
import { ContactNoteData } from '@/hooks/queries/useContactNotes'
import { renderNoteContent } from '@/lib/tiptap'
import styles from './styles.module.css'

export interface ContactNoteCardProps {
  note: ContactNoteData
  isHighlighted: boolean
  onAmend?: (noteId: string) => void
  onNavigateToAccount?: (loanAccountId: string) => void
  previousVersions?: ContactNoteData[]
}

const CHANNEL_META: Record<ContactNoteData['channel'], { icon: string; label: string }> = {
  phone: { icon: '📞', label: 'Phone' },
  email: { icon: '📧', label: 'Email' },
  sms: { icon: '💬', label: 'SMS' },
  internal: { icon: '📋', label: 'Internal' },
  system: { icon: '⚙️', label: 'System' },
}

const TOPIC_LABELS: Record<ContactNoteData['topic'], string> = {
  general_enquiry: 'General Enquiry',
  complaint: 'Complaint',
  escalation: 'Escalation',
  internal_note: 'Internal Note',
  account_update: 'Account Update',
  collections: 'Collections Activity',
}

function toTitle(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

type LegacyNoteType =
  | 'phone_inbound'
  | 'phone_outbound'
  | 'email_inbound'
  | 'email_outbound'
  | 'sms'
  | 'general_enquiry'
  | 'complaint'
  | 'escalation'
  | 'internal_note'
  | 'account_update'
  | 'collections'

function deriveMetadata(note: ContactNoteData): {
  channel: ContactNoteData['channel'] | undefined
  topic: ContactNoteData['topic'] | undefined
  contactDirection: ContactNoteData['contactDirection']
} {
  const raw = note as ContactNoteData & { noteType?: LegacyNoteType }
  const legacy = raw.noteType
  if (note.channel && note.topic) {
    return {
      channel: note.channel,
      topic: note.topic,
      contactDirection: note.contactDirection,
    }
  }

  if (!legacy) {
    return {
      channel: note.channel,
      topic: note.topic,
      contactDirection: note.contactDirection,
    }
  }

  const fromLegacy: Record<LegacyNoteType, { channel: ContactNoteData['channel']; topic: ContactNoteData['topic']; contactDirection?: ContactNoteData['contactDirection'] }> = {
    phone_inbound: { channel: 'phone', topic: 'general_enquiry', contactDirection: 'inbound' },
    phone_outbound: { channel: 'phone', topic: 'general_enquiry', contactDirection: 'outbound' },
    email_inbound: { channel: 'email', topic: 'general_enquiry', contactDirection: 'inbound' },
    email_outbound: { channel: 'email', topic: 'general_enquiry', contactDirection: 'outbound' },
    sms: { channel: 'sms', topic: 'general_enquiry' },
    general_enquiry: { channel: 'phone', topic: 'general_enquiry' },
    complaint: { channel: 'phone', topic: 'complaint' },
    escalation: { channel: 'phone', topic: 'escalation' },
    internal_note: { channel: 'internal', topic: 'internal_note' },
    account_update: { channel: 'phone', topic: 'account_update' },
    collections: { channel: 'phone', topic: 'collections' },
  }

  const mapped = fromLegacy[legacy]
  return {
    channel: note.channel ?? mapped.channel,
    topic: note.topic ?? mapped.topic,
    contactDirection: note.contactDirection ?? mapped.contactDirection ?? null,
  }
}

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function getAuthorName(createdBy: ContactNoteData['createdBy']): string {
  if (createdBy && typeof createdBy === 'object') {
    return [createdBy.firstName, createdBy.lastName].filter(Boolean).join(' ') || 'Staff'
  }
  return 'Staff'
}

const PreviousVersionCard: React.FC<{ version: ContactNoteData }> = ({ version }) => {
  const [expanded, setExpanded] = useState(false)
  const metadata = deriveMetadata(version)
  const versionTopicLabel = metadata.topic ? (TOPIC_LABELS[metadata.topic] ?? 'Unknown') : 'Unknown'
  const { rich, plainText } = useMemo(() => renderNoteContent(version.content), [version.content])
  const hasBody = !!plainText.trim()

  return (
    <div className={styles.prevVersionCard} data-testid="previous-version-card">
      <div className={styles.prevVersionHeader}>
        <span className={styles.prevVersionDate}>{formatTimestamp(version.createdAt)}</span>
        <span className={styles.prevVersionAuthor}>By {getAuthorName(version.createdBy)}</span>
      </div>
      <div className={styles.prevVersionSubject}>{version.subject}</div>
      <div className={styles.noteMetaRow}>
        <span className={`${styles.badge} ${styles.badgeMeta}`}>Channel: {toTitle(metadata.channel)}</span>
        {metadata.contactDirection && (
          <span className={`${styles.badge} ${styles.badgeMeta}`}>Direction: {toTitle(metadata.contactDirection)}</span>
        )}
        <span className={`${styles.badge} ${styles.badgeTopic}`}>{versionTopicLabel}</span>
      </div>
      {hasBody && (
        <>
          {rich ? (
            <div className={`${styles.noteBody} ${styles.noteBodyRich} ${expanded ? '' : styles.bodyTruncated}`}>
              {rich}
            </div>
          ) : (
            <div className={`${styles.noteBody} ${expanded ? '' : styles.bodyTruncated}`}>
              {plainText}
            </div>
          )}
          <button
            className={styles.showMoreBtn}
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        </>
      )}
    </div>
  )
}

export const ContactNoteCard: React.FC<ContactNoteCardProps> = ({
  note,
  isHighlighted,
  onAmend = undefined,
  onNavigateToAccount,
  previousVersions = [],
}) => {
  const [expanded, setExpanded] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const metadata = deriveMetadata(note)
  const channelMeta = metadata.channel ? (CHANNEL_META[metadata.channel] ?? { icon: '📝', label: 'Unknown' }) : { icon: '📝', label: 'Unknown' }
  const topicLabel = metadata.topic ? (TOPIC_LABELS[metadata.topic] ?? 'Unknown') : 'Unknown'
  const { rich: bodyRich, plainText: bodyText } = useMemo(
    () => renderNoteContent(note.content),
    [note.content],
  )
  const hasBody = !!bodyText.trim()
  const timestamp = formatTimestamp(note.createdAt)
  const hasPreviousVersions = previousVersions.length > 0

  const linkedAccount =
    note.loanAccount && typeof note.loanAccount === 'object' && 'accountNumber' in note.loanAccount
      ? note.loanAccount.accountNumber
      : null
  const linkedLoanAccountId =
    note.loanAccount && typeof note.loanAccount === 'object' && 'loanAccountId' in note.loanAccount
      ? note.loanAccount.loanAccountId
      : null

  const authorName = getAuthorName(note.createdBy)

  const cardClasses = [
    styles.noteCard,
    isHighlighted ? styles.noteCardHighlighted : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={cardClasses}>
      {/* Header row */}
      <div className={styles.noteCardHeader}>
        <span className={styles.noteTypeLabel}>
          {channelMeta.icon} {channelMeta.label}
          {metadata.contactDirection ? ` (${metadata.contactDirection})` : ''}
        </span>
        <div className={styles.noteCardHeaderRight}>
          {hasPreviousVersions && (
            <span className={`${styles.badge} ${styles.badgeAmendment}`}>AMENDED</span>
          )}
          <span className={`${styles.badge} ${styles.badgeTopic}`}>{topicLabel}</span>
          <span className={styles.noteTimestamp}>{timestamp}</span>
        </div>
      </div>

      <div className={styles.noteMetaRow}>
        <span className={`${styles.badge} ${styles.badgeMeta}`}>Channel: {toTitle(metadata.channel)}</span>
        {metadata.contactDirection && (
          <span className={`${styles.badge} ${styles.badgeMeta}`}>Direction: {toTitle(metadata.contactDirection)}</span>
        )}
        <span className={`${styles.badge} ${styles.badgeTopic}`}>{topicLabel}</span>
      </div>

      {/* Priority / sentiment badges */}
      {(note.priority !== 'normal' || note.sentiment !== 'neutral') && (
        <div className={styles.noteBadges}>
          {note.priority === 'low' && (
            <span className={`${styles.badge} ${styles.badgePriorityLow}`}>Low Priority</span>
          )}
          {note.priority === 'high' && (
            <span className={`${styles.badge} ${styles.badgePriorityHigh}`}>High Priority</span>
          )}
          {note.priority === 'urgent' && (
            <span className={`${styles.badge} ${styles.badgePriorityUrgent}`}>Urgent</span>
          )}
          {note.sentiment === 'positive' && (
            <span className={`${styles.badge} ${styles.badgeSentimentPositive}`}>Positive</span>
          )}
          {note.sentiment === 'negative' && (
            <span className={`${styles.badge} ${styles.badgeSentimentNegative}`}>Negative</span>
          )}
          {note.sentiment === 'escalation' && (
            <span className={`${styles.badge} ${styles.badgeSentimentEscalation}`}>Escalation</span>
          )}
        </div>
      )}

      {/* Subject */}
      <div className={styles.noteSubject}>{note.subject}</div>

      {/* Body */}
      {hasBody && (
        <>
          {bodyRich ? (
            <div className={`${styles.noteBody} ${styles.noteBodyRich} ${expanded ? '' : styles.bodyTruncated}`}>
              {bodyRich}
            </div>
          ) : (
            <div className={`${styles.noteBody} ${expanded ? '' : styles.bodyTruncated}`}>
              {bodyText}
            </div>
          )}
          <button
            className={styles.showMoreBtn}
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        </>
      )}

      <hr className={styles.noteDivider} />

      {/* Footer */}
      <div className={styles.noteFooter}>
        {linkedAccount &&
          (linkedLoanAccountId && onNavigateToAccount ? (
            <button
              type="button"
              className={styles.noteAccountLinkBtn}
              onClick={() => onNavigateToAccount(linkedLoanAccountId)}
            >
              🔗 {linkedAccount}
            </button>
          ) : (
            <span className={styles.noteLinkedAccount}>🔗 {linkedAccount}</span>
          ))}
        <span className={styles.noteAuthor}>By {authorName}</span>
        {onAmend && (
          <button className={styles.amendBtn} type="button" onClick={() => onAmend(note.id)}>
            Amend ↗
          </button>
        )}
      </div>

      {/* Amendment history — expandable section showing previous versions */}
      {hasPreviousVersions && (
        <div className={styles.amendmentHistory}>
          <button
            className={styles.amendmentHistoryToggle}
            type="button"
            onClick={() => setHistoryOpen((prev) => !prev)}
            aria-expanded={historyOpen}
            data-testid="amendment-history-toggle"
          >
            {historyOpen ? '▲' : '▸'} Amendment history ({previousVersions.length} previous{' '}
            {previousVersions.length === 1 ? 'version' : 'versions'})
          </button>
          {historyOpen && (
            <div className={styles.amendmentHistoryList} data-testid="amendment-history-list">
              {previousVersions.map((version) => (
                <PreviousVersionCard key={version.id} version={version} />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}
