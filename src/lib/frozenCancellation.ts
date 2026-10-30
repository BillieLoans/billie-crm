/**
 * A Cancel loan request whose outcome is unknown (BTB-517).
 *
 * After a 5xx, a 409 or no response, the platform may already hold a
 * cancellation claim for the request's idempotency key. Only a retry with the
 * SAME key finishes it; any other key is refused ("not cancellable in status
 * CANCELLED"), which would leave the loan neither cancelled nor disbursable,
 * with no event and no note. So the drawer keeps the exact request, key and
 * all, until an answer settles it, even when the drawer is closed and opened
 * again.
 *
 * Kept in sessionStorage, one entry per loan, `{ ownerId, request }`:
 * - it survives closing the drawer, moving between accounts and reloading the
 *   page, which is how an operator loses a drawer's state; parent React state
 *   would not survive a reload;
 * - it belongs to the CRM user who made the request (`ownerId`, the user id
 *   the routes record as the actor). Only that user is offered it: another
 *   user signed in to the same tab never sees its note or resumes it, and the
 *   entry is left for its owner (R26);
 * - UserSessionGuard sweeps every entry (`clearAllFrozenCancellations`) when
 *   the signed-in user changes or signs out, and the tab closing ends them
 *   all, so a note about a customer does not outlive the session on a shared
 *   machine. A cancel left part-way by a user change is finished through the
 *   platform runbook's guard-recovery path.
 *
 * Every access is guarded: storage can be missing or throw (private modes,
 * blocked site data, the server render). Callers learn from `save` whether
 * the request was kept, and must not let the drawer close if it was not.
 */

import { CancelAccountSchema, type CancelAccount } from '@/lib/schemas/ledger'

export type FrozenCancellation = CancelAccount

const KEY_PREFIX = 'btb517:cancel:'

export function frozenCancellationKey(loanAccountId: string): string {
  return `${KEY_PREFIX}${loanAccountId}`
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/**
 * The frozen request for this loan made by `ownerId`, or null: none, unreadable,
 * or another user's (which stays where it is, for them).
 */
export function loadFrozenCancellation(
  loanAccountId: string,
  ownerId: string | null | undefined,
): FrozenCancellation | null {
  if (!ownerId) return null
  try {
    const raw = storage()?.getItem(frozenCancellationKey(loanAccountId))
    if (!raw) return null
    const entry = JSON.parse(raw) as { ownerId?: unknown; request?: unknown } | null
    if (!entry || entry.ownerId !== ownerId) return null
    const parsed = CancelAccountSchema.safeParse(entry.request)
    if (!parsed.success || parsed.data.loanAccountId !== loanAccountId) return null
    return parsed.data
  } catch {
    return null
  }
}

/** Keep the request for `ownerId`. Returns false when it could not be kept. */
export function saveFrozenCancellation(
  request: FrozenCancellation,
  ownerId: string | null | undefined,
): boolean {
  if (!ownerId) return false
  try {
    const store = storage()
    if (!store) return false
    store.setItem(
      frozenCancellationKey(request.loanAccountId),
      JSON.stringify({ ownerId, request }),
    )
    return true
  } catch {
    return false
  }
}

/** Forget the request: the platform's answer settled it. */
export function clearFrozenCancellation(loanAccountId: string): void {
  try {
    storage()?.removeItem(frozenCancellationKey(loanAccountId))
  } catch {
    // Best effort: a request left behind is offered again, and its retry
    // settles it.
  }
}

/** Forget every frozen request in this tab: the signed-in user changed (R26). */
export function clearAllFrozenCancellations(): void {
  try {
    const store = storage()
    if (!store) return
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key?.startsWith(KEY_PREFIX)) keys.push(key)
    }
    for (const key of keys) store.removeItem(key)
  } catch {
    // Best effort, like the rest of the session clear-out.
  }
}
