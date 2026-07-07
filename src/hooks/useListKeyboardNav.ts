'use client'

import { useEffect, useState, useCallback } from 'react'

export interface UseListKeyboardNavOptions {
  /** Number of items in the list. The hook keeps the cursor in `[-1, count)`. */
  count: number
  /** Called when Space is pressed on the selected row. */
  onPeek?: (index: number) => void
  /** Called when Enter (or `o`) is pressed on the selected row. */
  onOpen?: (index: number) => void
  /** Called when `c` is pressed on the selected row (copy account number). */
  onCopy?: (index: number) => void
  /** Whether the keyboard nav is active (e.g. disable when a modal is open). */
  enabled?: boolean
}

/**
 * Keyboard navigation for a flat list. Vim-style `j` / `k` plus arrow keys
 * move the cursor; Space peeks; Enter / `o` opens; `c` copies.
 *
 * The cursor index is returned so the consumer can render a focus ring.
 * `-1` means no row is selected (the initial state). The hook clamps the
 * cursor when `count` shrinks.
 *
 * Listeners are window-level and skipped when focus is in an input or
 * contentEditable element so typing in a search box doesn't move the cursor.
 */
export function useListKeyboardNav(options: UseListKeyboardNavOptions): {
  index: number
  setIndex: (i: number) => void
} {
  const { count, onPeek, onOpen, onCopy, enabled = true } = options
  const [index, setIndexRaw] = useState(-1)

  // Clamp when the list shrinks.
  useEffect(() => {
    if (index >= count) setIndexRaw(count - 1)
  }, [count, index])

  const setIndex = useCallback(
    (i: number) => {
      if (count === 0) {
        setIndexRaw(-1)
        return
      }
      const clamped = Math.max(0, Math.min(count - 1, i))
      setIndexRaw(clamped)
    },
    [count],
  )

  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inInput =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (inInput) return

      // Skip modifier-laden combos so we don't conflict with browser/system
      // shortcuts (Cmd+E for export is handled elsewhere).
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const key = e.key

      if (key === 'j' || key === 'ArrowDown') {
        e.preventDefault()
        setIndexRaw((prev) => {
          if (count === 0) return -1
          if (prev < 0) return 0
          return Math.min(count - 1, prev + 1)
        })
      } else if (key === 'k' || key === 'ArrowUp') {
        e.preventDefault()
        setIndexRaw((prev) => {
          if (count === 0) return -1
          if (prev <= 0) return 0
          return prev - 1
        })
      } else if (key === ' ' || key === 'Spacebar') {
        if (index >= 0 && index < count && onPeek) {
          e.preventDefault()
          onPeek(index)
        }
      } else if (key === 'Enter' || key === 'o') {
        if (index >= 0 && index < count && onOpen) {
          e.preventDefault()
          onOpen(index)
        }
      } else if (key === 'c') {
        if (index >= 0 && index < count && onCopy) {
          e.preventDefault()
          onCopy(index)
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, count, index, onPeek, onOpen, onCopy])

  return { index, setIndex }
}
