'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { RECENT_REPORTS_STORAGE_KEY } from '@/lib/constants'

/** A report the user opened: its link and title only, never results. */
interface RecentReport {
  slug: string
  title: string
  viewedAt: number
}

interface RecentReportsState {
  reports: RecentReport[]
  addReport: (slug: string, title: string) => void
  clearHistory: () => void
}

const MAX_RECENT_REPORTS = 6

/**
 * Recently opened reports, for the Reports home. Cleared when a different
 * user signs in (UserSessionGuard), like recent customers.
 */
export const useRecentReportsStore = create<RecentReportsState>()(
  persist(
    (set, get) => ({
      reports: [],
      addReport: (slug, title) => {
        const rest = get().reports.filter((r) => r.slug !== slug)
        set({
          reports: [{ slug, title, viewedAt: Date.now() }, ...rest].slice(0, MAX_RECENT_REPORTS),
        })
      },
      clearHistory: () => set({ reports: [] }),
    }),
    { name: RECENT_REPORTS_STORAGE_KEY, version: 1 },
  ),
)
