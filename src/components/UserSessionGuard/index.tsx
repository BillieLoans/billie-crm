'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@payloadcms/ui'
import { useRecentCustomersStore } from '@/stores/recentCustomers'
import { useFailedActionsStore } from '@/stores/failed-actions'
import { useVersionStore } from '@/stores/version'
import { useAnnouncerStore } from '@/stores/announcer'
import {
  SESSION_USER_STORAGE_KEY,
  RECENT_CUSTOMERS_STORAGE_KEY,
  FAILED_ACTIONS_STORAGE_KEY,
} from '@/lib/constants'
import { clearIssueDiagnostics } from '@/lib/issue-diagnostics'

/**
 * Clears all user-specific data from stores and localStorage.
 * Called when a different user logs in on the same browser.
 */
function clearUserSessionData(): void {
  // Clear Zustand stores
  useRecentCustomersStore.getState().clearHistory()
  useFailedActionsStore.getState().clearAll()
  useVersionStore.getState().clearAllVersions()
  // In-memory only, but its text is the previous user's last announced financial
  // outcome (can include a balance figure) — same rationale as versionStore above.
  useAnnouncerStore.getState().reset()

  // Clear the persisted localStorage data directly
  // (in case store clear doesn't immediately sync)
  if (typeof window !== 'undefined') {
    localStorage.removeItem(RECENT_CUSTOMERS_STORAGE_KEY)
    localStorage.removeItem(FAILED_ACTIONS_STORAGE_KEY)
    // Issue-reporter diagnostics buffers (interactions/routes/api calls/errors)
    // — User A's browsing trail must never end up on User B's report
    clearIssueDiagnostics()
  }
}

/**
 * UserSessionGuard - Protects against cross-user data leakage.
 *
 * SECURITY: This component detects when a different user logs in on the same
 * browser and clears all user-specific localStorage data to prevent:
 * - User B seeing User A's recently viewed customers
 * - User B seeing User A's failed action queue
 * - User B's issue report carrying User A's diagnostics trail
 * - Any other session-specific data bleeding across users
 *
 * This component should be rendered inside the Providers component,
 * which wraps all Payload admin pages.
 *
 * @see https://owasp.org/www-community/vulnerabilities/Session_Variable_Overloading
 */
export function UserSessionGuard(): null {
  const { user } = useAuth()
  const hasInitialized = useRef(false)

  useEffect(() => {
    // Skip SSR
    if (typeof window === 'undefined') return

    // Normalize user ID to string (Payload IDs can be string or number)
    const currentUserId = user?.id != null ? String(user.id) : null
    const storedUserId = localStorage.getItem(SESSION_USER_STORAGE_KEY)

    // First mount: initialize tracking
    if (!hasInitialized.current) {
      hasInitialized.current = true

      // If there's a stored user but no current user, or they differ → clear data
      if (storedUserId !== null && storedUserId !== currentUserId) {
        console.info('[UserSessionGuard] User changed, clearing session data')
        clearUserSessionData()
      }

      // Update stored user ID
      if (currentUserId) {
        localStorage.setItem(SESSION_USER_STORAGE_KEY, currentUserId)
      } else {
        localStorage.removeItem(SESSION_USER_STORAGE_KEY)
      }

      return
    }

    // Subsequent renders: detect user change (logout/login)
    if (currentUserId !== storedUserId) {
      // User changed
      if (storedUserId !== null) {
        // Had a previous user, clear their data
        console.info('[UserSessionGuard] User changed, clearing session data')
        clearUserSessionData()
      }

      // Update stored user ID
      if (currentUserId) {
        localStorage.setItem(SESSION_USER_STORAGE_KEY, currentUserId)
      } else {
        localStorage.removeItem(SESSION_USER_STORAGE_KEY)
      }
    }
  }, [user?.id])

  // Render nothing - this is a side-effect only component
  return null
}

export default UserSessionGuard
