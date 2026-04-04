'use client'

import { create } from 'zustand'

export interface ConversationFilters {
  status: string
  decision: string
  from: string
  to: string
  q: string
}

const DEFAULT_FILTERS: ConversationFilters = {
  status: '',
  decision: '',
  from: '',
  to: '',
  q: '',
}

interface ConversationFiltersState {
  filters: ConversationFilters
  setFilter: (key: keyof ConversationFilters, value: string) => void
  clearFilters: () => void
  hasActiveFilters: () => boolean
}

/**
 * Zustand store for conversation monitoring grid filter state.
 * Persisted across navigation (restored when returning from detail view).
 *
 * Story 2.4: Conversation Search & Filtering
 */
export const useConversationFiltersStore = create<ConversationFiltersState>((set, get) => ({
  filters: { ...DEFAULT_FILTERS },

  setFilter: (key, value) =>
    set((state) => ({ filters: { ...state.filters, [key]: value } })),

  clearFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),

  hasActiveFilters: () => {
    const { filters } = get()
    return Object.values(filters).some((v) => v !== '')
  },
}))
