'use client'

import React, { useState, useMemo } from 'react'
import { ContactNoteData } from '@/hooks/queries/useContactNotes'
import { renderNoteContent } from '@/lib/tiptap'
import styles from './styles.module.css'

export interface ContactNoteCardProps {
  note: ContactNoteData
  isHighlighted: boolean
  onAmend?: (noteId: string) => void
  previousVersions?: ContactNoteData[]
}

const TYPE_META: Record<ContactNoteData['noteType'], { icon: string; label: string }> = {
  phone_inbound: { icon: '📞', label: 'Inbound Call' },
  phone_outbound: { icon: '📱', label: 'Outbound Call' },
  email_inbound: { icon: '📨', label: 'Email Received' },
  email_outbound: { icon: '📧', label: 'Email Sent' },
  sms: { icon: '💬', label: 'SMS' },
  general_enquiry: { icon: '❓', label: 'General Enquiry' },
  complaint: { icon: '⚠️', label: 'Complaint' },
  escalation: { icon: '🔺', label: 'Escalation' },
  internal_note: { icon: '📋', label: 'Internal Note' },
  account_update: { icon: '🔄', label: 'Account Update' },
  collections: { icon: '📊', label: 'Collections Activity' },
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
  const { rich, plainText } = useMemo(() => renderNoteContent(version.content), [version.content])
  const hasBody = !!plainText.trim()

  return (
    <div className={styles.prevVersionCard} data-testid="previous-version-card">
      <div className={styles.prevVersionHeader}>
        <span className={styles.prevVersionDate}>{formatTimestamp(version.createdAt)}</span>
        <span className={styles.prevVersionAuthor}>By {getAuthorName(version.createdBy)}</span>
      </div>
      <div className={styles.prevVersionSubject}>{version.subject}</div>
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
  previousVersions = [],
}) => {
  const [expanded, setExpanded] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const { icon, label } = TYPE_META[note.noteType]
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
          {icon} {label}
        </span>
        <div className={styles.noteCardHeaderRight}>
          {hasPreviousVersions && (
            <span className={`${styles.badge} ${styles.badgeAmendment}`}>AMENDED</span>
          )}
          <span className={styles.noteTimestamp}>{timestamp}</span>
        </div>
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
        {linkedAccount && (
          <span className={styles.noteLinkedAccount}>🔗 {linkedAccount}</span>
        )}
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
