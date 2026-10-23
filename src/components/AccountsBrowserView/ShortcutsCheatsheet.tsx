'use client'

import React, { useEffect, useId, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { setSingleKeyShortcutsEnabled, singleKeyShortcutsEnabled } from '@/lib/keyboard'
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
    <Modal title="Keyboard shortcuts" onClose={onClose} maxWidth="520px">
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
      <SingleKeySetting />
    </Modal>
  )
}

/** The WCAG 2.1.4 switch, read when the list opens and saved per browser. */
function SingleKeySetting() {
  const id = useId()
  const [singleKeys, setSingleKeys] = useState(singleKeyShortcutsEnabled)
  return (
    <div className={styles.cheatsheetSetting}>
      <input
        id={`${id}-single`}
        type="checkbox"
        checked={singleKeys}
        onChange={(e) => {
          setSingleKeyShortcutsEnabled(e.target.checked)
          setSingleKeys(e.target.checked)
        }}
      />
      <label htmlFor={`${id}-single`}>
        Single-key shortcuts (letters, numbers and /, ?) across the CRM. Turn them off if they fire
        by accident, for example with speech input. Arrows, Enter and Esc keep working.
      </label>
    </div>
  )
}
