import { describe, expect, it } from 'vitest'
import { CONVERSATION_STATUSES, CancellationRecordSchema } from '@/lib/schemas/conversations'

describe('conversation cancellation contract', () => {
  it('accepts the two new terminal statuses', () => {
    expect(CONVERSATION_STATUSES).toContain('cancelled')
    expect(CONVERSATION_STATUSES).toContain('expired')
  })

  it('parses a full cancellation record', () => {
    const parsed = CancellationRecordSchema.parse({
      reason: 'final_offer_declined',
      category: 'customer_declined',
      cancelled_at: '2026-08-28T01:37:30.993832+00:00',
      source_event: 'customer_cancelled',
      application_number: 'C6F7C8E6-77F',
    })
    expect(parsed.category).toBe('customer_declined')
  })

  it('tolerates a sparse record', () => {
    expect(() => CancellationRecordSchema.parse({ reason: 'session_timeout' })).not.toThrow()
  })
})
