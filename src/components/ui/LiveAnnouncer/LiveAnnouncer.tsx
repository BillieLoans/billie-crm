'use client'

import React from 'react'
import { useAnnouncerStore } from '@/stores/announcer'
import { useOptimisticAnnouncements } from './useOptimisticAnnouncements'
import styles from './LiveAnnouncer.module.css'

/**
 * The app's single pair of ARIA live regions — docs/ux-standards.md §1.2 (SC 4.1.3).
 *
 * Mount exactly once, in the providers tree. Anything can announce via
 * useAnnouncerStore.getState().announce(text, urgency); optimistic mutation
 * outcomes are wired automatically by useOptimisticAnnouncements.
 */
export const LiveAnnouncer: React.FC = () => {
  const polite = useAnnouncerStore((s) => s.polite)
  const assertive = useAnnouncerStore((s) => s.assertive)
  const seq = useAnnouncerStore((s) => s.seq)

  useOptimisticAnnouncements()

  return (
    <>
      <div
        key={`polite-${seq}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={styles.visuallyHidden}
      >
        {polite}
      </div>
      <div
        key={`assertive-${seq}`}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className={styles.visuallyHidden}
      >
        {assertive}
      </div>
    </>
  )
}
