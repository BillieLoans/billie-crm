'use client'

import { useEffect, useMemo, useCallback } from 'react'

interface HotkeyConfig {
  /** Key to listen for (case-insensitive) */
  key: string
  /** Callback when hotkey is pressed */
  onPress: () => void
  /** Whether Cmd (Mac) or Ctrl (Windows) modifier is required */
  cmdOrCtrl?: boolean
  /** Whether the hotkey should work when an input is focused */
  allowInInput?: boolean
}

/**
 * Hook to register global keyboard shortcuts.
 * Handles Mac (Cmd) and Windows/Linux (Ctrl) modifier differences.
 *
 * @param hotkeys - Array of hotkey configurations (should be memoized by caller)
 */
export function useGlobalHotkeys(hotkeys: HotkeyConfig[]): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if we're in an input/textarea/contenteditable
      const target = e.target as HTMLElement
      const isInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      for (const hotkey of hotkeys) {
        // Skip if in input and not allowed
        if (isInput && !hotkey.allowInInput) {
          // Special case: always allow Escape
          if (hotkey.key.toLowerCase() !== 'escape') {
            continue
          }
        }

        // Check modifier key
        const cmdOrCtrlPressed = e.metaKey || e.ctrlKey
        if (hotkey.cmdOrCtrl && !cmdOrCtrlPressed) {
          continue
        }
        if (!hotkey.cmdOrCtrl && cmdOrCtrlPressed && hotkey.key.toLowerCase() !== 'escape') {
          // If no modifier required but one is pressed, skip (unless it's Escape)
          continue
        }

        // Check key match
        if (e.key.toLowerCase() === hotkey.key.toLowerCase()) {
          e.preventDefault()
          hotkey.onPress()
          return // Only trigger first matching hotkey
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hotkeys])
}

/**
 * Hook specifically for command palette hotkeys.
 * Opens on Cmd+K, Ctrl+K, or F7. Closes on Escape.
 *
 * @param isOpen - Current open state
 * @param onOpenChange - Callback to change open state
 */
export function useCommandPaletteHotkeys(
  isOpen: boolean,
  onOpenChange: (open: boolean) => void,
): void {
  // Memoize callbacks to prevent effect re-runs
  const handleToggle = useCallback(() => onOpenChange(!isOpen), [isOpen, onOpenChange])
  const handleOpen = useCallback(() => onOpenChange(true), [onOpenChange])
  const handleClose = useCallback(() => {
    if (isOpen) {
      onOpenChange(false)
    }
  }, [isOpen, onOpenChange])

  // Memoize hotkeys array to prevent effect re-runs on every render
  const hotkeys = useMemo<HotkeyConfig[]>(
    () => [
      {
        key: 'k',
        cmdOrCtrl: true,
        onPress: handleToggle,
        allowInInput: true,
      },
      {
        key: 'F7',
        onPress: handleOpen,
        allowInInput: true,
      },
      {
        key: 'Escape',
        onPress: handleClose,
        allowInInput: true,
      },
    ],
    [handleToggle, handleOpen, handleClose],
  )

  useGlobalHotkeys(hotkeys)
}
