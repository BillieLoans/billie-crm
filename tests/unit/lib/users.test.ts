// tests/unit/lib/users.test.ts
import { describe, it, expect, vi } from 'vitest'
import type { Payload } from 'payload'
import { resolveActorDisplayName } from '@/lib/users'

function mockPayload(findByID: Payload['findByID']): Payload {
  return { findByID } as unknown as Payload
}

describe('resolveActorDisplayName', () => {
  it('resolves "user:<id>" to "First Last" via payload.findByID', async () => {
    const findByID = vi.fn().mockResolvedValue({
      id: '95979e54-7f2e-4578-a9d0-807c8951d684',
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane.smith@billie.loans',
    })
    const payload = mockPayload(findByID)

    const result = await resolveActorDisplayName(
      payload,
      'user:95979e54-7f2e-4578-a9d0-807c8951d684',
    )

    expect(result).toBe('Jane Smith')
    expect(findByID).toHaveBeenCalledWith({
      collection: 'users',
      id: '95979e54-7f2e-4578-a9d0-807c8951d684',
      depth: 0,
    })
  })

  it('falls back to email when firstName/lastName are absent', async () => {
    const findByID = vi.fn().mockResolvedValue({
      id: 'u-2',
      email: 'noname@billie.loans',
    })
    const payload = mockPayload(findByID)

    const result = await resolveActorDisplayName(payload, 'user:u-2')

    expect(result).toBe('noname@billie.loans')
  })

  it('falls back to the raw actor id when findByID throws', async () => {
    const findByID = vi.fn().mockRejectedValue(new Error('boom'))
    const payload = mockPayload(findByID)

    const result = await resolveActorDisplayName(payload, 'user:missing-id')

    expect(result).toBe('user:missing-id')
  })

  it('falls back to the raw actor id when the user is not found', async () => {
    const findByID = vi.fn().mockResolvedValue(null)
    const payload = mockPayload(findByID)

    const result = await resolveActorDisplayName(payload, 'user:missing-id')

    expect(result).toBe('user:missing-id')
  })

  it('maps "system:fraudRiskAgent" to a friendly label', async () => {
    const payload = mockPayload(vi.fn())

    const result = await resolveActorDisplayName(payload, 'system:fraudRiskAgent')

    expect(result).toBe('Fraud risk agent')
  })

  it('title-cases an unknown system actor suffix as a fallback', async () => {
    const payload = mockPayload(vi.fn())

    const result = await resolveActorDisplayName(payload, 'system:someNewAgent')

    expect(result).toBe('Some new agent')
  })

  it('returns null unchanged', async () => {
    const payload = mockPayload(vi.fn())
    expect(await resolveActorDisplayName(payload, null)).toBeNull()
  })

  it('returns empty string unchanged', async () => {
    const payload = mockPayload(vi.fn())
    expect(await resolveActorDisplayName(payload, '')).toBe('')
  })

  it('returns undefined unchanged (as null)', async () => {
    const payload = mockPayload(vi.fn())
    expect(await resolveActorDisplayName(payload, undefined)).toBeNull()
  })

  it('returns an unrecognised actor format unchanged', async () => {
    const payload = mockPayload(vi.fn())
    expect(await resolveActorDisplayName(payload, 'not-a-known-format')).toBe('not-a-known-format')
  })
})
