'use client'

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  useContactNotes,
  type ContactNoteData,
} from '@/hooks/queries/useContactNotes'
import {
  useNotifications,
  type NotificationData,
  type NotificationStatus,
} from '@/hooks/queries/useNotifications'
import { type LoanAccountData } from '@/hooks/queries/useCustomer'
import { ContactNoteCard } from '../ContactNotes/ContactNoteCard'
import { AddNoteDrawer } from '../ContactNotes/AddNoteDrawer'
import { useContactNotesHotkeys } from '../ContactNotes/useContactNotesHotkeys'
import contactNotesStyles from '../ContactNotes/styles.module.css'
import { CommunicationsFilters, type CommunicationsFilter } from './CommunicationsFilters'
import { NotificationCard } from './NotificationCard'
import styles from './styles.module.css'

export interface CommunicationsPanelProps {
  /** Payload document ID for the customer. Used to query contact notes via the relationship. */
  customerDocId: string
  /** Platform business-key customer ID (e.g. "cust_abc"). Used to query notifications. */
  customerBusinessId: string
  customerName?: string
  selectedAccountId: string | null
  accounts: LoanAccountData[]
  onNavigateToAccount?: (loanAccountId: string) => void
}

type TimelineItem =
  | { kind: 'note'; sortTimestamp: number; data: ContactNoteData }
  | { kind: 'notification'; sortTimestamp: number; data: NotificationData }

function getAmendsId(note: ContactNoteData): string | null {
  if (!note.amendsNote) return null
  if (typeof note.amendsNote === 'string') return note.amendsNote
  if (typeof note.amendsNote === 'object' && 'id' in note.amendsNote) return note.amendsNote.id
  return null
}

function isHighlightedNote(note: ContactNoteData, selectedAccountId: string | null): boolean {
  if (!selectedAccountId) return false
  if (!note.loanAccount || typeof note.loanAccount !== 'object') return false
  return note.loanAccount.loanAccountId === selectedAccountId
}

function buildPreviousVersions(
  note: ContactNoteData,
  allNotesById: Map<string, ContactNoteData>,
): ContactNoteData[] {
  const chain: ContactNoteData[] = []
  const visited = new Set<string>()
  let currentId = getAmendsId(note)
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const prev = allNotesById.get(currentId)
    if (!prev) break
    chain.push(prev)
    currentId = getAmendsId(prev)
  }
  return chain.reverse()
}

function notificationStatusForFilter(
  filter: CommunicationsFilter,
): NotificationStatus | undefined {
  switch (filter) {
    case 'sent':
      return 'sent'
    case 'failed':
      return 'failed'
    case 'blocked':
      return 'blocked'
    default:
      return undefined
  }
}

export const CommunicationsPanel: React.FC<CommunicationsPanelProps> = ({
  customerDocId,
  customerBusinessId,
  customerName,
  selectedAccountId,
  accounts,
  onNavigateToAccount,
}) => {
  const [filter, setFilter] = useState<CommunicationsFilter>('all')
  const [addNoteOpen, setAddNoteOpen] = useState(false)
  const [amendingNoteId, setAmendingNoteId] = useState<string | null>(null)
  const [newlyAddedNoteId, setNewlyAddedNoteId] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleOpenDrawer = useCallback(() => {
    setAmendingNoteId(null)
    setAddNoteOpen(true)
  }, [])

  const handleCloseDrawer = useCallback(() => {
    setAddNoteOpen(false)
    setAmendingNoteId(null)
  }, [])

  const handleNoteSuccess = useCallback((noteId: string) => {
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setNewlyAddedNoteId(noteId)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setNewlyAddedNoteId(null), 3000)
  }, [])

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  useContactNotesHotkeys({ isDrawerOpen: addNoteOpen, onOpenDrawer: handleOpenDrawer })

  const handleAmend = useCallback((noteId: string) => {
    setAmendingNoteId(noteId)
    setAddNoteOpen(true)
  }, [])

  // Notes — paginated when the filter is 'all' or 'notes'. Suppressed otherwise
  // so the timeline shows only the requested category.
  const notesEnabled = filter === 'all' || filter === 'notes'
  const {
    notes,
    totalDocs: totalNotes,
    hasNextPage: hasMoreNotes,
    isLoading: isNotesLoading,
    isFetchingNextPage: isFetchingMoreNotes,
    fetchNextPage: fetchMoreNotes,
  } = useContactNotes(notesEnabled ? customerDocId : '', {})

  // Notifications — paginated. Filter by status when one is selected.
  const notificationsEnabled = filter !== 'notes'
  const notificationStatus = notificationStatusForFilter(filter)
  const {
    notifications,
    totalDocs: totalNotifications,
    hasNextPage: hasMoreNotifications,
    isLoading: isNotificationsLoading,
    isFetchingNextPage: isFetchingMoreNotifications,
    fetchNextPage: fetchMoreNotifications,
  } = useNotifications(notificationsEnabled ? customerBusinessId : '', {
    status: notificationStatus,
  })

  // Build a single chronological timeline by merging both streams.
  // Amended notes are filtered out; their history is shown via the
  // ContactNoteCard's amendment-history accordion.
  const { activeNotes, allNotesById } = useMemo(() => {
    const byId = new Map(notes.map((n) => [n.id, n]))
    const active = notes.filter((n) => n.status !== 'amended')
    return { activeNotes: active, allNotesById: byId }
  }, [notes])

  const timeline: TimelineItem[] = useMemo(() => {
    const items: TimelineItem[] = []

    if (notesEnabled) {
      for (const note of activeNotes) {
        items.push({
          kind: 'note',
          sortTimestamp: new Date(note.createdAt).getTime(),
          data: note,
        })
      }
    }

    if (notificationsEnabled) {
      for (const notification of notifications) {
        items.push({
          kind: 'notification',
          sortTimestamp: new Date(notification.eventAt).getTime(),
          data: notification,
        })
      }
    }

    items.sort((a, b) => b.sortTimestamp - a.sortTimestamp)
    return items
  }, [activeNotes, notifications, notesEnabled, notificationsEnabled])

  const isInitialLoading =
    (notesEnabled && isNotesLoading && notes.length === 0) ||
    (notificationsEnabled && isNotificationsLoading && notifications.length === 0)

  const hasItems = timeline.length > 0
  const hasMore =
    (notesEnabled && hasMoreNotes) || (notificationsEnabled && hasMoreNotifications)
  const isFetchingMore = isFetchingMoreNotes || isFetchingMoreNotifications

  const handleLoadMore = useCallback(() => {
    if (notesEnabled && hasMoreNotes && !isFetchingMoreNotes) {
      void fetchMoreNotes()
    }
    if (notificationsEnabled && hasMoreNotifications && !isFetchingMoreNotifications) {
      void fetchMoreNotifications()
    }
  }, [
    notesEnabled,
    hasMoreNotes,
    isFetchingMoreNotes,
    fetchMoreNotes,
    notificationsEnabled,
    hasMoreNotifications,
    isFetchingMoreNotifications,
    fetchMoreNotifications,
  ])

  const amendingNote =
    amendingNoteId != null ? notes.find((note) => note.id === amendingNoteId) ?? null : null

  const headerCount = (() => {
    if (filter === 'notes') return totalNotes
    if (filter === 'all') return totalNotes + totalNotifications
    return totalNotifications
  })()

  return (
    <section
      ref={panelRef}
      className={styles.panel}
      aria-label="Communications"
    >
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          💬 Communications {!isInitialLoading && `(${headerCount})`}
        </h2>
        <div className={styles.headerActions}>
          {(filter === 'all' || filter === 'notes') && (
            <button
              type="button"
              className={styles.addNoteBtn}
              onClick={handleOpenDrawer}
              data-testid="add-note-btn"
            >
              + Add Note
            </button>
          )}
        </div>
      </div>

      <CommunicationsFilters active={filter} onChange={setFilter} />

      {isInitialLoading ? (
        <div className={styles.timeline} aria-live="polite" aria-atomic="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className={contactNotesStyles.skeletonCard}>
              <div
                className={`${contactNotesStyles.skeletonLine} ${contactNotesStyles.skeletonLineShort}`}
              />
              <div
                className={`${contactNotesStyles.skeletonLine} ${contactNotesStyles.skeletonLineMed}`}
              />
              <div
                className={`${contactNotesStyles.skeletonLine} ${contactNotesStyles.skeletonLineFull}`}
              />
            </div>
          ))}
        </div>
      ) : !hasItems ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>💬</div>
          <p className={styles.emptyStateText}>
            {filter === 'notes'
              ? 'No contact notes yet for this customer.'
              : filter === 'all'
                ? 'No communications yet for this customer.'
                : `No ${filter} notifications to show.`}
          </p>
        </div>
      ) : (
        <div className={styles.timeline} aria-live="polite" aria-atomic="true">
          {timeline.map((item) => {
            if (item.kind === 'note') {
              const note = item.data
              const isNew = newlyAddedNoteId === note.id
              const previousVersions = note.amendsNote
                ? buildPreviousVersions(note, allNotesById)
                : []
              return (
                <div
                  key={`note-${note.id}`}
                  data-note-id={note.id}
                  className={isNew ? contactNotesStyles.noteFlash : undefined}
                >
                  <ContactNoteCard
                    note={note}
                    isHighlighted={isHighlightedNote(note, selectedAccountId)}
                    onAmend={handleAmend}
                    onNavigateToAccount={onNavigateToAccount}
                    previousVersions={previousVersions}
                  />
                </div>
              )
            }
            return (
              <NotificationCard
                key={`notif-${item.data.id}`}
                notification={item.data}
              />
            )
          })}
          {hasMore && (
            <button
              type="button"
              className={styles.loadMoreBtn}
              onClick={handleLoadMore}
              disabled={isFetchingMore}
            >
              {isFetchingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}

      <AddNoteDrawer
        isOpen={addNoteOpen}
        onClose={handleCloseDrawer}
        onSuccess={handleNoteSuccess}
        customerId={customerDocId}
        customerName={customerName}
        selectedAccountId={selectedAccountId}
        accounts={accounts}
        amendingNote={amendingNote}
      />
    </section>
  )
}
