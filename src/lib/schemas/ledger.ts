/**
 * Ledger Mutation Zod Schemas
 *
 * Validation schemas for ledger API route request bodies.
 * Used to validate incoming requests before calling the gRPC ledger service.
 */

import { z } from 'zod'
import { CANCELLATION_REASON_CODES } from '@/lib/cancellation'
import { MIN_CANCELLATION_NOTE_LENGTH, MIN_NO_BLOCK_REASON_LENGTH } from '@/lib/constants'

// =============================================================================
// Shared Helpers
// =============================================================================

/** Validates a string is a valid positive decimal (e.g., "100.00", "0.50") */
const positiveDecimalString = z.string().regex(
  /^\d+(\.\d{1,2})?$/,
  'Must be a valid positive decimal amount (e.g., "100.00")',
)

/**
 * Client-supplied idempotency key for money-moving commands.
 *
 * Optional for backwards compatibility: any caller that has not been updated
 * to mint a key still works, and the route falls back to a server-side
 * generated key (see `generateIdempotencyKey` in `@/server/grpc-client`).
 * When present it is forwarded verbatim to the ledger, which dedupes on it
 * for 24h and replays the original response (`idempotent_replay`).
 *
 * Contract mirrors the collections action routes
 * (`src/app/api/collections/actions/*`): `z.string().min(8)`, plus an upper
 * bound so an oversized key can't be smuggled through to the ledger.
 */
const idempotencyKeyString = z
  .string()
  .min(8, 'Idempotency key must be at least 8 characters')
  .max(128)

/** Validates a string is a valid decimal that can be negative (for adjustments) */
const decimalString = z.string().regex(
  /^-?\d+(\.\d{1,2})?$/,
  'Must be a valid decimal amount (e.g., "100.00" or "-50.00")',
)

// =============================================================================
// Record Repayment
// =============================================================================

export const RecordRepaymentSchema = z.object({
  loanAccountId: z.string().min(1, 'Loan account ID is required'),
  amount: positiveDecimalString,
  paymentId: z.string().min(1, 'Payment ID is required'),
  paymentMethod: z.string().optional(),
  paymentReference: z.string().optional(),
  /** Operator notes. Capped at the 1000 chars the ledger accepts. */
  notes: z.string().max(1000).optional(),
  expectedVersion: z.string().optional(),
  idempotencyKey: idempotencyKeyString.optional(),
})

export type RecordRepayment = z.infer<typeof RecordRepaymentSchema>

// =============================================================================
// Waive Fee
// =============================================================================

export const WaiveFeeSchema = z.object({
  loanAccountId: z.string().min(1, 'Loan account ID is required'),
  waiverAmount: positiveDecimalString,
  reason: z.string().min(1, 'Reason is required').max(1000),
  approvedBy: z.string().optional(),
  expectedVersion: z.string().optional(),
  idempotencyKey: idempotencyKeyString.optional(),
})

export type WaiveFee = z.infer<typeof WaiveFeeSchema>

// =============================================================================
// Write-Off (Ledger)
// =============================================================================

export const WriteOffLedgerSchema = z.object({
  loanAccountId: z.string().min(1, 'Loan account ID is required'),
  reason: z.string().min(1, 'Reason is required').max(1000),
  approvedBy: z.string().optional(),
})

export type WriteOffLedger = z.infer<typeof WriteOffLedgerSchema>

// =============================================================================
// Make Adjustment
// =============================================================================

export const MakeAdjustmentSchema = z.object({
  loanAccountId: z.string().min(1, 'Loan account ID is required'),
  principalDelta: decimalString,
  feeDelta: decimalString,
  reason: z.string().min(1, 'Reason is required').max(1000),
  approvedBy: z.string().optional(),
  idempotencyKey: idempotencyKeyString.optional(),
})

export type MakeAdjustment = z.infer<typeof MakeAdjustmentSchema>

// =============================================================================
// Apply Late Fee
// =============================================================================

export const ApplyLateFeeSchema = z.object({
  loanAccountId: z.string().min(1, 'Loan account ID is required'),
  feeAmount: positiveDecimalString,
  daysPastDue: z.number().int().min(0, 'Days past due must be >= 0'),
  reason: z.string().max(1000).optional(),
  idempotencyKey: idempotencyKeyString.optional(),
})

export type ApplyLateFee = z.infer<typeof ApplyLateFeeSchema>

// =============================================================================
// Apply Dishonour Fee
// =============================================================================

export const ApplyDishonourFeeSchema = z.object({
  loanAccountId: z.string().min(1, 'Loan account ID is required'),
  feeAmount: positiveDecimalString,
  reason: z.string().max(1000).optional(),
  referenceId: z.string().optional(),
  idempotencyKey: idempotencyKeyString.optional(),
})

export type ApplyDishonourFee = z.infer<typeof ApplyDishonourFeeSchema>

// =============================================================================
// Disburse Loan
// =============================================================================

export const DisburseLoanSchema = z.object({
  loanAccountId: z.string().min(1, 'Loan account ID is required'),
  disbursementAmount: positiveDecimalString.optional(),
  bankReference: z.string().min(1, 'Bank reference is required'),
  paymentMethod: z.string().optional(),
  attachmentLocation: z.string().optional(),
  notes: z.string().max(2000).optional(),
  idempotencyKey: idempotencyKeyString.optional(),
})

export type DisburseLoan = z.infer<typeof DisburseLoanSchema>

// =============================================================================
// Cancel Loan (before disbursement)
// =============================================================================

/**
 * What the supervisor confirmed about the customer's re-application block
 * before cancelling: either a manual block is in place (the server re-checks
 * it, AC16), or none is needed and they say why.
 */
export const BlockConfirmationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual_block_active') }),
  z.object({
    kind: z.literal('no_block_needed'),
    reason: z
      .string()
      .trim()
      .min(
        MIN_NO_BLOCK_REASON_LENGTH,
        `Give a reason of at least ${MIN_NO_BLOCK_REASON_LENGTH} characters`,
      ),
  }),
])

export type BlockConfirmation = z.infer<typeof BlockConfirmationSchema>

/**
 * `reason` is one of the five codes the platform accepts, never the reserved
 * `lender_declined_pre_disbursement`. `idempotencyKey` is minted once per form
 * and reused on every retry, so a retry after a publish failure completes the
 * same cancel instead of starting another.
 */
export const CancelAccountSchema = z
  .object({
    loanAccountId: z.string().min(1, 'Loan account ID is required'),
    reason: z.enum(CANCELLATION_REASON_CODES, { error: 'Choose a cancellation reason' }),
    note: z
      .string()
      .trim()
      .min(
        MIN_CANCELLATION_NOTE_LENGTH,
        `Note must be at least ${MIN_CANCELLATION_NOTE_LENGTH} characters`,
      )
      .max(2000),
    evidenceRef: z.string().trim().max(500).optional(),
    blockConfirmation: BlockConfirmationSchema,
    idempotencyKey: z.uuid('Idempotency key must be a UUID'),
  })
  .superRefine((value, ctx) => {
    if (value.reason === 'mutual_cancellation' && !value.evidenceRef) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceRef'],
        message: 'Evidence reference is required for a mutual cancellation',
      })
    }
  })

export type CancelAccount = z.infer<typeof CancelAccountSchema>
