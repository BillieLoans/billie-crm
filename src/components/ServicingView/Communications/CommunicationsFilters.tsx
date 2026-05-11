'use client'

import React, { useCallback, useRef } from 'react'
import styles from './styles.module.css'

export type CommunicationsFilter = 'all' | 'notes' | 'sent' | 'failed' | 'blocked'

export interface CommunicationsFiltersProps {
  active: CommunicationsFilter
  onChange: (filter: CommunicationsFilter) => void
}

const FILTERS: { value: CommunicationsFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'notes', label: 'Notes' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
  { value: 'blocked', label: 'Blocked' },
]

export const CommunicationsFilters: React.FC<CommunicationsFiltersProps> = ({
  active,
  onChange,
}) => {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([])

  const focusAt = useCallback((index: number) => {
    const len = FILTERS.length
    const target = buttonRefs.current[(index + len) % len]
    target?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        focusAt(index + 1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        focusAt(index - 1)
      } else if (event.key === 'Home') {
        event.preventDefault()
        focusAt(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        focusAt(FILTERS.length - 1)
      }
    },
    [focusAt],
  )

  return (
    <div className={styles.filtersBar} role="radiogroup" aria-label="Communications filter">
      {FILTERS.map((filter, index) => {
        const isActive = filter.value === active
        return (
          <button
            key={filter.value}
            ref={(el) => {
              buttonRefs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`${styles.filterChip} ${isActive ? styles.filterChipActive : ''}`}
            onClick={() => onChange(filter.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            data-testid={`comms-filter-${filter.value}`}
          >
            {filter.label}
          </button>
        )
      })}
    </div>
  )
}
