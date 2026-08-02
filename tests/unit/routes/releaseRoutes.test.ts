/**
 * Release command routes. next/server, @/lib/auth, @/server/release-publisher,
 * @/server/marketing-grpc-client and @/lib/releases are mocked; zod schemas real.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { EventPublishError } from '@/server/event-publisher'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

const authHolder = vi.hoisted(() => ({
  current: {
    user: { id: 'staff-1' },
    payload: { find: vi.fn(async () => ({ docs: [], totalDocs: 0 })) },
  } as Record<string, unknown>,
}))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => authHolder.current) }))

const publisher = vi.hoisted(() => ({ publishReleaseCommand: vi.fn() }))
vi.mock('@/server/release-publisher', () => publisher)

const partition = vi.hoisted(() => ({ computeReleasePartition: vi.fn() }))
vi.mock('@/lib/releases', () => partition)

const grpc = vi.hoisted(() => ({ logInteraction: vi.fn().mockResolvedValue({}) }))
vi.mock('@/server/marketing-grpc-client', () => grpc)

import { POST as releasePost } from '@/app/api/marketing/releases/route'
import { POST as preflightPost } from '@/app/api/marketing/releases/preflight/route'
import { POST as revokePost } from '@/app/api/marketing/releases/[releaseId]/revoke/route'

function req(body?: unknown): NextRequest {
  return new Request('http://x/api/marketing/releases', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}
const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) })

const command = {
  releaseId: 'rel_12345678',
  name: 'Wave',
  type: 'waitlist',
  count: 2,
  expiryDays: 14,
  sendInviteSms: true,
}

const basePartition = {
  candidates: [
    { mobileE164: '+61400000001', contactId: 'c-1', sendSms: true, bucket: 'granted_sms' },
    { mobileE164: '+61400000002', contactId: null, sendSms: false, bucket: 'granted_no_sms' },
    {
      mobileE164: '+61400000003',
      contactId: 'c-3',
      sendSms: false,
      bucket: 'skipped_already_customer',
    },
  ],
  counts: {
    granted_sms: 1,
    granted_no_sms: 1,
    skipped_already_customer: 1,
    skipped_already_released: 0,
    skipped_needs_review: 0,
    skipped_invalid_number: 0,
  },
}

beforeEach(() => {
  authHolder.current = {
    user: { id: 'staff-1' },
    payload: { find: vi.fn(async () => ({ docs: [], totalDocs: 0 })) },
  }
  publisher.publishReleaseCommand.mockReset().mockResolvedValue({ eventId: 'e-1' })
  partition.computeReleasePartition.mockReset().mockResolvedValue({ ...basePartition })
  grpc.logInteraction.mockClear()
})

describe('POST /api/marketing/releases', () => {
  test('202: publishes released.v1 with granted candidates only', async () => {
    const res = (await releasePost(req(command))) as { body: { releaseId: string }; status: number }
    expect(res.status).toBe(202)
    expect(res.body.releaseId).toBe('rel_12345678')
    const call = publisher.publishReleaseCommand.mock.calls[0][0]
    expect(call.typ).toBe('applicant_release.released.v1')
    expect(call.conv).toBe('applicant-release:rel_12345678')
    expect(call.payload.grants).toHaveLength(2) // skipped_already_customer excluded
    expect(call.payload.grants[0]).toEqual({
      mobile_e164: '+61400000001',
      contact_id: 'c-1',
      send_sms: true,
    })
    expect(call.payload.skipped.already_customer).toBe(1)
  })

  test('logs a released_to_apply interaction for matched contacts', async () => {
    await releasePost(req(command))
    expect(grpc.logInteraction).toHaveBeenCalledTimes(1) // only c-1 (granted + matched)
    expect(grpc.logInteraction.mock.calls[0][0]).toMatchObject({
      contactId: 'c-1',
      kind: 'released_to_apply',
    })
  })

  test('400 on schema violation', async () => {
    const res = (await releasePost(req({ ...command, type: 'phone_list' }))) as { status: number }
    expect(res.status).toBe(400)
    expect(publisher.publishReleaseCommand).not.toHaveBeenCalled()
  })

  test('503 when publish fails', async () => {
    publisher.publishReleaseCommand.mockRejectedValue(
      new EventPublishError('down', { attempts: 3 }),
    )
    const res = (await releasePost(req(command))) as {
      body: { error: { code: string } }
      status: number
    }
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('EVENT_PUBLISH_FAILED')
  })

  test('422 PARTITION_TRUNCATED when the partition was truncated — does not publish', async () => {
    partition.computeReleasePartition.mockResolvedValue({ ...basePartition, truncated: true })
    const res = (await releasePost(req(command))) as {
      body: { error: { code: string; message: string } }
      status: number
    }
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('PARTITION_TRUNCATED')
    expect(publisher.publishReleaseCommand).not.toHaveBeenCalled()
    expect(grpc.logInteraction).not.toHaveBeenCalled()
  })

  test('expires_at is approximately expiryDays in the future', async () => {
    const before = Date.now()
    await releasePost(req(command))
    const after = Date.now()
    const call = publisher.publishReleaseCommand.mock.calls[0][0]
    const expiresAtMs = Date.parse(call.payload.expires_at)
    const expectedMinMs = before + command.expiryDays * 86_400_000
    const expectedMaxMs = after + command.expiryDays * 86_400_000
    expect(expiresAtMs).toBeGreaterThanOrEqual(expectedMinMs)
    expect(expiresAtMs).toBeLessThanOrEqual(expectedMaxMs)
  })
})

describe('POST /api/marketing/releases/preflight', () => {
  test('returns counts without publishing', async () => {
    const res = (await preflightPost(req(command))) as {
      body: { counts: Record<string, number>; total: number }
      status: number
    }
    expect(res.status).toBe(200)
    expect(res.body.counts.granted_sms).toBe(1)
    expect(publisher.publishReleaseCommand).not.toHaveBeenCalled()
  })

  test('passes through truncated when the partition sets it', async () => {
    partition.computeReleasePartition.mockResolvedValue({ ...basePartition, truncated: true })
    const res = (await preflightPost(req(command))) as {
      body: { truncated?: boolean }
      status: number
    }
    expect(res.status).toBe(200)
    expect(res.body.truncated).toBe(true)
  })

  test('omits truncated when the partition does not set it', async () => {
    const res = (await preflightPost(req(command))) as {
      body: { truncated?: boolean }
      status: number
    }
    expect(res.status).toBe(200)
    expect(res.body.truncated).toBeUndefined()
  })
})

describe('POST /api/marketing/releases/[releaseId]/revoke', () => {
  test('202: publishes revoked.v1', async () => {
    const res = (await revokePost(req({ reason: 'mistake' }), p({ releaseId: 'rel-1' }))) as {
      status: number
    }
    expect(res.status).toBe(202)
    const call = publisher.publishReleaseCommand.mock.calls[0][0]
    expect(call.typ).toBe('applicant_release.revoked.v1')
    expect(call.payload).toMatchObject({
      release_id: 'rel-1',
      revoked_by: 'staff-1',
      reason: 'mistake',
    })
  })

  test('202 without a reason: passes reason through as undefined', async () => {
    const res = (await revokePost(req({}), p({ releaseId: 'rel-1' }))) as { status: number }
    expect(res.status).toBe(202)
    const call = publisher.publishReleaseCommand.mock.calls[0][0]
    expect(call.payload.release_id).toBe('rel-1')
    expect(call.payload.reason).toBeUndefined()
  })
})
