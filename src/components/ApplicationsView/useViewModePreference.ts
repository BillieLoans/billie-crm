'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePreferences } from '@payloadcms/ui'
import { APPLICATIONS_VIEW_MODE_PREFERENCE_KEY } from '@/lib/constants'
import {
  useConversationFiltersStore,
  type ApplicationsViewMode,
} from '@/stores/conversationFilters'

const isViewMode = (v: unknown): v is ApplicationsViewMode => v === 'tiles' || v === 'list'

/**
 * The Applications layout (tiles | list), remembered per user.
 *
 * The store seeds itself from localStorage so the first paint is right in the
 * browser the user last used; this hook then reads the Payload user
 * preference, which is authoritative and follows the user to the next logon
 * and to other browsers, and writes both on change.
 */
export function useViewModePreference() {
  const { getPreference, setPreference } = usePreferences()
  const viewMode = useConversationFiltersStore((s) => s.viewMode)
  const setStoreViewMode = useConversationFiltersStore((s) => s.setViewMode)

  // Payload re-creates setPreference while an update is pending, so hold the
  // latest functions in a ref and read the preference exactly once on mount.
  const prefsRef = useRef({ getPreference, setPreference })
  useEffect(() => {
    prefsRef.current = { getPreference, setPreference }
  })

  useEffect(() => {
    let cancelled = false
    prefsRef.current
      .getPreference<unknown>(APPLICATIONS_VIEW_MODE_PREFERENCE_KEY)
      .then((saved) => {
        if (cancelled || !isViewMode(saved)) return
        if (saved !== useConversationFiltersStore.getState().viewMode) setStoreViewMode(saved)
      })
      .catch(() => {
        // No preference service (or offline) — keep the localStorage-seeded layout.
      })
    return () => {
      cancelled = true
    }
  }, [setStoreViewMode])

  const setViewMode = useCallback(
    (mode: ApplicationsViewMode) => {
      setStoreViewMode(mode)
      void prefsRef.current.setPreference(APPLICATIONS_VIEW_MODE_PREFERENCE_KEY, mode).catch(() => {
        // Best effort — the store and localStorage already hold the choice.
      })
    },
    [setStoreViewMode],
  )

  return { viewMode, setViewMode }
}
