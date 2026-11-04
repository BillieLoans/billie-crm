'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The platform's answer to "would DisburseLoan accept this loan right now?".
 * Mirrors GET /api/ledger/disbursable, which relays the ledger's
 * CheckDisbursable RPC.
 */
export interface DisbursableVerdict {
  disbursable: boolean
  /**
   * DISBURSABLE | CANCELLED | ALREADY_DISBURSED | NOT_PENDING_DISBURSEMENT |
   * NO_LEDGER_RECORD. Callers must tolerate any other string.
   */
  reason: string
  /** The platform's status for the loan; empty when it has no record. */
  status: string
  /** The platform's human-readable explanation. */
  message: string
}

/**
 * `checking` until the platform answers. `failed` is every way of not getting a
 * usable answer (network error, 401, 5xx, a body that is not a verdict): the
 * caller must treat it as "do not pay", never as "probably fine", and may offer
 * Retry. `forbidden` is a 403: the signed-in role may not ask, which asking again
 * cannot change, so there is nothing to retry. The payout details stay hidden
 * either way.
 */
export type DisbursableCheckState =
  | { status: 'checking' }
  | { status: 'answered'; verdict: DisbursableVerdict }
  | { status: 'forbidden' }
  | { status: 'failed' }

export interface UseDisbursableCheckResult {
  state: DisbursableCheckState
  /** Ask again. The panel shows no payout details while the new answer is awaited. */
  retry: () => void
}

/** Narrow an unknown JSON body to a verdict, or null when it is not one. */
function parseVerdict(body: unknown): DisbursableVerdict | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (typeof b.disbursable !== 'boolean' || typeof b.reason !== 'string') return null
  return {
    disbursable: b.disbursable,
    reason: b.reason,
    status: typeof b.status === 'string' ? b.status : '',
    message: typeof b.message === 'string' ? b.message : '',
  }
}

const CHECKING: DisbursableCheckState = { status: 'checking' }

/**
 * Ask the platform, the system of record, whether a loan can be disbursed
 * (BTB-517). The CRM is a projection and can show a stale status, so the
 * payment panel gates everything on this answer. The CRM applies no rule of its
 * own here; it only carries the verdict.
 *
 * Deliberately not react-query: the answer must be fresh every time a panel
 * opens, never served from a cache, and a retry must replace it outright.
 *
 * A response that arrives after the effect has been cleaned up (the panel
 * closed, the loan changed, or Retry started a newer request) is dropped, so a
 * slow earlier answer can never overwrite a later one or set state on an
 * unmounted component.
 */
export function useDisbursableCheck(loanAccountId: string): UseDisbursableCheckResult {
  const [attempt, setAttempt] = useState(0)
  // The outcome is stored with the request it answers. The state handed back is
  // derived from it, so a new loan or a Retry reads as `checking` on the very
  // render that changes the key, never as the previous request's answer.
  const [settled, setSettled] = useState<{
    key: string
    outcome: Exclude<DisbursableCheckState, { status: 'checking' }>
  } | null>(null)
  const key = `${loanAccountId}#${attempt}`

  useEffect(() => {
    let superseded = false
    const controller = new AbortController()

    const run = async () => {
      try {
        const res = await fetch(
          `/api/ledger/disbursable?loanAccountId=${encodeURIComponent(loanAccountId)}`,
          { cache: 'no-store', signal: controller.signal },
        )
        if (res.status === 403) {
          if (!superseded) setSettled({ key, outcome: { status: 'forbidden' } })
          return
        }
        if (!res.ok) throw new Error(`disbursable check answered ${res.status}`)
        const verdict = parseVerdict(await res.json())
        if (!verdict) throw new Error('disbursable check returned a malformed body')
        if (!superseded) setSettled({ key, outcome: { status: 'answered', verdict } })
      } catch (err) {
        if (superseded) return
        console.error('[disbursable-check] could not confirm with the platform:', err)
        setSettled({ key, outcome: { status: 'failed' } })
      }
    }
    void run()

    return () => {
      superseded = true
      controller.abort()
      // Forget this request's answer, so coming back to the same loan later can
      // never show a verdict from before it was asked again.
      setSettled(null)
    }
  }, [loanAccountId, key])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  const state: DisbursableCheckState = settled && settled.key === key ? settled.outcome : CHECKING
  return { state, retry }
}
