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
  EVENT_TYPE_APPLICANT_RELEASE_GATE_MODE_SET,
  PUBLISH_BACKOFF_MS,
  PUBLISH_MAX_RETRIES,
} from '@/lib/events/config'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'
import { getChatLedgerRedisClient } from '@/server/chatledger-publisher'
import type { ApplicantReleaseGateModeSetPayload } from '@/lib/events/types'

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
      console.warn(
        `[ReleasePublisher] Attempt ${attempt + 1}/${PUBLISH_MAX_RETRIES} failed:`,
        lastError.message,
      )
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
  // chatLedger is published first because it's the system of record billieChat
  // enforces against (the applicantReleaseService reads it to build the
  // attempt-1 grant set). The internal write below is the CRM's own
  // projection (release_batches / release_grants) and is best-effort by
  // comparison: once chatLedger has committed, the release is "live" from
  // billieChat's perspective even if this second write fails. A failure here
  // opens a divergence window — the release is enforced upstream but the CRM
  // grid/detail views lag until the failed-actions queue replays it. We
  // don't roll back the chatLedger write (there's no compensating command),
  // so we log loudly and rethrow so the caller's failed-actions queue can retry.
  try {
    await createAndPublishEvent({
      typ: options.typ,
      userId: options.usr,
      payload: options.payload,
      requestId: options.conv,
    })
  } catch (error) {
    console.error(
      '[ReleasePublisher] chatLedger committed but internal publish failed — CRM projection lags billieChat',
      { releaseTyp: options.typ, conv: options.conv },
    )
    throw error
  }
  return { eventId }
}

export interface GateModeCommandOptions {
  mode: ApplicantReleaseGateModeSetPayload['mode']
  usr: string
  reason?: string
}

/**
 * chatLedger-ONLY publish for applicant_release.gate_mode.set.v1 (spec §6
 * "Gate control") — the admin-only CRM buttons, a second command surface
 * alongside the ops CLI break-glass path. Unlike publishReleaseCommand this
 * does NOT also write the internal stream: the CRM's release-gate-status
 * projection updates from billieChat's `.changed` fact once
 * applicantReleaseService applies the mode, and the CRM's own event-processor
 * deliberately has no handler registered for `.set` (that's the command, not
 * the fact — see event-processor/src/billie_servicing/handlers/applicant_release.py).
 */
export async function publishGateModeCommand(
  options: GateModeCommandOptions,
): Promise<{ eventId: string }> {
  const eventId = nanoid()
  const payload: ApplicantReleaseGateModeSetPayload = {
    mode: options.mode,
    set_by: options.usr,
    reason: options.reason,
  }
  const fields: Record<string, string> = {
    conv: 'applicant-release:gate',
    agt: CRM_AGENT_ID,
    usr: options.usr,
    seq: '1',
    cls: 'cmd',
    typ: EVENT_TYPE_APPLICANT_RELEASE_GATE_MODE_SET,
    cause: eventId,
    payload: JSON.stringify(payload),
  }
  const redis = getChatLedgerRedisClient()
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
        `[ReleasePublisher] gate_mode.set attempt ${attempt + 1}/${PUBLISH_MAX_RETRIES} failed:`,
        lastError.message,
      )
      if (attempt < PUBLISH_MAX_RETRIES - 1) {
        await sleep(PUBLISH_BACKOFF_MS[attempt] ?? 400)
      }
    }
  }
  throw new EventPublishError('Failed to publish gate mode command to chatLedger after retries', {
    attempts: PUBLISH_MAX_RETRIES,
    cause: lastError,
  })
}
