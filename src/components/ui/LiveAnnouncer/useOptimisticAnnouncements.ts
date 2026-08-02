'use client'

import { useEffect } from 'react'
import { describeSettledMutation } from '@/lib/announcements'
import { useAnnouncerStore } from '@/stores/announcer'
import { useOptimisticStore } from '@/stores/optimistic'
import type { MutationStage, PendingMutation } from '@/types/mutation'

/**
 * Module-scope, not a ref: settled mutations linger in the optimistic store
 * for a couple of seconds after they settle (see useWaiveFee's delayed
 * clearPending call) so the UI can show a "confirmed" state before it
 * disappears. LiveAnnouncer can legitimately unmount and remount inside that
 * window (e.g. a providers-tree remount) — a per-instance useRef would start
 * empty on remount and re-announce an outcome the user already heard. This
 * map outlives any single component instance so the dedupe record survives.
 *
 * Pruned on every optimistic-store write (and once more on mount) so it
 * never grows unbounded across a long-lived admin session: once a mutation
 * is no longer present in `pendingByAccount` — i.e. clearPending finally
 * ran — its announced-stage record is dropped too.
 */
const announcedByAccount = new Map<string, Map<string, Set<MutationStage>>>()

function pruneAnnounced(pendingByAccount: Map<string, Map<string, PendingMutation>>): void {
  for (const [accountId, mutations] of announcedByAccount) {
    const current = pendingByAccount.get(accountId)
    for (const mutationId of mutations.keys()) {
      if (!current?.has(mutationId)) mutations.delete(mutationId)
    }
    if (mutations.size === 0) announcedByAccount.delete(accountId)
  }
}

function wasAnnounced(accountId: string, mutationId: string, stage: MutationStage): boolean {
  return announcedByAccount.get(accountId)?.get(mutationId)?.has(stage) ?? false
}

function markAnnounced(accountId: string, mutationId: string, stage: MutationStage): void {
  let mutations = announcedByAccount.get(accountId)
  if (!mutations) {
    mutations = new Map()
    announcedByAccount.set(accountId, mutations)
  }
  let stages = mutations.get(mutationId)
  if (!stages) {
    stages = new Set()
    mutations.set(mutationId, stages)
  }
  stages.add(stage)
}

/**
 * Speaks settled optimistic mutations — docs/ux-standards.md §1.2 (SC 4.1.3).
 *
 * Subscribes outside React so it observes every store write, including
 * rollbacks triggered from outside a component tree. See `announcedByAccount`
 * above for why the dedupe record lives at module scope rather than in a ref.
 */
export function useOptimisticAnnouncements(): void {
  useEffect(() => {
    // Prune on mount too: if the store itself was reset (a genuine account
    // switch, or a test's beforeEach) since the last time this hook ran,
    // stale dedupe records for mutations that no longer exist should not
    // carry forward — but a mutation still resident in the store survives.
    pruneAnnounced(useOptimisticStore.getState().pendingByAccount)

    return useOptimisticStore.subscribe((state) => {
      pruneAnnounced(state.pendingByAccount)

      for (const [accountId, mutations] of state.pendingByAccount) {
        for (const mutation of mutations.values()) {
          if (wasAnnounced(accountId, mutation.id, mutation.stage)) continue

          const announcement = describeSettledMutation(mutation)
          if (!announcement) continue

          markAnnounced(accountId, mutation.id, mutation.stage)
          useAnnouncerStore.getState().announce(announcement.text, announcement.urgency)
        }
      }
    })
  }, [])
}
