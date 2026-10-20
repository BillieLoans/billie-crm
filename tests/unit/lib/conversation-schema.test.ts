import { describe, it, expect } from 'vitest'
import { ConversationDetailSchema } from '@/lib/schemas/conversations'

// `conversationId` is the schema's only required field.
const base = { conversationId: 'conv-1' }

describe('ConversationDetailSchema.decisionMetadata', () => {
  it('accepts an open evidence object', () => {
    const parsed = ConversationDetailSchema.parse({
      ...base,
      finalDecision: 'DECLINED',
      decisionDetail: { reason: 'BUSINESS_ACCOUNT' },
      decisionMetadata: {
        component: 'personal_account_check',
        account_names: ['Business Trans Acct', null],
      },
    })
    expect(parsed.decisionMetadata?.component).toBe('personal_account_check')
  })

  it('accepts null and absent', () => {
    expect(ConversationDetailSchema.parse({ ...base, decisionMetadata: null }).decisionMetadata).toBeNull()
    expect(ConversationDetailSchema.parse(base).decisionMetadata).toBeUndefined()
  })
})
