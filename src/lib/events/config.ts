/**
 * Event Sourcing Configuration
 *
 * Configurable via environment variables for stream names and event types.
 * This allows the infrastructure team to route events appropriately.
 */

// =============================================================================
// Redis Stream Configuration
// =============================================================================

/**
 * The Redis stream to publish CRM-originated events to.
 * This is a dedicated internal stream consumed directly by the Event Processor.
 * No external router dependency - events flow directly to the processor.
 * Default: 'inbox:billie-servicing:internal'
 */
export const REDIS_PUBLISH_STREAM =
  process.env.REDIS_PUBLISH_STREAM ?? 'inbox:billie-servicing:internal'

/**
 * The Redis stream for external events (routed from ecosystem via Event Router).
 * This is configured here for reference but consumed by the Python service.
 * Default: 'inbox:billie-servicing'
 */
export const REDIS_EXTERNAL_STREAM = process.env.REDIS_EXTERNAL_STREAM ?? 'inbox:billie-servicing'

// =============================================================================
// Event Types (Write-Off)
// =============================================================================

/**
 * Event type for write-off request submission.
 */
export const EVENT_TYPE_WRITEOFF_REQUESTED =
  process.env.EVENT_TYPE_WRITEOFF_REQUESTED ?? 'writeoff.requested.v1'

/**
 * Event type for write-off approval.
 */
export const EVENT_TYPE_WRITEOFF_APPROVED =
  process.env.EVENT_TYPE_WRITEOFF_APPROVED ?? 'writeoff.approved.v1'

/**
 * Event type for write-off rejection.
 */
export const EVENT_TYPE_WRITEOFF_REJECTED =
  process.env.EVENT_TYPE_WRITEOFF_REJECTED ?? 'writeoff.rejected.v1'

/**
 * Event type for write-off cancellation.
 */
export const EVENT_TYPE_WRITEOFF_CANCELLED =
  process.env.EVENT_TYPE_WRITEOFF_CANCELLED ?? 'writeoff.cancelled.v1'

// =============================================================================
// Publisher Configuration
// =============================================================================

/**
 * Agent identifier for CRM-originated events.
 */
export const CRM_AGENT_ID = 'billie-crm'

/**
 * Number of retry attempts for publishing events.
 */
export const PUBLISH_MAX_RETRIES = 3

/**
 * Backoff delays in milliseconds for each retry attempt.
 */
export const PUBLISH_BACKOFF_MS = [100, 200, 400] as const

// =============================================================================
// Event Registry (for external routing configuration)
// =============================================================================

/**
 * All CRM-originated event types.
 * Export this for routing configuration and documentation.
 */
export const CRM_EVENT_TYPES = {
  writeoff: {
    requested: EVENT_TYPE_WRITEOFF_REQUESTED,
    approved: EVENT_TYPE_WRITEOFF_APPROVED,
    rejected: EVENT_TYPE_WRITEOFF_REJECTED,
    cancelled: EVENT_TYPE_WRITEOFF_CANCELLED,
  },
} as const

/**
 * Flat list of all CRM event types for routing configuration.
 */
export const ALL_CRM_EVENT_TYPES = [
  EVENT_TYPE_WRITEOFF_REQUESTED,
  EVENT_TYPE_WRITEOFF_APPROVED,
  EVENT_TYPE_WRITEOFF_REJECTED,
  EVENT_TYPE_WRITEOFF_CANCELLED,
] as const

// =============================================================================
// Event Types (Block Clear)
// =============================================================================

/**
 * The chatLedger stream that billieChat consumes.
 * Default: 'chatLedger'
 */
export const CHATLEDGER_STREAM = process.env.CHATLEDGER_STREAM ?? 'chatLedger'

/**
 * Event type for block clear approval request.
 */
export const EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REQUESTED =
  process.env.EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REQUESTED ?? 'block_clear_approval.requested.v1'

/**
 * Event type for block clear approval approved.
 */
export const EVENT_TYPE_BLOCK_CLEAR_APPROVAL_APPROVED =
  process.env.EVENT_TYPE_BLOCK_CLEAR_APPROVAL_APPROVED ?? 'block_clear_approval.approved.v1'

/**
 * Event type for block clear approval rejected.
 */
export const EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REJECTED =
  process.env.EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REJECTED ?? 'block_clear_approval.rejected.v1'

/**
 * Event type for block clear approval cancelled.
 */
export const EVENT_TYPE_BLOCK_CLEAR_APPROVAL_CANCELLED =
  process.env.EVENT_TYPE_BLOCK_CLEAR_APPROVAL_CANCELLED ?? 'block_clear_approval.cancelled.v1'

/**
 * Event type for reapplication block clear authorized (posted to chatLedger).
 */
export const EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED =
  process.env.EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED ??
  'reapplication_block.clear_authorized.v1'

/**
 * Event type for the public-intake contact command, published to chatLedger
 * as the durable fallback when the primary gRPC UpsertContact fails. The
 * Broker routes it to the marketingService inbox (see billieChat routes.json,
 * `${agent_billie-crm}` → `contact.intake.requested.v1`).
 */
export const EVENT_TYPE_CONTACT_INTAKE_REQUESTED =
  process.env.EVENT_TYPE_CONTACT_INTAKE_REQUESTED ?? 'contact.intake.requested.v1'

/**
 * Single source of truth for the clear vocabulary (mirrors billieChat enums).
 */
export const CLEARABLE_REASONS = [
  'PRIOR_DEFAULT',
  'PRIOR_SERIOUS_ARREARS',
  'ID_VERIFICATION',
  'SERVICEABILITY',
  'ACCOUNT_CONDUCT',
] as const

/**
 * Reasons that require approval before clearing.
 */
export const REASONS_REQUIRING_APPROVAL = ['PRIOR_DEFAULT', 'PRIOR_SERIOUS_ARREARS'] as const

/**
 * Type alias for clearable reason.
 */
export type ClearableReason = (typeof CLEARABLE_REASONS)[number]
