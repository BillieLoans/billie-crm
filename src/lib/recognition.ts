/**
 * Identity-recognition helpers for review-kind re-application halts.
 *
 * A "review" halt isn't a confirmed block — the applicant was flagged as a
 * probable returning customer and auto-held for manual review. The recognition
 * payload carries the match score and, per matched candidate, a per-signal
 * evidence breakdown. These helpers shape that breakdown for the reviewer:
 *
 * - `name`/`dob` are the identity core — only these can confirm a real match.
 * - `email`/`bank`/`address`/`phone` are corroborating hints (shared/duplicate
 *   contact details, not identity).
 *
 * Positive bits = the signal agrees (evidence of the same person); negative =
 * it disagrees. A high score driven by agreeing hints but disagreeing core
 * means "same contact details, different identity" — the thing a reviewer most
 * needs to see, which is why the core is grouped and surfaced separately.
 */

/** Identity core — the only signals that can confirm a real identity match. */
export const CORE_SIGNALS = ['name', 'dob'] as const

/** Corroborating hints — shared contact data, not proof of identity. */
export const CORROBORATING_SIGNALS = ['email', 'bank', 'address', 'phone'] as const

const SIGNAL_LABELS: Record<string, string> = {
  name: 'Name',
  dob: 'DOB',
  email: 'Email',
  bank: 'Bank',
  address: 'Address',
  phone: 'Phone',
}

export type SignalSign = 'agrees' | 'disagrees' | 'neutral'

export interface SignalEntry {
  signal: string
  bits: number
  sign: SignalSign
}

export interface GroupedSignals {
  core: SignalEntry[]
  corroborating: SignalEntry[]
}

/** Render a 0..1 match score as a 2-dp percentage; em dash when absent. */
export function formatPosterior(posterior: number | null | undefined): string {
  if (posterior == null || Number.isNaN(posterior)) return '—'
  return `${(posterior * 100).toFixed(2)}%`
}

/** Positive bits agree (same person), negative disagree, zero is neutral. */
export function signalSign(bits: number): SignalSign {
  if (bits > 0) return 'agrees'
  if (bits < 0) return 'disagrees'
  return 'neutral'
}

/** Signed, 1-dp evidence weight for a chip (e.g. "+10.0", "-5.1"). */
export function formatSignalBits(bits: number): string {
  const rounded = bits.toFixed(1)
  return bits > 0 ? `+${rounded}` : rounded
}

/** Staff-facing label for a signal; title-cases unknown signals. */
export function signalLabel(signal: string): string {
  return SIGNAL_LABELS[signal] ?? signal.charAt(0).toUpperCase() + signal.slice(1)
}

function toEntry(signal: string, bits: number): SignalEntry {
  return { signal, bits, sign: signalSign(bits) }
}

/**
 * Split a per-signal bit map into identity-core and corroborating groups in a
 * fixed canonical order (so a chip never changes position between candidates).
 * Unknown future signals are appended to corroborating rather than dropped.
 */
export function groupSignalBits(
  perSignalBits: Record<string, number> | null | undefined,
): GroupedSignals {
  if (!perSignalBits) return { core: [], corroborating: [] }

  const core: SignalEntry[] = []
  for (const signal of CORE_SIGNALS) {
    if (signal in perSignalBits) core.push(toEntry(signal, perSignalBits[signal]))
  }

  const corroborating: SignalEntry[] = []
  for (const signal of CORROBORATING_SIGNALS) {
    if (signal in perSignalBits) corroborating.push(toEntry(signal, perSignalBits[signal]))
  }

  const known = new Set<string>([...CORE_SIGNALS, ...CORROBORATING_SIGNALS])
  for (const [signal, bits] of Object.entries(perSignalBits)) {
    if (!known.has(signal)) corroborating.push(toEntry(signal, bits))
  }

  return { core, corroborating }
}
