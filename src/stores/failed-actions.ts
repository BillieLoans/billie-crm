'use client'

import { create } from 'zustand'
import { nanoid } from 'nanoid'
import {
  FAILED_ACTIONS_STORAGE_KEY,
  FAILED_ACTIONS_TTL_MS,
  MAX_FAILED_ACTIONS,
} from '@/lib/constants'

/**
 * Types of actions that can fail and be retried.
 *
 * The four `collections/*` entries are the Collections operator actions
 * (BTB-198 WS5: flag-hardship, resume-hardship, stop-contact,
 * advance-step) — added here so `addFailedAction` type-checks for them.
 * As with `write-off-request`, none of them registers a
 * `billie-retry-action` window-event listener (see useFlagHardship.ts for
 * why); they still land in this queue via the same `isSystemError()` path
 * as every other action, so the panel lists/dismisses them normally — only
 * the "Retry" button is a no-op until a listener is wired.
 */
export type FailedActionType =
  | 'waive-fee'
  | 'record-repayment'
  | 'write-off-request'
  | 'flag-hardship'
  | 'resume-hardship'
  | 'stop-contact'
  | 'advance-step'
  | 'marketing-command'

/**
 * A failed action that can be retried later.
 */
export interface FailedAction {
  /** Unique identifier */
  id: string
  /** Type of action that failed */
  type: FailedActionType
  /** Loan account ID the action was for */
  accountId: string
  /** Human-readable account label (e.g., "LOAN-12345") */
  accountLabel?: string
  /** Original parameters for the action (for retry) */
  params: Record<string, unknown>
  /** Error message from the failure */
  errorMessage: string
  /** When the failure occurred (ISO string) */
  timestamp: string
  /** Number of retry attempts */
  retryCount: number
}

interface FailedActionsState {
  /** List of failed actions */
  actions: FailedAction[]

  /** Add a failed action to the queue */
  addFailedAction: (
    type: FailedActionType,
    accountId: string,
    params: Record<string, unknown>,
    errorMessage: string,
    accountLabel?: string,
  ) => string

  /** Remove a failed action (on success or dismiss) */
  removeAction: (id: string) => void

  /** Increment retry count for an action */
  incrementRetryCount: (id: string) => void

  /** Clear all failed actions */
  clearAll: () => void

  /** Get count of non-expired actions */
  getActiveCount: () => number

  /** Load actions from localStorage (call on mount) */
  loadFromStorage: () => void
}

/**
 * Check if an action is expired based on TTL.
 */
function isExpired(action: FailedAction): boolean {
  const createdAt = new Date(action.timestamp).getTime()
  return Date.now() - createdAt > FAILED_ACTIONS_TTL_MS
}

/**
 * Load failed actions from localStorage, filtering expired ones.
 */
function loadFromLocalStorage(): FailedAction[] {
  if (typeof window === 'undefined') return []

  try {
    const stored = localStorage.getItem(FAILED_ACTIONS_STORAGE_KEY)
    if (!stored) return []

    const actions: FailedAction[] = JSON.parse(stored)
    // Filter out expired actions
    return actions.filter((action) => !isExpired(action))
  } catch {
    // Ignore localStorage errors
    return []
  }
}

/**
 * Save failed actions to localStorage.
 */
function saveToLocalStorage(actions: FailedAction[]): void {
  if (typeof window === 'undefined') return

  try {
    // Only save non-expired actions, limited to max count
    const validActions = actions.filter((action) => !isExpired(action)).slice(-MAX_FAILED_ACTIONS)

    localStorage.setItem(FAILED_ACTIONS_STORAGE_KEY, JSON.stringify(validActions))
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Zustand store for managing failed actions that can be retried.
 *
 * Features:
 * - Persists to localStorage with TTL (24h)
 * - Limits storage to MAX_FAILED_ACTIONS items
 * - Filters expired actions on load
 * - Supports retry count tracking
 *
 * SECURITY:
 * - Data is CLEARED when a different user logs in (see UserSessionGuard)
 * - This prevents User B from seeing User A's failed action queue
 *
 * @see src/components/UserSessionGuard - clears this store on user change
 *
 * @example
 * ```tsx
 * const { actions, addFailedAction, removeAction } = useFailedActionsStore()
 *
 * // Add a failed action
 * addFailedAction('waive-fee', 'ACC-123', { amount: 10 }, 'Network error')
 *
 * // Remove on success or dismiss
 * removeAction(actionId)
 * ```
 */
export const useFailedActionsStore = create<FailedActionsState>((set, get) => ({
  actions: [],

  addFailedAction: (type, accountId, params, errorMessage, accountLabel) => {
    // Check for existing action with same type and accountId to prevent duplicates
    const existingActions = get().actions
    const existingIndex = existingActions.findIndex(
      (a) => a.type === type && a.accountId === accountId && !isExpired(a),
    )

    // If duplicate exists, update it instead of adding new
    if (existingIndex >= 0) {
      const existingAction = existingActions[existingIndex]
      set((state) => {
        const newActions = state.actions.map((a, i) =>
          i === existingIndex ? { ...a, errorMessage, timestamp: new Date().toISOString() } : a,
        )
        saveToLocalStorage(newActions)
        return { actions: newActions }
      })
      return existingAction.id
    }

    const id = nanoid()
    const action: FailedAction = {
      id,
      type,
      accountId,
      accountLabel,
      params,
      errorMessage,
      timestamp: new Date().toISOString(),
      retryCount: 0,
    }

    set((state) => {
      const newActions = [...state.actions, action].slice(-MAX_FAILED_ACTIONS)
      saveToLocalStorage(newActions)
      return { actions: newActions }
    })

    return id
  },

  removeAction: (id) => {
    set((state) => {
      const newActions = state.actions.filter((a) => a.id !== id)
      saveToLocalStorage(newActions)
      return { actions: newActions }
    })
  },

  incrementRetryCount: (id) => {
    set((state) => {
      const newActions = state.actions.map((a) =>
        a.id === id ? { ...a, retryCount: a.retryCount + 1 } : a,
      )
      saveToLocalStorage(newActions)
      return { actions: newActions }
    })
  },

  clearAll: () => {
    set({ actions: [] })
    saveToLocalStorage([])
  },

  getActiveCount: () => {
    return get().actions.filter((a) => !isExpired(a)).length
  },

  loadFromStorage: () => {
    const storedActions = loadFromLocalStorage()
    set({ actions: storedActions })
  },
}))
