'use client'

import { create } from 'zustand'
import { APPLICATIONS_VIEW_MODE_STORAGE_KEY } from '@/lib/constants'

export interface ConversationFilters {
  status: string
  decision: string
  from: string
  to: string
  q: string
}

export type ApplicationsViewMode = 'tiles' | 'list'

export const DEFAULT_CONVERSATION_SORT_PARAM = '-updatedAt'

const DEFAULT_FILTERS: ConversationFilters = {
  status: '',
  decision: '',
  from: '',
  to: '',
  q: '',
}

const isViewMode = (v: unknown): v is ApplicationsViewMode => v === 'tiles' || v === 'list'

/**
 * The view mode remembered in this browser, or null. A first-paint hint only:
 * the per-user Payload preference (see useViewModePreference) is authoritative
 * and overrides this once it loads.
 */
export function readStoredViewMode(): ApplicationsViewMode | null {
  try {
    const v = window.localStorage.getItem(APPLICATIONS_VIEW_MODE_STORAGE_KEY)
    return isViewMode(v) ? v : null
  } catch {
    return null
  }
}

function writeStoredViewMode(mode: ApplicationsViewMode) {
  try {
    window.localStorage.setItem(APPLICATIONS_VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    // Private mode / blocked storage — the preference server-side still holds it.
  }
}

interface ConversationFiltersState {
  filters: ConversationFilters
  setFilter: (key: keyof ConversationFilters, value: string) => void
  clearFilters: () => void
  hasActiveFilters: () => boolean
  /** Applications layout. Lives beside `filters` so Clear filters leaves it alone. */
  viewMode: ApplicationsViewMode
  setViewMode: (mode: ApplicationsViewMode) => void
  /** `field` asc or `-field` desc. Only the list view exposes a control for it. */
  sort: string
  setSort: (sort: string) => void
}

/**
 * Zustand store for conversation monitoring grid filter state.
 * Persisted across navigation (restored when returning from detail view).
 *
 * Story 2.4: Conversation Search & Filtering
 */
export const useConversationFiltersStore = create<ConversationFiltersState>((set, get) => ({
  filters: { ...DEFAULT_FILTERS },

  setFilter: (key, value) => set((state) => ({ filters: { ...state.filters, [key]: value } })),

  clearFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),

  hasActiveFilters: () => {
    const { filters } = get()
    return Object.values(filters).some((v) => v !== '')
  },

  viewMode: (typeof window !== 'undefined' && readStoredViewMode()) || 'tiles',

  // Tiles have no sort control, so a sort chosen in the list would reorder the
  // grid with nothing on screen to explain it — reset to the default instead.
  setViewMode: (mode) => {
    writeStoredViewMode(mode)
    set(
      mode === 'tiles'
        ? { viewMode: mode, sort: DEFAULT_CONVERSATION_SORT_PARAM }
        : { viewMode: mode },
    )
  },

  sort: DEFAULT_CONVERSATION_SORT_PARAM,
  setSort: (sort) => set({ sort }),
}))
