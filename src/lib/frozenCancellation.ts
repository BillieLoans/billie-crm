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
 * Kept in sessionStorage, one entry per loan:
 * - it survives closing the drawer, moving between accounts and reloading the
 *   page, which is how an operator loses a drawer's state;
 * - it goes when the tab closes, so the note (free text about a customer)
 *   never outlives the session on a shared machine, which localStorage would;
 * - parent React state would not survive a reload.
 *
 * Every access is guarded: storage can be missing or throw (private modes,
 * blocked site data, the server render). Callers learn from `save` whether
 * the request was kept, and must not let the drawer close if it was not.
 */

import { CancelAccountSchema, type CancelAccount } from '@/lib/schemas/ledger'

export type FrozenCancellation = CancelAccount

export function frozenCancellationKey(loanAccountId: string): string {
  return `btb517:cancel:${loanAccountId}`
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** The frozen request for this loan, or null when there is none (or it is unreadable). */
export function loadFrozenCancellation(loanAccountId: string): FrozenCancellation | null {
  try {
    const raw = storage()?.getItem(frozenCancellationKey(loanAccountId))
    if (!raw) return null
    const parsed = CancelAccountSchema.safeParse(JSON.parse(raw))
    if (!parsed.success || parsed.data.loanAccountId !== loanAccountId) return null
    return parsed.data
  } catch {
    return null
  }
}

/** Keep the request. Returns false when it could not be kept. */
export function saveFrozenCancellation(request: FrozenCancellation): boolean {
  try {
    const store = storage()
    if (!store) return false
    store.setItem(frozenCancellationKey(request.loanAccountId), JSON.stringify(request))
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
