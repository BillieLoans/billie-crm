'use client'

import { useEffect, useRef } from 'react'
import { describeSettledMutation } from '@/lib/announcements'
import { useAnnouncerStore } from '@/stores/announcer'
import { useOptimisticStore } from '@/stores/optimistic'

/**
 * Speaks settled optimistic mutations — docs/ux-standards.md §1.2 (SC 4.1.3).
 *
 * Subscribes outside React so it observes every store write, including
 * rollbacks triggered from outside a component tree. Announced mutation ids are
 * remembered for the lifetime of the mount so a re-render or a repeated
 * setStage call cannot announce the same outcome twice.
 */
export function useOptimisticAnnouncements(): void {
  const announcedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const announced = announcedRef.current

    return useOptimisticStore.subscribe((state) => {
      for (const [accountId, mutations] of state.pendingByAccount) {
        for (const mutation of mutations.values()) {
          const key = `${accountId}:${mutation.id}:${mutation.stage}`
          if (announced.has(key)) continue

          const announcement = describeSettledMutation(mutation)
          if (!announcement) continue

          announced.add(key)
          useAnnouncerStore.getState().announce(announcement.text, announcement.urgency)
        }
      }
    })
  }, [])
}
