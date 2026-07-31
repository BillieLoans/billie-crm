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
 *
 * Each region is keyed off its own lane's seq (not a shared one) — see
 * src/stores/announcer.ts. That keeps the two regions fully independent: an
 * assertive announcement remounts only the alert region, never the status
 * region (which would otherwise force a stale, unchanged re-read), and vice
 * versa.
 */
export const LiveAnnouncer: React.FC = () => {
  const polite = useAnnouncerStore((s) => s.polite)
  const politeSeq = useAnnouncerStore((s) => s.politeSeq)
  const assertive = useAnnouncerStore((s) => s.assertive)
  const assertiveSeq = useAnnouncerStore((s) => s.assertiveSeq)

  useOptimisticAnnouncements()

  return (
    <>
      <div
        key={`polite-${politeSeq}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={styles.visuallyHidden}
      >
        {polite}
      </div>
      <div
        key={`assertive-${assertiveSeq}`}
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
