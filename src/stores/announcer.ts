'use client'

import { create } from 'zustand'
import type { AnnouncementUrgency } from '@/lib/announcements'

interface AnnouncerState {
  polite: string
  assertive: string
  /** Bumped on every announce so an identical consecutive message still re-reads. */
  seq: number
  announce: (text: string, urgency: AnnouncementUrgency) => void
}

export const useAnnouncerStore = create<AnnouncerState>((set) => ({
  polite: '',
  assertive: '',
  seq: 0,
  announce: (text, urgency) =>
    set((state) => ({
      seq: state.seq + 1,
      polite: urgency === 'polite' ? text : '',
      assertive: urgency === 'assertive' ? text : '',
    })),
}))
