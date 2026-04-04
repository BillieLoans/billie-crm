'use client'

import { create } from 'zustand'

interface MonitoringGridState {
  scrollPosition: number
  setScrollPosition: (pos: number) => void
}

/**
 * Zustand store for monitoring grid scroll position preservation.
 * Restored when returning from conversation detail view.
 *
 * Story 4.2: Bidirectional Navigation & State Preservation
 */
export const useMonitoringGridStore = create<MonitoringGridState>((set) => ({
  scrollPosition: 0,
  setScrollPosition: (pos) => set({ scrollPosition: pos }),
}))
