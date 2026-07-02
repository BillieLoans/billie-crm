import { describe, test, expect } from 'vitest'
import {
  CreateContactSchema,
  UpdateContactSchema,
  SetConsentSchema,
  LogInteractionSchema,
} from '@/lib/schemas/marketing'

describe('marketing command schemas', () => {
  test('create requires mobile or email', () => {
    expect(CreateContactSchema.safeParse({ first_name: 'J' }).success).toBe(false)
    expect(CreateContactSchema.safeParse({ mobile: '0400000001' }).success).toBe(true)
  })

  test('create accepts email-only contacts', () => {
    expect(CreateContactSchema.safeParse({ email: 'j@example.com' }).success).toBe(true)
  })

  test('create does not require consent', () => {
    const r = CreateContactSchema.safeParse({ mobile: '0400000001', first_name: 'Jo' })
    expect(r.success).toBe(true)
  })

  test('update accepts a partial payload with no required fields', () => {
    expect(UpdateContactSchema.safeParse({}).success).toBe(true)
    expect(UpdateContactSchema.safeParse({ first_name: 'Jo' }).success).toBe(true)
  })

  test('consent requires method', () => {
    expect(SetConsentSchema.safeParse({ granted: true }).success).toBe(false)
    expect(
      SetConsentSchema.safeParse({ granted: false, method: 'staff_request', channels: ['sms'] })
        .success,
    ).toBe(true)
  })

  test('consent channels default to sms', () => {
    const r = SetConsentSchema.safeParse({ granted: true, method: 'staff_request' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.channels).toEqual(['sms'])
  })

  test('interaction requires kind and source_system defaults to crm', () => {
    const r = LogInteractionSchema.safeParse({ kind: 'note', body: 'called them' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.source_system).toBe('crm')
  })

  test('interaction rejects an unknown kind', () => {
    expect(LogInteractionSchema.safeParse({ kind: 'carrier_pigeon' }).success).toBe(false)
  })
})
