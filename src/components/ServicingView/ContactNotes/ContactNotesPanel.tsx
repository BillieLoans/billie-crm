'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useContactNotes } from '@/hooks/queries/useContactNotes'
import { type LoanAccountData } from '@/hooks/queries/useCustomer'
import { ContactNoteFilters } from './ContactNoteFilters'
import { ContactNotesTimeline } from './ContactNotesTimeline'
import { AddNoteDrawer } from './AddNoteDrawer'
import { useContactNotesHotkeys } from './useContactNotesHotkeys'
import styles from './styles.module.css'

export interface ContactNotesPanelProps {
  customerId: string
  customerName?: string
  selectedAccountId: string | null
  accounts: LoanAccountData[]
}

export const ContactNotesPanel: React.FC<ContactNotesPanelProps> = ({
  customerId,
  customerName,
  selectedAccountId,
  accounts,
}) => {
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [accountFilter, setAccountFilter] = useState<string | null>(null)

  // Drawer state (Story 7.3)
  const [addNoteOpen, setAddNoteOpen] = useState(false)
  const [amendingNoteId, setAmendingNoteId] = useState<string | null>(null)
  const [newlyAddedNoteId, setNewlyAddedNoteId] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const addNoteBtnRef = useRef<HTMLButtonElement>(null)
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

  // Register N-key hotkey to open the drawer
  useContactNotesHotkeys({ isDrawerOpen: addNoteOpen, onOpenDrawer: handleOpenDrawer })

  const handleTypeChange = (type: string | null) => {
    setTypeFilter(type)
  }

  const handleAccountChange = (id: string | null) => {
    setAccountFilter(id)
  }

  const {
    notes,
    totalDocs,
    hasNextPage,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
  } = useContactNotes(customerId, {
    type: typeFilter ?? undefined,
    accountId: accountFilter ?? undefined,
  })

  const hasNotes = notes.length > 0
  const amendingNote =
    amendingNoteId != null ? notes.find((note) => note.id === amendingNoteId) ?? null : null

  const handleAmend = useCallback((noteId: string) => {
    setAmendingNoteId(noteId)
    setAddNoteOpen(true)
  }, [])

  // Loading true only on first page before any notes are available
  const isInitialLoading = isLoading && !hasNotes

  return (
    <section ref={panelRef} className={styles.panel} aria-label="Contact Notes">
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          📝 Contact Notes {!isLoading && `(${totalDocs})`}
        </h2>
        <button
          ref={addNoteBtnRef}
          className={styles.addNoteBtn}
          onClick={handleOpenDrawer}
          type="button"
          data-testid="add-note-btn"
        >
          + Add Note
        </button>
      </div>

      <div className={styles.filtersBar}>
        <ContactNoteFilters
          typeFilter={typeFilter}
          accountFilter={accountFilter}
          accounts={accounts}
          onTypeChange={handleTypeChange}
          onAccountChange={handleAccountChange}
        />
      </div>

      {!isInitialLoading && !hasNotes ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>📝</div>
          <p className={styles.emptyStateText}>
            No contact notes yet for this customer.<br />
            Add a note to start building interaction history.
          </p>
        </div>
      ) : (
        <ContactNotesTimeline
          notes={notes}
          isLoading={isInitialLoading}
          selectedAccountId={selectedAccountId}
          onLoadMore={() => void fetchNextPage()}
          hasMore={hasNextPage && !isFetchingNextPage}
          onAmend={handleAmend}
          newlyAddedNoteId={newlyAddedNoteId}
        />
      )}

      {/* Add Note Drawer — rendered inside the panel so it has access to all context */}
      <AddNoteDrawer
        isOpen={addNoteOpen}
        onClose={handleCloseDrawer}
        onSuccess={handleNoteSuccess}
        customerId={customerId}
        customerName={customerName}
        selectedAccountId={selectedAccountId}
        accounts={accounts}
        amendingNote={amendingNote}
      />
    </section>
  )
}
