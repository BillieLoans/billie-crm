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

import { publishReleaseCommand, publishGateModeCommand } from '@/server/release-publisher'

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
      expect.objectContaining({
        typ: 'applicant_release.released.v1',
        userId: 'staff-1',
        requestId: 'applicant-release:rel-1',
      }),
    )
  })

  test('throws when chatLedger keeps failing', async () => {
    redisMock.xadd.mockRejectedValue(new Error('down'))
    await expect(
      publishReleaseCommand({ typ: 't', conv: 'c', usr: 'u', payload: {} }),
    ).rejects.toThrow()
  })

  test('logs divergence and rethrows when chatLedger commits but internal publish fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const internalError = new Error('redis down')
    internal.createAndPublishEvent.mockRejectedValue(internalError)
    await expect(
      publishReleaseCommand({
        typ: 'applicant_release.released.v1',
        conv: 'applicant-release:rel-1',
        usr: 'staff-1',
        payload: { release_id: 'rel-1', mobiles: ['+61400000001'] },
      }),
    ).rejects.toThrow('redis down')
    expect(redisMock.xadd).toHaveBeenCalledTimes(1) // chatLedger did commit
    expect(consoleError).toHaveBeenCalledWith(
      '[ReleasePublisher] chatLedger committed but internal publish failed — CRM projection lags billieChat',
      { releaseTyp: 'applicant_release.released.v1', conv: 'applicant-release:rel-1' },
    )
    // No payload/mobiles in the log — only typ and conv.
    const loggedArgs = consoleError.mock.calls[0]
    expect(JSON.stringify(loggedArgs)).not.toContain('+61400000001')
    consoleError.mockRestore()
  })
})

describe('publishGateModeCommand', () => {
  test('writes chatLedger ONLY — no internal-stream publish', async () => {
    const result = await publishGateModeCommand({ mode: 'gated', usr: 'admin-1' })
    expect(result.eventId).toBeTruthy()
    expect(redisMock.xadd).toHaveBeenCalledTimes(1)
    expect(internal.createAndPublishEvent).not.toHaveBeenCalled()

    const xaddArgs = redisMock.xadd.mock.calls[0]
    expect(xaddArgs[0]).toBe('chatLedger')
    const fields: Record<string, string> = {}
    for (let i = 2; i < xaddArgs.length; i += 2) fields[xaddArgs[i]] = xaddArgs[i + 1]
    expect(fields.cls).toBe('cmd')
    expect(fields.typ).toBe('applicant_release.gate_mode.set.v1')
    expect(fields.conv).toBe('applicant-release:gate')
    expect(fields.agt).toBe('billie-crm')
    expect(fields.usr).toBe('admin-1')
    expect(JSON.parse(fields.payload)).toEqual({ mode: 'gated', set_by: 'admin-1' })
  })

  test('includes reason when provided, omits it when undefined', async () => {
    await publishGateModeCommand({ mode: 'closed', usr: 'admin-1', reason: 'incident' })
    const withReason = redisMock.xadd.mock.calls[0]
    const reasonFields: Record<string, string> = {}
    for (let i = 2; i < withReason.length; i += 2) reasonFields[withReason[i]] = withReason[i + 1]
    expect(JSON.parse(reasonFields.payload)).toEqual({
      mode: 'closed',
      set_by: 'admin-1',
      reason: 'incident',
    })

    redisMock.xadd.mockClear()
    await publishGateModeCommand({ mode: 'open', usr: 'admin-1' })
    const noReason = redisMock.xadd.mock.calls[0]
    const noReasonFields: Record<string, string> = {}
    for (let i = 2; i < noReason.length; i += 2) noReasonFields[noReason[i]] = noReason[i + 1]
    const parsed = JSON.parse(noReasonFields.payload)
    expect(parsed).toEqual({ mode: 'open', set_by: 'admin-1' })
    expect('reason' in parsed).toBe(false)
  })

  test('throws when chatLedger keeps failing', async () => {
    redisMock.xadd.mockRejectedValue(new Error('down'))
    await expect(publishGateModeCommand({ mode: 'open', usr: 'admin-1' })).rejects.toThrow()
  })
})
