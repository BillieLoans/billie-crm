/**
 * Cancelling a loan before disbursement (BTB-517): the reason codes, how staff
 * read them, and the system note the cancel route writes to the customer's
 * contact timeline.
 *
 * The codes are the platform's `CancelAccount` reason codes, lower case,
 * exactly as stored in `loan_accounts.cancellation_reason`.
 * `lender_declined_pre_disbursement` exists on the platform but is reserved,
 * so it is deliberately not offered here.
 */

export const CANCELLATION_REASON_CODES = [
  'mutual_cancellation',
  'customer_withdrew',
  'offer_lapsed',
  'fraud_hold',
  'duplicate',
] as const

export type CancellationReasonCode = (typeof CANCELLATION_REASON_CODES)[number]

export const CANCELLATION_REASON_LABELS: Record<CancellationReasonCode, string> = {
  mutual_cancellation: 'Mutual cancellation',
  customer_withdrew: 'Customer withdrew',
  offer_lapsed: 'Offer lapsed',
  fraud_hold: 'Fraud hold',
  duplicate: 'Duplicate',
}

/** Staff-facing label for a stored reason code. An unknown code is shown as it is. */
export function cancellationReasonLabel(code: string | null | undefined): string {
  if (!code) return '—'
  return (CANCELLATION_REASON_LABELS as Record<string, string>)[code] ?? code
}

/** Subject of the system contact note written for a cancel. */
export const CANCELLATION_NOTE_SUBJECT = 'Loan cancelled before disbursement'

/** Shown in the note when the loan was cancelled without a staff-supplied evidence reference. */
const NO_EVIDENCE = 'none'

// Same shape staff see on every other contact note (ContactNoteCard), but pinned
// to the business time zone: the note is stored text, so the server's own zone
// must not decide what it says.
const noteTimeFormatter = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Australia/Sydney',
})

/**
 * "30 Oct 2026, 3:45 pm", in Sydney time. Newer ICU puts a narrow no-break
 * space before "pm"; it is stored as an ordinary space so the note text is
 * stable and searchable. Anything that is not a date comes back as it was.
 */
export function formatCancellationTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return String(value)
  return noteTimeFormatter.format(date).replace(/[  ]/g, ' ')
}

export interface CancellationNoteInput {
  /** The reason code, as sent to the ledger. */
  reason: string
  note: string
  actorName: string
  /** When the platform recorded the cancel (ISO 8601). */
  cancelledAt: string | Date
  evidenceRef?: string | null
}

/** `Cancelled — {reason} — {note} — by {name} at {time} — evidence: {ref}` */
export function buildCancellationNoteText(input: CancellationNoteInput): string {
  const evidence = input.evidenceRef?.trim() || NO_EVIDENCE
  return [
    'Cancelled',
    cancellationReasonLabel(input.reason),
    input.note,
    `by ${input.actorName} at ${formatCancellationTime(input.cancelledAt)}`,
    `evidence: ${evidence}`,
  ].join(' — ')
}
