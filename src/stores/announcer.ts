'use client'

import { create } from 'zustand'
import type { AnnouncementUrgency } from '@/lib/announcements'

interface AnnouncerState {
  polite: string
  /** Bumped only when a polite announcement fires — independent of the assertive lane. */
  politeSeq: number
  assertive: string
  /** Bumped only when an assertive announcement fires — independent of the polite lane. */
  assertiveSeq: number
  announce: (text: string, urgency: AnnouncementUrgency) => void
  /**
   * Cross-user session clear (UserSessionGuard). Resets both lanes to their
   * initial state — seqs return to 0, which LiveAnnouncer treats as "clear the
   * rendered text without announcing", so the previous user's last announcement
   * (it can contain a balance figure) never survives an in-SPA user switch.
   */
  reset: () => void
}

/**
 * Two fully independent lanes. Each carries its own text and its own seq so
 * that announcing on one lane can never blank or remount the other: a failed
 * write-off followed immediately by an unrelated confirmed repayment (or
 * vice versa) must not lose either message — see the Task 3 review for the
 * silent-failure regression this fixes.
 */
export const useAnnouncerStore = create<AnnouncerState>((set) => ({
  polite: '',
  politeSeq: 0,
  assertive: '',
  assertiveSeq: 0,
  announce: (text, urgency) =>
    set((state) =>
      urgency === 'polite'
        ? { polite: text, politeSeq: state.politeSeq + 1 }
        : { assertive: text, assertiveSeq: state.assertiveSeq + 1 },
    ),
  reset: () => set({ polite: '', politeSeq: 0, assertive: '', assertiveSeq: 0 }),
}))
