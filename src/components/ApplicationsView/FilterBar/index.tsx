'use client'

import React, { useCallback, useMemo, useRef, useEffect } from 'react'
import { useConversationFiltersStore } from '@/stores/conversationFilters'
import styles from './styles.module.css'

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }) as T
}

/**
 * FilterBar provides search input, status/decision/date filters for the monitoring grid.
 *
 * Features:
 * - 300ms debounced text search (FR5, NFR3)
 * - Status, decision, and date range dropdowns (FR6, FR7, FR8)
 * - AND logic — all filters apply simultaneously (FR9)
 * - URL sync via query params (shareable filtered views)
 * - "/" keyboard shortcut focuses search (keyboard nav)
 * - "Clear filters" button
 *
 * Story 2.4: Conversation Search & Filtering
 */
export function FilterBar() {
  const { filters, setFilter, clearFilters, hasActiveFilters } = useConversationFiltersStore()
  const searchRef = useRef<HTMLInputElement>(null)

  // "/" shortcut focuses search input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Debounced search (300ms) — useMemo so the debounced fn is created once per setFilter
  const debouncedSetSearch = useMemo(
    () => debounce((value: string) => setFilter('q', value), 300),
    [setFilter],
  )

  return (
    <div className={styles.filterBar} role="search" aria-label="Filter conversations">
      <input
        ref={searchRef}
        type="search"
        placeholder="Search by customer name or app number (press /)"
        className={styles.searchInput}
        defaultValue={filters.q}
        onChange={(e) => debouncedSetSearch(e.target.value)}
        aria-label="Search conversations"
      />

      <select
        className={styles.select}
        value={filters.status}
        onChange={(e) => setFilter('status', e.target.value)}
        aria-label="Filter by conversation status"
        title="Conversation status — where the chat sits in its lifecycle (still talking, paused, ended)"
      >
        <option value="">Conversation: any</option>
        <option value="active">Conversation: Active</option>
        <option value="paused">Conversation: Paused</option>
        <option value="soft_end">Conversation: Soft End</option>
        <option value="hard_end">Conversation: Hard End</option>
        <option value="ended">Conversation: Ended</option>
      </select>

      <select
        className={styles.select}
        value={filters.decision}
        onChange={(e) => setFilter('decision', e.target.value)}
        aria-label="Filter by loan decision"
        title="Loan decision — the underwriting outcome of the application (approved, declined, referred)"
      >
        <option value="">Decision: any</option>
        <option value="approved">Decision: Approved</option>
        <option value="declined">Decision: Declined</option>
        <option value="referred">Decision: Referred</option>
        <option value="no_decision">Decision: Pending</option>
      </select>

      <input
        type="date"
        className={styles.dateInput}
        value={filters.from}
        onChange={(e) => setFilter('from', e.target.value)}
        aria-label="From date"
        title="From date"
      />

      <input
        type="date"
        className={styles.dateInput}
        value={filters.to}
        onChange={(e) => setFilter('to', e.target.value)}
        aria-label="To date"
        title="To date"
      />

      {hasActiveFilters() && (
        <button
          type="button"
          className={styles.clearBtn}
          onClick={clearFilters}
          aria-label="Clear all filters"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
