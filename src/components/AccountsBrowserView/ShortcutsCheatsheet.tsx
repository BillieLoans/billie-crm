'use client'

import React, { useEffect } from 'react'
import styles from './styles.module.css'

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['j', '↓'], label: 'Next row' },
  { keys: ['k', '↑'], label: 'Previous row' },
  { keys: ['Space'], label: 'Preview selected' },
  { keys: ['Enter', 'o'], label: 'Open servicing view' },
  { keys: ['c'], label: 'Copy account number' },
  { keys: ['/'], label: 'Focus search' },
  { keys: ['?'], label: 'Show this cheatsheet' },
  { keys: ['Esc'], label: 'Close drawer / modal' },
  { keys: ['⌘E'], label: 'Export current results to CSV' },
]

export interface ShortcutsCheatsheetProps {
  isOpen: boolean
  onClose: () => void
}

export const ShortcutsCheatsheet: React.FC<ShortcutsCheatsheetProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className={styles.modalOverlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Keyboard shortcuts</h2>
          <button
            type="button"
            className={styles.modalClose}
            onClick={onClose}
            aria-label="Close shortcuts"
          >
            ×
          </button>
        </div>
        <div className={styles.cheatsheet}>
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.label} className={styles.cheatsheetRow}>
              <span>{shortcut.label}</span>
              <span className={styles.cheatsheetKeys}>
                {shortcut.keys.map((k) => (
                  <kbd key={k} className={styles.kbd}>
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
