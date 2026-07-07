/**
 * Manual contact<->customer linking routes:
 *   POST /api/marketing/contacts/[contactId]/link    (LinkContact)
 *   POST /api/marketing/contacts/[contactId]/unlink  (UnlinkContact)
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
  linkContact: vi.fn(),
  unlinkContact: vi.fn(),
}))
vi.mock('@/server/marketing-grpc-client', () => grpc)

import { POST as linkPost } from '@/app/api/marketing/contacts/[contactId]/link/route'
import { POST as unlinkPost } from '@/app/api/marketing/contacts/[contactId]/unlink/route'

function req(body?: unknown): NextRequest {
  return new Request('http://x/api/marketing', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}
const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) })

beforeEach(() => {
  authHolder.current = { user: { id: 'staff-1' } }
  grpc.linkContact.mockReset().mockResolvedValue({ contactId: 'c-1', eventId: 'e-1' })
  grpc.unlinkContact.mockReset().mockResolvedValue({ contactId: 'c-1', eventId: 'e-2' })
})

describe('POST /api/marketing/contacts/[contactId]/link (LinkContact)', () => {
  test('202 + stable idempotency key link:{contact}:{customer}, actor = staff id', async () => {
    const res = (await linkPost(
      req({ customer_id: 'CUST-1' }),
      p({ contactId: 'c-1' }),
    )) as unknown as {
      body: { contactId: string }
      status: number
    }
    expect(res.status).toBe(202)
    expect(res.body.contactId).toBe('c-1')
    const arg = grpc.linkContact.mock.calls[0][0]
    expect(arg).toEqual({
      idempotencyKey: 'link:c-1:CUST-1',
      contactId: 'c-1',
      customerId: 'CUST-1',
      actor: 'staff-1',
    })
  })

  test('400 on a missing customer_id', async () => {
    const res = (await linkPost(req({}), p({ contactId: 'c-1' }))) as unknown as { status: number }
    expect(res.status).toBe(400)
    expect(grpc.linkContact).not.toHaveBeenCalled()
  })

  test('503 when the gRPC command fails', async () => {
    grpc.linkContact.mockRejectedValueOnce(new Error('boom'))
    const res = (await linkPost(
      req({ customer_id: 'CUST-1' }),
      p({ contactId: 'c-1' }),
    )) as unknown as {
      status: number
      body: { error: { code: string } }
    }
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('COMMAND_FAILED')
  })

  test('returns the auth error when requireAuth denies', async () => {
    authHolder.current = { error: { body: { error: 'nope' }, status: 403 } }
    const res = (await linkPost(
      req({ customer_id: 'CUST-1' }),
      p({ contactId: 'c-1' }),
    )) as unknown as {
      status: number
    }
    expect(res.status).toBe(403)
    expect(grpc.linkContact).not.toHaveBeenCalled()
  })
})

describe('POST /api/marketing/contacts/[contactId]/unlink (UnlinkContact)', () => {
  test('202 + stable idempotency key unlink:{contact}', async () => {
    const res = (await unlinkPost(req(), p({ contactId: 'c-1' }))) as unknown as {
      body: { contactId: string }
      status: number
    }
    expect(res.status).toBe(202)
    const arg = grpc.unlinkContact.mock.calls[0][0]
    expect(arg).toEqual({
      idempotencyKey: 'unlink:c-1',
      contactId: 'c-1',
      actor: 'staff-1',
    })
  })

  test('503 when the platform rejects (e.g. contact not linked)', async () => {
    grpc.unlinkContact.mockRejectedValueOnce(new Error('FAILED_PRECONDITION'))
    const res = (await unlinkPost(req(), p({ contactId: 'c-1' }))) as unknown as { status: number }
    expect(res.status).toBe(503)
  })
})
