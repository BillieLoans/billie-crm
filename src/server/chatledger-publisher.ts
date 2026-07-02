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
import {
  CHATLEDGER_STREAM,
  CRM_AGENT_ID,
  EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED,
  PUBLISH_MAX_RETRIES,
  PUBLISH_BACKOFF_MS,
} from '@/lib/events/config'
import type { ReapplicationBlockClearAuthorizedPayload } from '@/lib/events/types'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  const redis = getChatLedgerRedisClient()

  // The client is lazyConnect + enableOfflineQueue:false, so a command issued
  // before the connection is up is rejected immediately ("Stream isn't
  // writeable..."). Connect explicitly on first use, then retry transient
  // failures with the same backoff the internal event publisher uses.
  let lastError: Error | undefined
  for (let attempt = 0; attempt < PUBLISH_MAX_RETRIES; attempt++) {
    try {
      if (redis.status === 'wait') {
        await redis.connect()
      }
      await redis.xadd(CHATLEDGER_STREAM, '*', ...Object.entries(fields).flat())
      return { eventId }
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
  throw new EventPublishError('Failed to publish clear_authorized to chatLedger after retries', {
    attempts: PUBLISH_MAX_RETRIES,
    cause: lastError,
  })
}
