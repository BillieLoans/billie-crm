'use client'

import React, { useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useConversations } from '@/hooks/queries/useConversations'
import { useConversationFiltersStore } from '@/stores/conversationFilters'
import { useMonitoringGridStore } from '@/stores/monitoringGrid'
import { ConversationCard } from './ConversationCard'
import { FilterBar } from './FilterBar'
import { FreshnessIndicator } from './FreshnessIndicator'
import styles from './styles.module.css'

/**
 * ApplicationsView renders the conversation monitoring grid with:
 * - Real-time polling (5s)
 * - Search and filter bar
 * - Responsive card grid (3-col → 2-col → 1-col)
 * - Skeleton loaders on first load
 * - Cursor-based pagination ("Load more")
 * - Scroll position preservation
 * - Freshness indicator
 * - Keyboard navigation (arrow keys, Enter, /)
 *
 * Story 2.1-2.4: ApplicationsView scaffold, cards, grid, filters
 */
export function ApplicationsView() {
  const { filters, hasActiveFilters } = useConversationFiltersStore()
  const { scrollPosition, setScrollPosition } = useMonitoringGridStore()
  const router = useRouter()

  const { data, isLoading, dataUpdatedAt, fetchNextPage, isFetchingNextPage } = useConversations({
    filters: {
      status: filters.status || undefined,
      decision: filters.decision || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      q: filters.q || undefined,
    },
  }) as ReturnType<typeof useConversations> & {
    fetchNextPage?: () => void
    isFetchingNextPage?: boolean
  }

  const conversations = data?.conversations ?? []
  const hasMore = data?.hasMore ?? false
  const total = data?.total ?? 0

  // Restore scroll position when returning to this view
  useEffect(() => {
    if (scrollPosition > 0) {
      window.scrollTo({ top: scrollPosition, behavior: 'instant' })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Save scroll position before navigating away
  useEffect(() => {
    const handleScroll = () => setScrollPosition(window.scrollY)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [setScrollPosition])

  // Keyboard navigation: arrow keys to move between cards, Enter to open
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>('[data-conversation-card]'),
    )
    const current = document.activeElement as HTMLElement
    const idx = cards.indexOf(current)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      cards[Math.min(idx + 1, cards.length - 1)]?.focus()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      cards[Math.max(idx - 1, 0)]?.focus()
    }
  }, [])

  const clearFilters = useConversationFiltersStore((state) => state.clearFilters)

  return (
    <div className={styles.container} onKeyDown={handleKeyDown}>
      <div className={styles.header}>
        <h1 className={styles.title}>Applications</h1>
        <div className={styles.headerRight}>
          {!isLoading && (
            <span style={{ fontSize: 13, color: 'var(--theme-elevation-500)' }}>
              {total} {total === 1 ? 'application' : 'applications'}
            </span>
          )}
          <FreshnessIndicator dataUpdatedAt={dataUpdatedAt} />
        </div>
      </div>

      <FilterBar />

      <div className={styles.grid}>
        {isLoading ? (
          // Skeleton loaders — 6 cards (NFR1)
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles.skeletonCard} aria-hidden="true" />
          ))
        ) : conversations.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyStateTitle}>No applications found</p>
            {hasActiveFilters() ? (
              <>
                <p className={styles.emptyStateText}>No conversations match your filters.</p>
                <button
                  type="button"
                  className={styles.clearFiltersBtn}
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              </>
            ) : (
              <p className={styles.emptyStateText}>Check back later for new applications.</p>
            )}
          </div>
        ) : (
          <>
            {conversations.map((conv) => (
              <div key={conv.conversationId} data-conversation-card="true">
                <ConversationCard conversation={conv} />
              </div>
            ))}

            {hasMore && (
              <div className={styles.loadMore}>
                <button
                  type="button"
                  className={styles.loadMoreBtn}
                  onClick={() => fetchNextPage?.()}
                  disabled={isFetchingNextPage}
                  aria-label="Load more conversations"
                >
                  {isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
