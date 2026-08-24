import { describe, it, expect } from 'vitest'
import {
  BlockClearRequestCommandSchema,
  BlockClearApproveCommandSchema,
} from '@/lib/events/schemas'
import {
  CLEARABLE_REASONS,
  REASONS_REQUIRING_APPROVAL,
  EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED,
} from '@/lib/events/config'

describe('block-clear event contract', () => {
  it('accepts a valid request command', () => {
    const ok = BlockClearRequestCommandSchema.safeParse({
      canonicalCustomerId: 'c123',
      conversationId: 'conv-1',
      reasons: ['SERVICEABILITY'],
      justification: 'manual assessment, ticket OPS-1',
    })
    expect(ok.success).toBe(true)
  })

  it('rejects an empty justification', () => {
    const bad = BlockClearRequestCommandSchema.safeParse({
      canonicalCustomerId: 'c123',
      reasons: ['SERVICEABILITY'],
      justification: '',
    })
    expect(bad.success).toBe(false)
  })

  it('requires a >=10 char comment to approve', () => {
    expect(
      BlockClearApproveCommandSchema.safeParse({
        requestId: 'r1',
        requestNumber: 'RBC-1',
        comment: 'too short',
      }).success,
    ).toBe(false)
  })

  it('exposes the clearable + approval-required vocabularies and the authorize type', () => {
    expect(CLEARABLE_REASONS).toEqual([
      'PRIOR_DEFAULT',
      'PRIOR_SERIOUS_ARREARS',
      'ID_VERIFICATION',
      'SERVICEABILITY',
      'ACCOUNT_CONDUCT',
      'MANUAL_ADMIN',
    ])
    expect(REASONS_REQUIRING_APPROVAL).toEqual([
      'PRIOR_DEFAULT',
      'PRIOR_SERIOUS_ARREARS',
      'MANUAL_ADMIN',
    ])
    expect(EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED).toBe(
      'reapplication_block.clear_authorized.v1',
    )
  })

  it('MANUAL_ADMIN (conversation-kill block) is clearable and maker-checker gated', () => {
    // BillieChat's kill+checkbox flow raises MANUAL_ADMIN; the CRM clear
    // vocabulary must know it so the block can actually be cleared, and it
    // requires approval like the other severe/manual reasons.
    expect(CLEARABLE_REASONS).toContain('MANUAL_ADMIN')
    expect(REASONS_REQUIRING_APPROVAL).toContain('MANUAL_ADMIN')
  })

  it('accepts MANUAL_ADMIN as a clear request reason', () => {
    const ok = BlockClearRequestCommandSchema.safeParse({
      canonicalCustomerId: 'c123',
      conversationId: 'conv-1',
      reasons: ['MANUAL_ADMIN'],
      justification: 'operator cleared manual block, ticket OPS-2',
    })
    expect(ok.success).toBe(true)
  })
})
