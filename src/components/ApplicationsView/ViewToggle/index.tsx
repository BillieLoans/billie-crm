'use client'

import React from 'react'
import type { ApplicationsViewMode } from '@/stores/conversationFilters'
import styles from './styles.module.css'

interface ViewToggleProps {
  value: ApplicationsViewMode
  onChange: (mode: ApplicationsViewMode) => void
}

/**
 * Tiles | List segmented control for the Applications header.
 * A named group of real buttons with aria-pressed (ux-standards: toggle-button
 * groups), so the state is announced and each option is a Tab stop.
 */
export function ViewToggle({ value, onChange }: ViewToggleProps) {
  const pick = (mode: ApplicationsViewMode) => {
    if (mode !== value) onChange(mode)
  }

  return (
    <div role="group" aria-label="View as" className={styles.group}>
      <button
        type="button"
        className={styles.option}
        aria-pressed={value === 'tiles'}
        onClick={() => pick('tiles')}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
          <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
          <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
          <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
        </svg>
        Tiles
      </button>
      <button
        type="button"
        className={styles.option}
        aria-pressed={value === 'list'}
        onClick={() => pick('list')}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M2 4h12M2 8h12M2 12h12" />
        </svg>
        List
      </button>
    </div>
  )
}
