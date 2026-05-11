/**
 * Event Sourcing Zod Schemas
 *
 * Validation schemas for event payloads.
 * Used to validate incoming command requests before publishing events.
 */

import { z } from 'zod'

// =============================================================================
// Write-Off Request Schema
// =============================================================================

/**
 * Valid reasons for a write-off request.
 */
export const WriteOffReasonSchema = z.enum([
  'hardship',
  'bankruptcy',
  'deceased',
  'unable_to_locate',
  'fraud_victim',
  'disputed',
  'aged_debt',
  'other',
])

/**
 * Priority levels for write-off requests.
 */
export const WriteOffPrioritySchema = z.enum(['normal', 'high', 'urgent'])

/**
 * Schema for the write-off request command (input from client).
 * This is what the client sends to the command API.
 */
export const WriteOffRequestCommandSchema = z.object({
  loanAccountId: z.string().min(1, 'Loan account ID is required'),
  customerId: z.string().min(1, 'Customer ID is required'),
  customerName: z.string().min(1, 'Customer name is required'),
  accountNumber: z.string().min(1, 'Account number is required'),
  amount: z.number().positive('Amount must be positive'),
  originalBalance: z.number().nonnegative('Original balance cannot be negative'),
  reason: WriteOffReasonSchema,
  notes: z.string().optional(),
  priority: WriteOffPrioritySchema.default('normal'),
})

export type WriteOffRequestCommand = z.infer<typeof WriteOffRequestCommandSchema>

// =============================================================================
// Write-Off Approval Schema
// =============================================================================

/**
 * Schema for the write-off approval command (input from client).
 */
export const WriteOffApproveCommandSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
  requestNumber: z.string().min(1, 'Request number is required'),
  comment: z.string().min(10, 'Approval comment must be at least 10 characters'),
})

export type WriteOffApproveCommand = z.infer<typeof WriteOffApproveCommandSchema>

// =============================================================================
// Write-Off Rejection Schema
// =============================================================================

/**
 * Schema for the write-off rejection command (input from client).
 */
export const WriteOffRejectCommandSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
  requestNumber: z.string().min(1, 'Request number is required'),
  reason: z.string().min(10, 'Rejection reason must be at least 10 characters'),
})

export type WriteOffRejectCommand = z.infer<typeof WriteOffRejectCommandSchema>

// =============================================================================
// Write-Off Cancellation Schema
// =============================================================================

/**
 * Schema for the write-off cancellation command (input from client).
 */
export const WriteOffCancelCommandSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
  requestNumber: z.string().min(1, 'Request number is required'),
})

export type WriteOffCancelCommand = z.infer<typeof WriteOffCancelCommandSchema>

// =============================================================================
// Notification Suppression Schema
// =============================================================================

/**
 * Suppression mode the CRM is allowed to set.
 * (No `off` — clearing is a separate DELETE / clearSuppression call.)
 */
export const NotificationSuppressionModeSchema = z.enum([
  'all',
  'non_essential',
  'marketing_only',
])

/**
 * Schema for setting a per-customer notification kill switch.
 * `setBy` and `setAt` are stamped server-side from the authenticated user.
 */
export const NotificationSuppressionCommandSchema = z.object({
  customerId: z.string().min(1, 'Customer ID is required'),
  mode: NotificationSuppressionModeSchema,
  reason: z.string().min(1, 'Reason is required').max(500),
  expiresAt: z
    .string()
    .datetime({ message: 'expiresAt must be an ISO 8601 timestamp' })
    .nullish(),
  correlationId: z.string().optional(),
})

export type NotificationSuppressionCommand = z.infer<typeof NotificationSuppressionCommandSchema>

// =============================================================================
// Response Schemas
// =============================================================================

/**
 * Schema for successful publish response.
 */
export const PublishSuccessResponseSchema = z.object({
  eventId: z.string(),
  requestId: z.string(),
  status: z.literal('accepted'),
  message: z.string(),
})

/**
 * Schema for error response.
 */
export const PublishErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
})
