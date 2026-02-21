'use client'

import { useEffect, useCallback } from 'react'

interface UseContactNotesHotkeysOptions {
  /** Whether the Add Note drawer is currently open */
  isDrawerOpen: boolean
  /** Called to open the Add Note drawer */
  onOpenDrawer: () => void
}

/**
 * Keyboard shortcut handler for the Contact Notes panel.
 *
 * Shortcuts:
 * - `N`: Open the Add Note drawer (when drawer is closed and user is not typing in an input)
 *
 * Note: Escape-to-close is handled by ContextDrawer itself.
 *       Cmd+Enter-to-submit is handled inside AddNoteDrawer via onKeyDown on the form.
 */
export function useContactNotesHotkeys({
  isDrawerOpen,
  onOpenDrawer,
}: UseContactNotesHotkeysOptions): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't fire when modifier keys are held
      if (event.metaKey || event.ctrlKey || event.altKey) return

      // Don't fire when the user is typing in a form element
      const target = event.target as HTMLElement
      const isTyping =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        // Check both the computed property and the attribute for JSDOM compatibility
        target.isContentEditable ||
        target.getAttribute?.('contenteditable') === 'true'

      if (isTyping) return

      // N — open Add Note drawer (only when drawer is closed)
      if (!isDrawerOpen && (event.key === 'n' || event.key === 'N')) {
        event.preventDefault()
        onOpenDrawer()
      }
    },
    [isDrawerOpen, onOpenDrawer]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
