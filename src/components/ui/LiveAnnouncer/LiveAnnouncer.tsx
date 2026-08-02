'use client'

import React, { useEffect, useState } from 'react'
import { useAnnouncerStore } from '@/stores/announcer'
import { useOptimisticAnnouncements } from './useOptimisticAnnouncements'
import styles from './LiveAnnouncer.module.css'

// Delay between clearing a lane's text and re-setting it, so an identical consecutive
// message is re-announced. This cannot be 0: Chromium and Firefox coalesce accessibility-tree
// change notifications within the same frame/microtask, so a 0ms timer commonly lands before
// the clear is ever observed by the a11y tree — the re-announcement never happens, which is
// the exact case this mechanism exists for. 100ms is the canonical figure in the a11y
// literature for making a clear-then-set observable as two distinct mutations.
const REANNOUNCE_DELAY_MS = 100

/**
 * The app's single pair of ARIA live regions — docs/ux-standards.md §1.2 (SC 4.1.3).
 *
 * Mount exactly once, in the providers tree. Anything can announce via
 * useAnnouncerStore.getState().announce(text, urgency); optimistic mutation
 * outcomes are wired automatically by useOptimisticAnnouncements.
 *
 * Both region nodes are mounted ONCE, from first paint, and keep a stable
 * identity — no `key` prop. A live region that enters the DOM already
 * containing its text is the classic anti-pattern: because the node and its
 * content appear in the same commit, some screen readers (NVDA+Firefox in
 * particular) never notice it. role="alert" is a documented exception for
 * the assertive lane, but the polite lane has no such exception and carries
 * this feature's headline requirement ("Balance updated to $X") — see
 * sonner's own live region for the in-repo counter-example: it mounts once
 * and only ever mutates content inside it.
 *
 * To still re-announce an IDENTICAL consecutive message (a screen reader
 * ignores a live region whose text content didn't change), each lane clears
 * its own displayed text to '' when its own seq bumps, then re-sets the real
 * text on a later tick — a genuine two-phase mutation of the already-mounted
 * node, not a remount. The two lanes stay fully independent (own seq, own
 * effect, own state) — see src/stores/announcer.ts for why a shared seq or
 * cross-lane clear would be wrong.
 */
export const LiveAnnouncer: React.FC = () => {
  const polite = useAnnouncerStore((s) => s.polite)
  const politeSeq = useAnnouncerStore((s) => s.politeSeq)
  const assertive = useAnnouncerStore((s) => s.assertive)
  const assertiveSeq = useAnnouncerStore((s) => s.assertiveSeq)

  const [politeText, setPoliteText] = useState('')
  const [assertiveText, setAssertiveText] = useState('')

  useOptimisticAnnouncements()

  useEffect(() => {
    if (politeSeq === 0) return
    setPoliteText('')
    const id = window.setTimeout(() => setPoliteText(polite), REANNOUNCE_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [politeSeq, polite])

  useEffect(() => {
    if (assertiveSeq === 0) return
    setAssertiveText('')
    const id = window.setTimeout(() => setAssertiveText(assertive), REANNOUNCE_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [assertiveSeq, assertive])

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className={styles.visuallyHidden}>
        {politeText}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className={styles.visuallyHidden}>
        {assertiveText}
      </div>
    </>
  )
}
