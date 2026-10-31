/**
 * ChatLedger Producer
 *
 * Publishes CRM-originated commands onto the shared chatLedger Redis stream.
 * billieChat's Broker consumes chatLedger and routes messages by (agt, typ) to
 * the appropriate agent inbox — in this case, the reapplicationBlock service.
 *
 * Envelope mirrors billieChat's LedgerMessage schema so the Broker can route
 * without any billieChat changes:
 *   conv / agt / usr / seq / cls / typ / cause / payload
 */

import { nanoid } from 'nanoid'
import { getChatLedgerRedisClient } from './redis-client'
import { EventPublishError } from './event-publisher'

export { getChatLedgerRedisClient }
import {
  CHATLEDGER_STREAM,
  CRM_AGENT_ID,
  EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED,
  EVENT_TYPE_CONTACT_INTAKE_REQUESTED,
  EVENT_TYPE_FEEDBACK_SUBMIT_REQUESTED,
  EVENT_TYPE_CONVERSATION_KILL_REQUESTED,
  EVENT_TYPE_REAPPLICATION_BLOCK_MANUAL_SET,
  PUBLISH_MAX_RETRIES,
  PUBLISH_BACKOFF_MS,
} from '@/lib/events/config'
import type {
  ReapplicationBlockClearAuthorizedPayload,
  ContactIntakeCommandPayload,
  FeedbackSubmitCommandPayload,
  ConversationKillPayload,
  ReapplicationBlockManualSetPayload,
} from '@/lib/events/types'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * XADD one LedgerMessage to chatLedger, retrying transient failures.
 *
 * The client is lazyConnect + enableOfflineQueue:false, so a command issued
 * before the connection is up is rejected immediately ("Stream isn't
 * writeable..."). Connect explicitly on first use, then retry with the same
 * backoff the internal event publisher uses. Throws EventPublishError
 * (`failureMessage`, with the attempts and the last error) once the retries
 * are spent.
 */
async function xaddWithRetry(
  fields: Record<string, string>,
  failureMessage: string,
): Promise<void> {
  const redis = getChatLedgerRedisClient()
  let lastError: Error | undefined
  for (let attempt = 0; attempt < PUBLISH_MAX_RETRIES; attempt++) {
    try {
      if (redis.status === 'wait') {
        await redis.connect()
      }
      await redis.xadd(CHATLEDGER_STREAM, '*', ...Object.entries(fields).flat())
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.warn(
        `[ChatLedgerPublisher] Attempt ${attempt + 1}/${PUBLISH_MAX_RETRIES} failed:`,
        lastError.message,
      )
      if (attempt < PUBLISH_MAX_RETRIES - 1) {
        await sleep(PUBLISH_BACKOFF_MS[attempt] ?? 400)
      }
    }
  }
  throw new EventPublishError(failureMessage, {
    attempts: PUBLISH_MAX_RETRIES,
    cause: lastError,
  })
}

/**
 * Publish a reapplication_block.clear_authorized.v1 command to chatLedger.
 *
 * The command uses a synthetic ops conversation ID (`ops:block-clear:{request_id}`)
 * so the Broker can route it without colliding with real customer conversations.
 *
 * @param payload - The clear-authorized payload (Task-1 contract).
 * @returns The nanoid that was used as both the cause field and the returned eventId.
 */
export async function publishClearAuthorized(
  payload: ReapplicationBlockClearAuthorizedPayload,
): Promise<{ eventId: string }> {
  const eventId = nanoid()
  const fields: Record<string, string> = {
    conv: `ops:block-clear:${payload.request_id}`,
    agt: CRM_AGENT_ID,
    usr: payload.canonical_customer_id,
    seq: '1',
    cls: 'cmd',
    typ: EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED,
    cause: eventId,
    payload: JSON.stringify(payload),
  }
  await xaddWithRetry(fields, 'Failed to publish clear_authorized to chatLedger after retries')
  return { eventId }
}

/**
 * Publish a reapplication_block.manual_set.v1 command to chatLedger (BTB-517).
 *
 * Asks billieChat's reapplicationBlock service to put a MANUAL_ADMIN block on
 * the canonical customer. Same envelope as {@link publishClearAuthorized}, on
 * the synthetic ops conversation `ops:block-set:{request_id}`; billieChat
 * answers on that conversation with manual_set_applied.v1 / _rejected.v1, and
 * carries it into state.changed.v1's `cause.conv`, which is how the CRM ties
 * the block on the customer row back to this request.
 *
 * @returns The nanoid used as both the cause field and the returned eventId.
 */
export async function publishManualBlockSet(
  payload: ReapplicationBlockManualSetPayload,
): Promise<{ eventId: string }> {
  const eventId = nanoid()
  const fields: Record<string, string> = {
    conv: `ops:block-set:${payload.request_id}`,
    agt: CRM_AGENT_ID,
    usr: payload.canonical_customer_id,
    seq: '1',
    cls: 'cmd',
    typ: EVENT_TYPE_REAPPLICATION_BLOCK_MANUAL_SET,
    cause: eventId,
    payload: JSON.stringify(payload),
  }
  await xaddWithRetry(fields, 'Failed to publish manual block set to chatLedger after retries')
  return { eventId }
}

/**
 * Publish a contact.intake.requested.v1 command to chatLedger.
 *
 * This is the durable fallback for the public waitlist intake route when the
 * primary gRPC UpsertContact fails. The Broker routes it to the marketingService
 * inbox (billieChat routes.json: `${agent_billie-crm}` → `contact.intake.requested.v1`),
 * so the CRM never has to name the consumer's inbox stream. Carries the same
 * idempotency_key as the gRPC path, so a later-processed command can't duplicate
 * a contact the gRPC call already created.
 *
 * @param payload - The intake command payload (mirrors the platform cmd dict).
 * @returns The nanoid used as both the cause field and the returned eventId.
 */
export async function publishContactIntakeRequested(
  payload: ContactIntakeCommandPayload,
): Promise<{ eventId: string }> {
  const eventId = nanoid()
  const fields: Record<string, string> = {
    conv: `contact-intake:${payload.idempotency_key}`,
    agt: CRM_AGENT_ID,
    usr: payload.actor,
    seq: '1',
    cls: 'cmd',
    typ: EVENT_TYPE_CONTACT_INTAKE_REQUESTED,
    cause: eventId,
    payload: JSON.stringify(payload),
  }
  await xaddWithRetry(fields, 'Failed to publish contact intake to chatLedger after retries')
  return { eventId }
}

/**
 * Publish a feedback.submit.requested.v1 command to chatLedger.
 *
 * Durable fallback for the public feedback intake route when the primary gRPC
 * SubmitFeedback fails. The Broker routes it to the marketingService inbox
 * (billieChat routes.json: `${agent_billie-crm}` → `feedback.submit.requested.v1`).
 * Carries the same idempotency_key as the gRPC path, so a later-processed
 * command can't duplicate feedback the gRPC call already recorded.
 *
 * @param payload - The feedback command payload (mirrors the SubmitFeedback request).
 * @returns The nanoid used as both the cause field and the returned eventId.
 */
export async function publishFeedbackSubmitted(
  payload: FeedbackSubmitCommandPayload,
): Promise<{ eventId: string }> {
  const eventId = nanoid()
  const fields: Record<string, string> = {
    conv: `feedback-intake:${payload.idempotency_key}`,
    agt: CRM_AGENT_ID,
    usr: payload.actor,
    seq: '1',
    cls: 'cmd',
    typ: EVENT_TYPE_FEEDBACK_SUBMIT_REQUESTED,
    cause: eventId,
    payload: JSON.stringify(payload),
  }
  await xaddWithRetry(fields, 'Failed to publish feedback intake to chatLedger after retries')
  return { eventId }
}

/**
 * Publish a conversation.kill.requested.v1 command to chatLedger.
 *
 * Routed by billieChat's Broker to applicationState (kill) and
 * reapplicationBlock (optional manual block). Uses the REAL conversation id
 * as `conv` — the kill applies to a live customer conversation.
 */
export async function publishConversationKill(
  payload: ConversationKillPayload,
): Promise<{ eventId: string }> {
  const eventId = nanoid()
  const fields: Record<string, string> = {
    conv: payload.conversation_id,
    agt: CRM_AGENT_ID,
    usr: payload.customer_id,
    seq: '1',
    cls: 'cmd',
    typ: EVENT_TYPE_CONVERSATION_KILL_REQUESTED,
    cause: eventId,
    payload: JSON.stringify(payload),
  }
  await xaddWithRetry(fields, 'Failed to publish conversation kill after retries')
  return { eventId }
}
