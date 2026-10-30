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
 * Kept in sessionStorage (so per browser tab), one entry per loan,
 * `{ ownerId, request }`:
 * - it survives closing the drawer, moving between accounts and reloading the
 *   page, which is how an operator loses a drawer's state; parent React state
 *   would not survive a reload;
 * - it belongs to the CRM user who made the request (`ownerId`, the user id
 *   the routes record as the actor), on read AND write. Only the owner is
 *   offered it; only the owner can replace or clear it. Another user in the
 *   same tab never sees its note, cannot resume it, and cannot overwrite or
 *   delete it (R26, fix round 3); their own request is then not kept here;
 * - UserSessionGuard sweeps the entries of the tab it runs in
 *   (`clearAllFrozenCancellations`) when it sees the signed-in user change or
 *   sign out. It compares against the user in shared localStorage, so another
 *   tab can change user without that tab's entries being swept: owner scoping
 *   is what protects them. Closing the tab ends its entries. A cancel left
 *   part-way by a user change is finished through the platform runbook's
 *   guard-recovery path.
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

/** The owner of this loan's entry, or null when there is none (or it is unreadable). */
function entryOwner(store: Storage, loanAccountId: string): string | null {
  try {
    const raw = store.getItem(frozenCancellationKey(loanAccountId))
    if (!raw) return null
    const entry = JSON.parse(raw) as { ownerId?: unknown } | null
    return entry && typeof entry.ownerId === 'string' && entry.ownerId ? entry.ownerId : null
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

/**
 * Keep the request for `ownerId`. Returns false when it could not be kept:
 * no owner, no storage, or another user's unfinished request already holds
 * this loan's entry (it is never overwritten).
 */
export function saveFrozenCancellation(
  request: FrozenCancellation,
  ownerId: string | null | undefined,
): boolean {
  if (!ownerId) return false
  try {
    const store = storage()
    if (!store) return false
    const owner = entryOwner(store, request.loanAccountId)
    if (owner && owner !== ownerId) return false
    store.setItem(
      frozenCancellationKey(request.loanAccountId),
      JSON.stringify({ ownerId, request }),
    )
    return true
  } catch {
    return false
  }
}

/**
 * Whether another user's unfinished request holds this loan's entry, so a
 * request from `ownerId` cannot be kept here.
 */
export function frozenCancellationHeldByAnother(
  loanAccountId: string,
  ownerId: string | null | undefined,
): boolean {
  try {
    const store = storage()
    const owner = store ? entryOwner(store, loanAccountId) : null
    return owner !== null && owner !== ownerId
  } catch {
    return false
  }
}

/** Forget `ownerId`'s request for this loan: the platform's answer settled it. */
export function clearFrozenCancellation(
  loanAccountId: string,
  ownerId: string | null | undefined,
): void {
  if (!ownerId) return
  try {
    const store = storage()
    if (!store || entryOwner(store, loanAccountId) !== ownerId) return
    store.removeItem(frozenCancellationKey(loanAccountId))
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
