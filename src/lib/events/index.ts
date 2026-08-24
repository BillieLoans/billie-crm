/**
 * Event Sourcing Module
 *
 * Exports for CRM event publishing infrastructure.
 */

// Configuration
export {
  REDIS_PUBLISH_STREAM,
  REDIS_EXTERNAL_STREAM,
  EVENT_TYPE_WRITEOFF_REQUESTED,
  EVENT_TYPE_WRITEOFF_APPROVED,
  EVENT_TYPE_WRITEOFF_REJECTED,
  EVENT_TYPE_WRITEOFF_CANCELLED,
  CRM_AGENT_ID,
  PUBLISH_MAX_RETRIES,
  PUBLISH_BACKOFF_MS,
  CRM_EVENT_TYPES,
  ALL_CRM_EVENT_TYPES,
} from './config'

// Types
export type {
  CRMEvent,
  WriteOffReason,
  WriteOffPriority,
  WriteOffRequestedPayload,
  WriteOffApprovedPayload,
  WriteOffRejectedPayload,
  WriteOffCancelledPayload,
  WriteOffRequestedEvent,
  WriteOffApprovedEvent,
  WriteOffRejectedEvent,
  WriteOffCancelledEvent,
  PublishEventResponse,
  PublishEventError,
} from './types'

// Schemas
export {
  WriteOffReasonSchema,
  WriteOffPrioritySchema,
  WriteOffRequestCommandSchema,
  WriteOffApproveCommandSchema,
  WriteOffRejectCommandSchema,
  WriteOffCancelCommandSchema,
  PublishSuccessResponseSchema,
  PublishErrorResponseSchema,
} from './schemas'

export type {
  WriteOffRequestCommand,
  WriteOffApproveCommand,
  WriteOffRejectCommand,
  WriteOffCancelCommand,
} from './schemas'

// Polling
export { pollForWriteOffRequest, pollForWriteOffUpdate, pollUntil, PollTimeoutError } from './poll'

export type { PollOptions, PollResult } from './poll'
