import { describe, test, expect, vi, beforeEach } from 'vitest'

const redisMock = vi.hoisted(() => ({
  status: 'ready',
  connect: vi.fn(),
  xadd: vi.fn().mockResolvedValue('1-1'),
}))
vi.mock('@/server/chatledger-publisher', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return { ...original, getChatLedgerRedisClient: () => redisMock }
})
const internal = vi.hoisted(() => ({
  createAndPublishEvent: vi
    .fn()
    .mockResolvedValue({ eventId: 'ie-1', requestId: 'rq-1', status: 'accepted' }),
  EventPublishError: class EventPublishError extends Error {},
}))
vi.mock('@/server/event-publisher', () => internal)

import { publishReleaseCommand } from '@/server/release-publisher'

beforeEach(() => {
  redisMock.xadd.mockClear().mockResolvedValue('1-1')
  internal.createAndPublishEvent.mockClear()
})

describe('publishReleaseCommand', () => {
  test('writes chatLedger cmd and internal stream', async () => {
    const result = await publishReleaseCommand({
      typ: 'applicant_release.released.v1',
      conv: 'applicant-release:rel-1',
      usr: 'staff-1',
      payload: { release_id: 'rel-1' },
    })
    expect(result.eventId).toBeTruthy()
    expect(redisMock.xadd).toHaveBeenCalledTimes(1)
    const xaddArgs = redisMock.xadd.mock.calls[0]
    expect(xaddArgs[0]).toBe('chatLedger')
    const fields: Record<string, string> = {}
    for (let i = 2; i < xaddArgs.length; i += 2) fields[xaddArgs[i]] = xaddArgs[i + 1]
    expect(fields.cls).toBe('cmd')
    expect(fields.typ).toBe('applicant_release.released.v1')
    expect(fields.agt).toBe('billie-crm')
    expect(JSON.parse(fields.payload)).toEqual({ release_id: 'rel-1' })
    expect(internal.createAndPublishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ typ: 'applicant_release.released.v1', userId: 'staff-1' }),
    )
  })

  test('throws when chatLedger keeps failing', async () => {
    redisMock.xadd.mockRejectedValue(new Error('down'))
    await expect(
      publishReleaseCommand({ typ: 't', conv: 'c', usr: 'u', payload: {} }),
    ).rejects.toThrow()
  })
})
