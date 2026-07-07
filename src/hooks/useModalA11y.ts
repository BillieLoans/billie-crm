'use client'

import { useEffect } from 'react'

/**
 * Minimal modal accessibility: close on Escape while mounted. Pair with
 * role="dialog" aria-modal="true" on the overlay's dialog element (see
 * CommandPalette for the full in-repo pattern).
 */
export function useEscapeClose(onClose: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
}
