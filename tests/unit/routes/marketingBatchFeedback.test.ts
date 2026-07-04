/**
 * Unit tests for B3 marketing staff command routes:
 *   POST /api/marketing/batches                       (CreateBatch)
 *   POST /api/marketing/batches/[batchId]/assign      (AssignBatch)
 *   POST /api/marketing/batches/[batchId]/invite      (TriggerBatchInvitations)
 *   POST /api/marketing/feedback/[feedbackId]/status  (SetFeedbackStatus)
 *
 * next/server, @/lib/auth (requireAuth) and @/server/marketing-grpc-client are
 * mocked; the zod schemas are the REAL implementations.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

const authHolder = vi.hoisted(() => ({
  current: { user: { id: 'staff-1' } } as Record<string, unknown>,
}))
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => authHolder.current),
}))

const grpc = vi.hoisted(() => ({
  createBatch: vi.fn(),
  assignBatch: vi.fn(),
  triggerBatchInvitations: vi.fn(),
  setFeedbackStatus: vi.fn(),
}))
vi.mock('@/server/marketing-grpc-client', () => grpc)

import { POST as createBatchPost } from '@/app/api/marketing/batches/route'
import { POST as assignPost } from '@/app/api/marketing/batches/[batchId]/assign/route'
import { POST as invitePost } from '@/app/api/marketing/batches/[batchId]/invite/route'
import { POST as feedbackStatusPost } from '@/app/api/marketing/feedback/[feedbackId]/status/route'

function req(body?: unknown): NextRequest {
  return new Request('http://x/api/marketing', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}
const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) })

beforeEach(() => {
  authHolder.current = { user: { id: 'staff-1' } }
  grpc.createBatch.mockReset().mockResolvedValue({ batchId: 'b-1', eventId: 'e-1' })
  grpc.assignBatch
    .mockReset()
    .mockResolvedValue({ batchId: 'b-1', assignedCount: 3, eventId: 'e-2' })
  grpc.triggerBatchInvitations
    .mockReset()
    .mockResolvedValue({ batchId: 'b-1', invitedCount: 5, skippedUnconsented: 2 })
  grpc.setFeedbackStatus
    .mockReset()
    .mockResolvedValue({ feedbackId: 'f-1', status: 'acknowledged', eventId: 'e-3' })
})

describe('POST /api/marketing/batches (CreateBatch)', () => {
  test('202 + serialises criteria to criteria_json, actor = staff id', async () => {
    const res = (await createBatchPost(
      req({ name: 'Campus 1', criteria: { source: 'campus' } }),
    )) as {
      body: { batchId: string }
      status: number
    }
    expect(res.status).toBe(202)
    expect(res.body.batchId).toBe('b-1')
    const arg = grpc.createBatch.mock.calls[0][0]
    expect(arg.name).toBe('Campus 1')
    expect(JSON.parse(arg.criteriaJson)).toEqual({ source: 'campus' })
    expect(arg.actor).toBe('staff-1')
  })

  test('400 on empty name', async () => {
    const res = (await createBatchPost(req({ name: '' }))) as { status: number }
    expect(res.status).toBe(400)
    expect(grpc.createBatch).not.toHaveBeenCalled()
  })

  test('503 when the gRPC command fails', async () => {
    grpc.createBatch.mockRejectedValue(new Error('down'))
    const res = (await createBatchPost(req({ name: 'X' }))) as {
      body: { error: { code: string } }
      status: number
    }
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('COMMAND_FAILED')
  })

  test('returns the auth error when requireAuth denies', async () => {
    authHolder.current = { error: { body: { error: { code: 'FORBIDDEN' } }, status: 403 } }
    const res = (await createBatchPost(req({ name: 'X' }))) as { status: number }
    expect(res.status).toBe(403)
    expect(grpc.createBatch).not.toHaveBeenCalled()
  })
})

describe('POST /api/marketing/batches/[batchId]/assign (AssignBatch)', () => {
  test('202 + passes contactIds + batchId from the path', async () => {
    const res = (await assignPost(
      req({ contact_ids: ['c-1', 'c-2', 'c-3'] }),
      p({ batchId: 'b-1' }),
    )) as {
      body: { assignedCount: number }
      status: number
    }
    expect(res.status).toBe(202)
    expect(res.body.assignedCount).toBe(3)
    const arg = grpc.assignBatch.mock.calls[0][0]
    expect(arg.batchId).toBe('b-1')
    expect(arg.contactIds).toEqual(['c-1', 'c-2', 'c-3'])
  })

  test('400 on an empty contact_ids list', async () => {
    const res = (await assignPost(req({ contact_ids: [] }), p({ batchId: 'b-1' }))) as {
      status: number
    }
    expect(res.status).toBe(400)
    expect(grpc.assignBatch).not.toHaveBeenCalled()
  })
})

describe('POST /api/marketing/batches/[batchId]/invite (TriggerBatchInvitations)', () => {
  test('202 + stable idempotency key invite:{batchId}, surfaces counts', async () => {
    const res = (await invitePost(req(), p({ batchId: 'b-1' }))) as {
      body: { invitedCount: number; skippedUnconsented: number }
      status: number
    }
    expect(res.status).toBe(202)
    expect(res.body.invitedCount).toBe(5)
    expect(res.body.skippedUnconsented).toBe(2)
    expect(grpc.triggerBatchInvitations.mock.calls[0][0].idempotencyKey).toBe('invite:b-1')
  })
})

describe('POST /api/marketing/feedback/[feedbackId]/status (SetFeedbackStatus)', () => {
  test('202 + stable key feedback-status:{id}:{status}', async () => {
    const res = (await feedbackStatusPost(
      req({ status: 'acknowledged' }),
      p({ feedbackId: 'f-1' }),
    )) as { body: { status: string }; status: number }
    expect(res.status).toBe(202)
    expect(res.body.status).toBe('acknowledged')
    const arg = grpc.setFeedbackStatus.mock.calls[0][0]
    expect(arg.idempotencyKey).toBe('feedback-status:f-1:acknowledged')
    expect(arg.status).toBe('acknowledged')
  })

  test('400 on an invalid status', async () => {
    const res = (await feedbackStatusPost(req({ status: 'bogus' }), p({ feedbackId: 'f-1' }))) as {
      status: number
    }
    expect(res.status).toBe(400)
    expect(grpc.setFeedbackStatus).not.toHaveBeenCalled()
  })
})
