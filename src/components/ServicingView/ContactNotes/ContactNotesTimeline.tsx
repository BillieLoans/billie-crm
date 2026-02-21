'use client'

import React, { useMemo } from 'react'
import { ContactNoteData } from '@/hooks/queries/useContactNotes'
import { ContactNoteCard } from './ContactNoteCard'
import styles from './styles.module.css'

export interface ContactNotesTimelineProps {
  notes: ContactNoteData[]
  isLoading: boolean
  selectedAccountId: string | null
  onLoadMore: () => void
  hasMore: boolean
  onAmend?: (noteId: string) => void
  onNavigateToAccount?: (loanAccountId: string) => void
  newlyAddedNoteId?: string | null
}

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

export const ContactNotesTimeline: React.FC<ContactNotesTimelineProps> = ({
  notes,
  isLoading,
  selectedAccountId,
  onLoadMore,
  hasMore,
  onAmend,
  onNavigateToAccount,
  newlyAddedNoteId,
}) => {
  const { activeNotes, allNotesById } = useMemo(() => {
    const byId = new Map(notes.map((n) => [n.id, n]))
    const active = notes.filter((n) => n.status !== 'amended')
    return { activeNotes: active, allNotesById: byId }
  }, [notes])

  if (isLoading) {
    return (
      <div className={styles.timeline} aria-live="polite" aria-atomic="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className={styles.skeletonCard}>
            <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
            <div className={`${styles.skeletonLine} ${styles.skeletonLineMed}`} />
            <div className={`${styles.skeletonLine} ${styles.skeletonLineFull}`} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={styles.timeline} aria-live="polite" aria-atomic="true">
      {activeNotes.map((note) => {
        const isNew = newlyAddedNoteId === note.id
        const previousVersions = note.amendsNote
          ? buildPreviousVersions(note, allNotesById)
          : []

        return (
          <div
            key={note.id}
            data-note-id={note.id}
            className={isNew ? styles.noteFlash : undefined}
          >
            <ContactNoteCard
              note={note}
              isHighlighted={isHighlightedNote(note, selectedAccountId)}
              onAmend={onAmend}
              onNavigateToAccount={onNavigateToAccount}
              previousVersions={previousVersions}
            />
          </div>
        )
      })}
      {hasMore && (
        <button className={styles.loadMoreBtn} onClick={onLoadMore}>
          Load more
        </button>
      )}
    </div>
  )
}
