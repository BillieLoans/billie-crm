/**
 * A logged request's id is a uuid; anything else names no request and is
 * never sent to the database (where a malformed uuid is an error, not "not
 * found").
 */
import { describe, expect, it, vi } from 'vitest'
import { loadOwnAsk } from '@/server/reporting/ask/draft'

describe('loadOwnAsk', () => {
  it('finds nothing for an id that is not a uuid, without a query', async () => {
    const find = vi.fn()
    const payload = { find } as never
    expect(await loadOwnAsk(payload, 'u', 'abc')).toBeNull()
    expect(await loadOwnAsk(payload, 'u', "1' OR '1'='1")).toBeNull()
    expect(find).not.toHaveBeenCalled()
    find.mockResolvedValue({ docs: [] })
    expect(await loadOwnAsk(payload, 'u', '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b')).toBeNull()
    expect(find).toHaveBeenCalledTimes(1)
  })
})
