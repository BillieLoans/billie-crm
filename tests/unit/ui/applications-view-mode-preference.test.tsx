/**
 * useViewModePreference — remembers the Applications layout per user.
 *
 * localStorage only seeds the first paint; the Payload user preference is the
 * source of truth so the choice follows the user to the next logon and to
 * another browser. Mocks @payloadcms/ui (see memory: importing it unmocked
 * pulls react-image-crop CSS and breaks collection).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { APPLICATIONS_VIEW_MODE_PREFERENCE_KEY } from '@/lib/constants'

const prefs = vi.hoisted(() => ({
  getPreference: vi.fn(),
  setPreference: vi.fn(),
}))

vi.mock('@payloadcms/ui', () => ({
  usePreferences: () => prefs,
}))

import { useViewModePreference } from '@/components/ApplicationsView/useViewModePreference'
import { useConversationFiltersStore } from '@/stores/conversationFilters'

describe('useViewModePreference', () => {
  beforeEach(() => {
    prefs.getPreference.mockReset()
    prefs.setPreference.mockReset().mockResolvedValue(undefined)
    act(() => useConversationFiltersStore.setState({ viewMode: 'tiles', sort: '-updatedAt' }))
  })

  it('applies the saved per-user preference on mount', async () => {
    prefs.getPreference.mockResolvedValue('list')
    const { result } = renderHook(() => useViewModePreference())
    await waitFor(() => expect(result.current.viewMode).toBe('list'))
    expect(prefs.getPreference).toHaveBeenCalledWith(APPLICATIONS_VIEW_MODE_PREFERENCE_KEY)
  })

  it('keeps the current layout when there is no saved preference', async () => {
    prefs.getPreference.mockResolvedValue(null)
    const { result } = renderHook(() => useViewModePreference())
    await waitFor(() => expect(prefs.getPreference).toHaveBeenCalled())
    expect(result.current.viewMode).toBe('tiles')
  })

  it('ignores a junk preference value', async () => {
    prefs.getPreference.mockResolvedValue('spreadsheet')
    const { result } = renderHook(() => useViewModePreference())
    await waitFor(() => expect(prefs.getPreference).toHaveBeenCalled())
    expect(result.current.viewMode).toBe('tiles')
  })

  it('saves a change to the per-user preference and the store', async () => {
    prefs.getPreference.mockResolvedValue(null)
    const { result } = renderHook(() => useViewModePreference())
    await waitFor(() => expect(prefs.getPreference).toHaveBeenCalled())
    act(() => result.current.setViewMode('list'))
    expect(result.current.viewMode).toBe('list')
    expect(useConversationFiltersStore.getState().viewMode).toBe('list')
    expect(prefs.setPreference).toHaveBeenCalledWith(APPLICATIONS_VIEW_MODE_PREFERENCE_KEY, 'list')
  })

  it('survives a failed preference read', async () => {
    prefs.getPreference.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useViewModePreference())
    await waitFor(() => expect(prefs.getPreference).toHaveBeenCalled())
    expect(result.current.viewMode).toBe('tiles')
  })
})
