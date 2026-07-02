/**
 * Event Sourcing Types
 *
 * TypeScript interfaces for CRM-originated events.
 * These follow the LedgerMessage format for consistency with the event ecosystem.
 */

import type { ClearableReason } from './config'

// =============================================================================
// CRM Event Envelope
// =============================================================================

/**
 * The base event envelope for all CRM-originated events.
 * Follows the LedgerMessage format.
 *
 * @template T - The payload type for the specific event
 */
export interface CRMEvent<T = unknown> {
  /**
   * Request ID - groups related events in a workflow.
   * Generated on initial request, reused for subsequent events (approve/reject/cancel).
   */
  conv: string

  /**
   * Agent identifier - always "billie-crm" for CRM-originated events.
   */
  agt: string

  /**
   * User ID who triggered the action.
   */
  usr: string

  /**
   * Sequence number - always 1 for CRM events.
   */
  seq: 1

  /**
   * Message class - always "msg".
   */
  cls: 'msg'

  /**
   * Event type with version (e.g., "writeoff.requested.v1").
   */
  typ: string

  /**
   * Unique event ID for idempotency/deduplication.
   */
  cause: string

  /**
   * Event-specific payload.
   * Serialized as JSON string when published to Redis.
   */
  payload: T
}

// =============================================================================
// Write-Off Request Payloads
// =============================================================================

/**
 * Valid reasons for a write-off request.
 */
export type WriteOffReason =
  | 'hardship'
  | 'bankruptcy'
  | 'deceased'
  | 'unable_to_locate'
  | 'fraud_victim'
  | 'disputed'
  | 'aged_debt'
  | 'other'

/**
 * Priority levels for write-off requests.
 */
export type WriteOffPriority = 'normal' | 'high' | 'urgent'

/**
 * Payload for writeoff.requested.v1 event.
 */
export interface WriteOffRequestedPayload {
  /** Loan account ID being written off */
  loanAccountId: string
  /** Customer ID associated with the account */
  customerId: string
  /** Customer name for display/audit */
  customerName: string
  /** Account number for display */
  accountNumber: string
  /** Amount to write off */
  amount: number
  /** Original balance before write-off */
  originalBalance: number
  /** Reason for the write-off */
  reason: WriteOffReason
  /** Additional notes from the requester */
  notes?: string
  /** Priority level */
  priority: WriteOffPriority
  /** User ID who submitted the request */
  requestedBy: string
  /** User name for audit trail */
  requestedByName: string
}

/**
 * Payload for writeoff.approved.v1 event.
 */
export interface WriteOffApprovedPayload {
  /** Write-off request ID (matches conv of the original request) */
  requestId: string
  /** Human-readable request number (WO-XXXXX) */
  requestNumber: string
  /** Approval comment (min 10 chars) */
  comment: string
  /** User ID who approved */
  approvedBy: string
  /** User name for audit trail */
  approvedByName: string
  /** Event ID from the ledger service (when write-off is posted) */
  ledgerEventId?: string
  /** Transaction ID from the ledger (for audit trail) */
  transactionId?: string
}

/**
 * Payload for writeoff.rejected.v1 event.
 */
export interface WriteOffRejectedPayload {
  /** Write-off request ID (matches conv of the original request) */
  requestId: string
  /** Human-readable request number (WO-XXXXX) */
  requestNumber: string
  /** Rejection reason (min 10 chars) */
  reason: string
  /** User ID who rejected */
  rejectedBy: string
  /** User name for audit trail */
  rejectedByName: string
}

/**
 * Payload for writeoff.cancelled.v1 event.
 */
export interface WriteOffCancelledPayload {
  /** Write-off request ID (matches conv of the original request) */
  requestId: string
  /** Human-readable request number (WO-XXXXX) */
  requestNumber: string
  /** User ID who cancelled */
  cancelledBy: string
  /** User name for audit trail */
  cancelledByName: string
}

// =============================================================================
// Event Type Aliases
// =============================================================================

export type WriteOffRequestedEvent = CRMEvent<WriteOffRequestedPayload>
export type WriteOffApprovedEvent = CRMEvent<WriteOffApprovedPayload>
export type WriteOffRejectedEvent = CRMEvent<WriteOffRejectedPayload>
export type WriteOffCancelledEvent = CRMEvent<WriteOffCancelledPayload>

// =============================================================================
// Publisher Response Types
// =============================================================================

/**
 * Response from publishing an event.
 */
export interface PublishEventResponse {
  /** The event ID (cause field) for tracking */
  eventId: string
  /** The request ID (conv field) for workflow correlation */
  requestId: string
  /** Status of the publish operation */
  status: 'accepted'
  /** Human-readable message */
  message: string
}

/**
 * Error response from publishing.
 */
export interface PublishEventError {
  error: {
    code: string
    message: string
  }
}

// =============================================================================
// Block Clear Payloads
// =============================================================================

/**
 * Payload for block_clear_approval.requested.v1 event.
 */
export interface BlockClearApprovalRequestedPayload {
  canonicalCustomerId: string
  customerName: string
  conversationId?: string
  reasons: ClearableReason[]
  justification: string
  requestedBy: string
  requestedByName: string
}

/**
 * Payload for block_clear_approval.approved.v1 event.
 */
export interface BlockClearApprovalApprovedPayload {
  requestId: string
  requestNumber: string
  comment: string
  approvedBy: string
  approvedByName: string
}

/**
 * Payload for block_clear_approval.rejected.v1 event.
 */
export interface BlockClearApprovalRejectedPayload {
  requestId: string
  requestNumber: string
  reason: string
  rejectedBy: string
  rejectedByName: string
}

/**
 * Payload for block_clear_approval.cancelled.v1 event.
 */
export interface BlockClearApprovalCancelledPayload {
  requestId: string
  requestNumber: string
  cancelledBy: string
  cancelledByName: string
}

/**
 * The authoritative command billieChat consumes off chatLedger (spec §7.1).
 */
export interface ReapplicationBlockClearAuthorizedPayload {
  canonical_customer_id: string
  reasons: ClearableReason[] | 'ALL_CLEARABLE'
  operator_id: string
  justification: string
  request_id: string
  requested_at: string
  approval?: {
    approval_request_id: string
    approved_by: string
    approved_by_name: string
    approved_at: string
    comment: string
  }
}
