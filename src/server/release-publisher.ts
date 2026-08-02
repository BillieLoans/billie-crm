/**
 * Dual publisher for applicant_release.* commands (spec §3).
 *
 * One staff action = two writes: chatLedger (cls 'cmd' — billieChat's Broker
 * routes it to applicantReleaseService) and the internal stream (cls 'msg' —
 * the CRM's own Python processor materialises release_batches). Both writes
 * are required; a failure of either surfaces as EVENT_PUBLISH_FAILED so the
 * failed-actions queue can replay the whole command.
 */
import { nanoid } from 'nanoid'
import {
  CHATLEDGER_STREAM,
  CRM_AGENT_ID,
  PUBLISH_BACKOFF_MS,
  PUBLISH_MAX_RETRIES,
} from '@/lib/events/config'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'
import { getChatLedgerRedisClient } from '@/server/chatledger-publisher'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface ReleaseCommandOptions {
  typ: string
  conv: string
  usr: string
  payload: unknown
}

export async function publishReleaseCommand(
  options: ReleaseCommandOptions,
): Promise<{ eventId: string }> {
  const eventId = nanoid()
  const fields: Record<string, string> = {
    conv: options.conv,
    agt: CRM_AGENT_ID,
    usr: options.usr,
    seq: '1',
    cls: 'cmd',
    typ: options.typ,
    cause: eventId,
    payload: JSON.stringify(options.payload),
  }
  const redis = getChatLedgerRedisClient()
  let lastError: Error | undefined
  let published = false
  for (let attempt = 0; attempt < PUBLISH_MAX_RETRIES; attempt++) {
    try {
      if (redis.status === 'wait') {
        await redis.connect()
      }
      await redis.xadd(CHATLEDGER_STREAM, '*', ...Object.entries(fields).flat())
      published = true
      break
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < PUBLISH_MAX_RETRIES - 1) {
        await sleep(PUBLISH_BACKOFF_MS[attempt] ?? 400)
      }
    }
  }
  if (!published) {
    throw new EventPublishError('Failed to publish release command to chatLedger after retries', {
      attempts: PUBLISH_MAX_RETRIES,
      cause: lastError,
    })
  }
  // Internal stream for the CRM's own projection — same payload, msg class.
  await createAndPublishEvent({ typ: options.typ, userId: options.usr, payload: options.payload })
  return { eventId }
}
