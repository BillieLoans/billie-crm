'use client'

import { useEffect, useCallback } from 'react'
import type { TabId } from './AccountTabs'

const TAB_ORDER: TabId[] = ['overview', 'transactions', 'fees', 'actions']

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
 * - 1-4: Switch to tab (Overview, Transactions, Fees, Actions)
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

      // Don't handle if user is typing in an input
      const target = event.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return
      }

      // Don't handle if modifier keys are pressed (except shift for Escape)
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      // Tab switching with number keys 1-4
      if (event.key >= '1' && event.key <= '4') {
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
        const currentIndex = selectedAccountId
          ? accountIds.indexOf(selectedAccountId)
          : -1

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
    [isActive, onTabChange, accountIds, selectedAccountId, onSwitchAccount, onClose]
  )

  useEffect(() => {
    if (!isActive) return

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActive, handleKeyDown])
}
