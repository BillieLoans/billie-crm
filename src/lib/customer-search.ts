/**
 * Shared customer search helpers for the conversations list route and the
 * command-palette customer search.
 *
 * Phone numbers are stored on customers as raw event-stream passthrough —
 * either local (0412345678) or E.164 (+61412345678) — so a substring match on
 * the typed term alone misses format mismatches. phoneSearchVariants expands a
 * phone-like term into both canonical forms (same normalisation rules as the
 * event processor's normalise_au_mobile).
 */

import type { Where } from 'payload'

/** Phone-like: 6-15 digits after separators are stripped, optional leading +. */
const PHONE_LIKE = /^\+?\d{6,15}$/

export function phoneSearchVariants(term: string): string[] {
  const stripped = term.trim().replace(/[\s\-().]/g, '')
  if (!PHONE_LIKE.test(stripped)) return []

  const candidates = new Set<string>([stripped])
  const digits = stripped.replace(/^\+/, '')

  if (digits.startsWith('61')) {
    candidates.add('+' + digits)
    candidates.add('0' + digits.slice(2))
  } else if (digits.startsWith('0')) {
    candidates.add('+61' + digits.slice(1))
  } else if (digits.startsWith('4')) {
    candidates.add('0' + digits)
    candidates.add('+61' + digits)
  }

  candidates.delete(term.trim())
  return [...candidates]
}

type MatchOp = 'like' | 'contains'

/**
 * OR clauses matching a customer by full name, email address, or mobile phone
 * number (in any common AU format). Callers AND/extend these as needed.
 */
export function customerSearchOrClauses(term: string, op: MatchOp): Where[] {
  return [
    { fullName: { [op]: term } },
    { emailAddress: { [op]: term } },
    { mobilePhoneNumber: { [op]: term } },
    ...phoneSearchVariants(term).map((v) => ({ mobilePhoneNumber: { [op]: v } })),
  ]
}
