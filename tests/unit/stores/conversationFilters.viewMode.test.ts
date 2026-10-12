/**
 * conversationFilters store — Applications view mode + sort.
 *
 * View mode and sort sit beside `filters`, not inside it: "Clear filters" must
 * leave the chosen layout alone, and the filter-active indicator must not light
 * up because someone sorted a column.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { installMockLocalStorage } from '../../utils/mock-local-storage'
import { APPLICATIONS_VIEW_MODE_STORAGE_KEY } from '@/lib/constants'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  }
})()

installMockLocalStorage(localStorageMock)

import { useConversationFiltersStore, readStoredViewMode } from '@/stores/conversationFilters'

describe('conversationFilters — view mode and sort', () => {
  beforeEach(() => {
    act(() => {
      useConversationFiltersStore.getState().clearFilters()
      useConversationFiltersStore.setState({ viewMode: 'tiles', sort: '-updatedAt' })
    })
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('defaults to tiles with the default sort', () => {
    const { viewMode, sort } = useConversationFiltersStore.getState()
    expect(viewMode).toBe('tiles')
    expect(sort).toBe('-updatedAt')
  })

  it('setSort changes the sort without marking filters active', () => {
    act(() => useConversationFiltersStore.getState().setSort('applicationNumber'))
    expect(useConversationFiltersStore.getState().sort).toBe('applicationNumber')
    expect(useConversationFiltersStore.getState().hasActiveFilters()).toBe(false)
  })

  it('clearFilters leaves view mode and sort alone', () => {
    act(() => {
      useConversationFiltersStore.getState().setViewMode('list')
      useConversationFiltersStore.getState().setSort('status')
      useConversationFiltersStore.getState().setFilter('q', 'rohan')
      useConversationFiltersStore.getState().clearFilters()
    })
    const state = useConversationFiltersStore.getState()
    expect(state.filters.q).toBe('')
    expect(state.viewMode).toBe('list')
    expect(state.sort).toBe('status')
  })

  it('switching back to tiles resets the sort to the default', () => {
    act(() => {
      useConversationFiltersStore.getState().setViewMode('list')
      useConversationFiltersStore.getState().setSort('-startedAt')
      useConversationFiltersStore.getState().setViewMode('tiles')
    })
    expect(useConversationFiltersStore.getState().sort).toBe('-updatedAt')
  })

  it('remembers the view mode in localStorage for the next visit', () => {
    act(() => useConversationFiltersStore.getState().setViewMode('list'))
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      APPLICATIONS_VIEW_MODE_STORAGE_KEY,
      'list',
    )
  })

  it('readStoredViewMode returns a stored value and ignores junk', () => {
    localStorageMock.setItem(APPLICATIONS_VIEW_MODE_STORAGE_KEY, 'list')
    expect(readStoredViewMode()).toBe('list')
    localStorageMock.setItem(APPLICATIONS_VIEW_MODE_STORAGE_KEY, 'spreadsheet')
    expect(readStoredViewMode()).toBeNull()
    localStorageMock.removeItem(APPLICATIONS_VIEW_MODE_STORAGE_KEY)
    expect(readStoredViewMode()).toBeNull()
  })
})
