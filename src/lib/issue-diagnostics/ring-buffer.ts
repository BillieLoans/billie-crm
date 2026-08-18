import { ISSUE_BUFFER_TTL_MS } from './constants'

interface StoredBuffer<T> {
  /** When the buffer was last written (epoch ms) — drives TTL expiry */
  savedAt: number
  entries: T[]
}

export interface RingBuffer<T> {
  /** Append an entry, evicting the oldest once `max` is exceeded */
  push: (entry: T) => void
  /** Read the current entries (empty if expired, missing, or unreadable) */
  read: () => T[]
  /** Drop the buffer entirely */
  clear: () => void
}

/**
 * A tiny localStorage-backed ring buffer.
 *
 * Follows the manual load/save + cap + TTL pattern used by
 * src/stores/failed-actions.ts. Every storage access is wrapped in try/catch
 * so a quota error, disabled storage, or SSR render can never throw into a
 * caller — diagnostics collection is strictly best-effort.
 */
export function createRingBuffer<T>(storageKey: string, max: number): RingBuffer<T> {
  function load(): T[] {
    if (typeof window === 'undefined') return []

    try {
      const stored = localStorage.getItem(storageKey)
      if (!stored) return []

      const parsed: StoredBuffer<T> = JSON.parse(stored)
      if (!parsed || !Array.isArray(parsed.entries)) return []

      // Whole-buffer TTL: stale diagnostics are worse than none
      if (Date.now() - Number(parsed.savedAt ?? 0) > ISSUE_BUFFER_TTL_MS) return []

      return parsed.entries.slice(-max)
    } catch {
      // Ignore localStorage / JSON errors
      return []
    }
  }

  function save(entries: T[]): void {
    if (typeof window === 'undefined') return

    try {
      const payload: StoredBuffer<T> = { savedAt: Date.now(), entries: entries.slice(-max) }
      localStorage.setItem(storageKey, JSON.stringify(payload))
    } catch {
      // Ignore localStorage errors (quota, private mode)
    }
  }

  return {
    push: (entry) => {
      try {
        save([...load(), entry])
      } catch {
        // Never let tracking break the app
      }
    },

    read: () => load(),

    clear: () => {
      if (typeof window === 'undefined') return

      try {
        localStorage.removeItem(storageKey)
      } catch {
        // Ignore localStorage errors
      }
    },
  }
}
