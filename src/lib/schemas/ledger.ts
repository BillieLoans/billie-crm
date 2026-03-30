/**
 * Ledger Mutation Zod Schemas
 *
 * Validation schemas for ledger API route request bodies.
 * Used to validate incoming requests before calling the gRPC ledger service.
 */

import { z } from 'zod'

// =============================================================================
// Shared Helpers
// =============================================================================

/** Validates a string is a valid positive decimal (e.g., "100.00", "0.50") */
const positiveDecimalString = z.string().regex(
  /^\d+(\.\d{1,2})?$/,
  'Must be a valid positive decimal amount (e.g., "100.00")',
)

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
  expectedVersion: z.string().optional(),
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
})

export type DisburseLoan = z.infer<typeof DisburseLoanSchema>
