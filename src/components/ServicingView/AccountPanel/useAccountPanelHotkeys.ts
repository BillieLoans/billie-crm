'use client'

import { useEffect, useCallback } from 'react'
import type { TabId } from './AccountTabs'
import { characterShortcutAllowed, isEditableTarget } from '@/lib/keyboard'

const TAB_ORDER: TabId[] = ['overview', 'transactions', 'fees', 'accruals', 'ecl', 'actions']

interface UseAccountPanelHotkeysOptions {
  /** Currently active tab */
  activeTab: TabId
  /** Callback to change the active tab */
  onTabChange: (tab: TabId) => void
  /** Array of account IDs (for navigation) */
  accountIds: string[]
  /** Currently selected account ID */
  selectedAccountId: string | null
  /** Callback to switch to a different account */
  onSwitchAccount: (accountId: string) => void
  /** Callback to close the panel */
  onClose: () => void
  /** Whether the panel is active (shortcuts should be enabled) */
  isActive: boolean
}

/**
 * Hook to handle keyboard shortcuts for the AccountPanel.
 *
 * Shortcuts:
 * - 1–6: Switch to tab (Overview, Transactions, Fees, Accruals, ECL, Actions)
 * - ↑/↓: Navigate between accounts (when multiple exist)
 * - Escape: Close the panel
 */
export function useAccountPanelHotkeys({
  activeTab: _activeTab,
  onTabChange,
  accountIds,
  selectedAccountId,
  onSwitchAccount,
  onClose,
  isActive,
}: UseAccountPanelHotkeysOptions): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't handle if not active
      if (!isActive) return

      // A drawer or dialog is open over the panel (they all set aria-modal):
      // its keys are its own. Escape here would close the panel behind it and
      // unmount the drawer with whatever was typed in it; an arrow key would
      // swap the account the drawer is acting on.
      if (document.querySelector('[aria-modal="true"]')) return

      // Don't handle if user is typing in an input
      if (isEditableTarget(event.target) || !characterShortcutAllowed(event)) return

      // Don't handle if modifier keys are pressed (except shift for Escape)
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      // Tab switching with number keys 1–6
      if (event.key >= '1' && event.key <= '6') {
        const tabIndex = parseInt(event.key, 10) - 1
        if (tabIndex >= 0 && tabIndex < TAB_ORDER.length) {
          event.preventDefault()
          onTabChange(TAB_ORDER[tabIndex])
        }
        return
      }

      // Account navigation with arrow keys
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && accountIds.length > 1) {
        event.preventDefault()
        const currentIndex = selectedAccountId ? accountIds.indexOf(selectedAccountId) : -1

        let newIndex: number
        if (event.key === 'ArrowUp') {
          newIndex = currentIndex <= 0 ? accountIds.length - 1 : currentIndex - 1
        } else {
          newIndex = currentIndex >= accountIds.length - 1 ? 0 : currentIndex + 1
        }

        if (newIndex !== currentIndex && accountIds[newIndex]) {
          onSwitchAccount(accountIds[newIndex])
        }
        return
      }

      // Close panel with Escape
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
    },
    [isActive, onTabChange, accountIds, selectedAccountId, onSwitchAccount, onClose],
  )

  useEffect(() => {
    if (!isActive) return

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActive, handleKeyDown])
}
