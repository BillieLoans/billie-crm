import { describe, it, expect, vi, beforeEach } from 'vitest'

const xadd = vi.fn().mockResolvedValue('1-0')
vi.mock('@/server/redis-client', () => ({
  getChatLedgerRedisClient: () => ({ xadd }),
}))

import { publishClearAuthorized } from '@/server/chatledger-publisher'

beforeEach(() => xadd.mockClear())

describe('publishClearAuthorized', () => {
  it('xadds a chatLedger LedgerMessage with agt=billie-crm and the ops conv', async () => {
    const res = await publishClearAuthorized({
      canonical_customer_id: 'c123',
      reasons: ['SERVICEABILITY'],
      operator_id: 'ops-1',
      justification: 'manual assessment',
      request_id: 'req-1',
      requested_at: '2026-06-28T00:00:00.000Z',
    })
    expect(res.eventId).toBeTruthy()
    expect(xadd).toHaveBeenCalledTimes(1)
    const [stream, star, ...flat] = xadd.mock.calls[0]
    expect(stream).toBe('chatLedger')
    expect(star).toBe('*')
    const fields = Object.fromEntries(
      flat.reduce((acc: string[][], v: string, i: number) => {
        if (i % 2 === 0) acc.push([v, flat[i + 1]])
        return acc
      }, []),
    )
    expect(fields.agt).toBe('billie-crm')
    expect(fields.typ).toBe('reapplication_block.clear_authorized.v1')
    expect(fields.conv).toBe('ops:block-clear:req-1')
    expect(fields.usr).toBe('c123')
    expect(fields.cls).toBe('cmd')
    expect(JSON.parse(fields.payload).request_id).toBe('req-1')
    expect(fields.seq).toBe('1')
    expect(fields.cause).toBeTruthy()
  })
})
