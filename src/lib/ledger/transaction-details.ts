/**
 * Maps a ledger transaction's `metadata` / `description` / `notes` onto the
 * label-value pairs the Transactions tab shows when a row is expanded.
 *
 * The ledger stamps a different metadata key set per transaction type (see
 * `accountingLedgerService/commands.py`), so the mapping is curated per type
 * rather than dumping every key: the raw keys are snake_case internals, and a
 * few of them are structural values that `map<string, string>` forces through
 * `str()` on the way out (see `parseAllocation`).
 */

import { formatCurrency, formatDateMedium } from '@/lib/formatters'

/** How the value should be rendered. `longform` spans the full panel width. */
export type TransactionDetailVariant = 'text' | 'mono' | 'longform'

export interface TransactionDetailField {
  label: string
  value: string
  variant: TransactionDetailVariant
}

/**
 * The subset of a transaction this mapping reads. `createdAt` is typed as a
 * string on the client, but the transactions route passes the proto Timestamp
 * straight through, so it arrives as `{ seconds }` in practice.
 */
export interface TransactionDetailSource {
  type: string
  description?: string
  metadata?: Record<string, string>
  notes?: string
  createdBy?: string
  createdAt?: string
}

type Field = TransactionDetailField

const field = (
  label: string,
  value: string | undefined,
  variant: TransactionDetailVariant = 'text',
): Field | null => {
  const trimmed = value?.trim()
  return trimmed ? { label, value: trimmed, variant } : null
}

/** `bank_transfer` -> `Bank transfer`. */
function humanise(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  const spaced = value.trim().replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Strips the generated prefix the ledger puts in front of an operator reason. */
function reasonFromDescription(
  description: string | undefined,
  prefix: string,
): string | undefined {
  if (!description) return undefined
  return description.startsWith(prefix) ? description.slice(prefix.length) : description
}

/**
 * Repayment allocation is a nested dict in a `map<string, string>` field, so
 * the ledger emits it as a Python repr: `{'to_fees': '10.00', ...}`. Single
 * quotes make it invalid JSON, so swap them before parsing — and return
 * nothing if the shape is anything other than what we expect, since showing a
 * half-parsed blob to an operator is worse than showing no allocation at all.
 */
function parseAllocation(raw: string | undefined): Field | null {
  if (!raw?.trim()) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.replace(/'/g, '"'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const alloc = parsed as Record<string, unknown>
  const parts: string[] = []
  const add = (key: string, suffix: string) => {
    const amount = parseFloat(String(alloc[key] ?? ''))
    if (Number.isFinite(amount) && amount !== 0) parts.push(`${formatCurrency(amount)} ${suffix}`)
  }

  add('to_fees', 'to fees')
  add('to_principal', 'to principal')
  add('overpayment', 'overpayment')

  return parts.length > 0 ? { label: 'Allocation', value: parts.join(', '), variant: 'text' } : null
}

/** Handles both the ISO string and the raw proto `{ seconds }` timestamp. */
function formatTimestamp(value: unknown): string | undefined {
  if (!value) return undefined

  const date =
    typeof value === 'object' && 'seconds' in (value as Record<string, unknown>)
      ? new Date(Number((value as { seconds: string | number }).seconds) * 1000)
      : new Date(value as string)

  return Number.isNaN(date.getTime()) ? undefined : formatDateMedium(date)
}

/** Per-type field builders. A type absent here falls back to `description`. */
const BY_TYPE: Record<
  string,
  (tx: TransactionDetailSource, m: Record<string, string>) => (Field | null)[]
> = {
  DISBURSEMENT: (tx, m) => [
    field('Notes', m.notes, 'longform'),
    field('Bank reference', m.bank_reference, 'mono'),
    field('Payment method', humanise(m.payment_method)),
    field('Attachment', m.attachment_location, 'mono'),
  ],

  REPAYMENT: (tx, m) => [
    field('Notes', tx.notes, 'longform'),
    field('Payment method', humanise(m.payment_method)),
    field('Payment reference', m.payment_reference, 'mono'),
    parseAllocation(m.allocation),
  ],

  FEE_WAIVER: (tx, m) => [
    field('Reason', m.reason ?? reasonFromDescription(tx.description, 'Fee waiver: '), 'longform'),
    field('Notes', tx.notes, 'longform'),
    field('Approved by', m.approved_by, 'mono'),
    m.waiver_total && m.original_fee_balance
      ? field(
          'Waived',
          `${formatCurrency(m.waiver_total)} of ${formatCurrency(m.original_fee_balance)} fee balance`,
        )
      : null,
  ],

  LATE_FEE: (tx, m) => [
    field('Reason', tx.notes, 'longform'),
    field('Days past due', m.days_past_due),
  ],

  DISHONOUR_FEE: (tx, m) => [
    field('Reason', tx.description, 'longform'),
    field('Dishonoured reference', m.dishonoured_reference, 'mono'),
  ],

  ADJUSTMENT: (tx, m) => [
    field(
      'Reason',
      m.reason ?? reasonFromDescription(tx.description, 'Manual adjustment: '),
      'longform',
    ),
    field('Approved by', m.approved_by, 'mono'),
  ],

  WRITE_OFF: (tx, m) => [
    field('Reason', m.reason ?? reasonFromDescription(tx.description, 'Write-off: '), 'longform'),
    field('Approved by', m.approved_by, 'mono'),
  ],
}

/**
 * Build the detail fields for one transaction. Returns an empty array when
 * there is nothing to show — callers use that to decide whether the row gets
 * an expand control at all.
 */
export function getTransactionDetails(tx: TransactionDetailSource): TransactionDetailField[] {
  const metadata = tx.metadata ?? {}
  const build = BY_TYPE[tx.type]

  const specific = build
    ? build(tx, metadata)
    : [field('Description', tx.description, 'longform'), field('Notes', tx.notes, 'longform')]

  return [
    ...specific,
    field('Recorded by', tx.createdBy, 'mono'),
    field('Recorded', formatTimestamp(tx.createdAt)),
  ].filter((f): f is Field => f !== null)
}
