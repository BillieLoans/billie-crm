import { describe, test, expect } from 'vitest'
import { CreateReleaseCommandSchema } from '@/lib/schemas/releases'
import { normaliseAuMobile } from '@/lib/marketing'

const base = {
  releaseId: 'rel_12345678',
  name: 'August wave 3',
  expiryDays: 14,
  sendInviteSms: false,
}

describe('CreateReleaseCommandSchema', () => {
  test('waitlist requires count, forbids mobiles', () => {
    expect(
      CreateReleaseCommandSchema.safeParse({ ...base, type: 'waitlist', count: 150 }).success,
    ).toBe(true)

    const missingCount = CreateReleaseCommandSchema.safeParse({ ...base, type: 'waitlist' })
    expect(missingCount.success).toBe(false)
    if (!missingCount.success) {
      expect(missingCount.error.issues[0].path).toEqual(['count'])
    }

    const withMobiles = CreateReleaseCommandSchema.safeParse({
      ...base,
      type: 'waitlist',
      count: 1,
      mobiles: ['0400000001'],
    })
    expect(withMobiles.success).toBe(false)
    if (!withMobiles.success) {
      expect(withMobiles.error.issues[0].path).toEqual(['mobiles'])
    }
  })

  test('phone_list requires mobiles, caps at 1000', () => {
    expect(
      CreateReleaseCommandSchema.safeParse({
        ...base,
        type: 'phone_list',
        mobiles: ['0400 000 001'],
      }).success,
    ).toBe(true)

    const missingMobiles = CreateReleaseCommandSchema.safeParse({ ...base, type: 'phone_list' })
    expect(missingMobiles.success).toBe(false)
    if (!missingMobiles.success) {
      expect(missingMobiles.error.issues[0].path).toEqual(['mobiles'])
    }

    const tooMany = Array.from({ length: 1001 }, (_, i) => `04000${String(i).padStart(5, '0')}`)
    expect(
      CreateReleaseCommandSchema.safeParse({ ...base, type: 'phone_list', mobiles: tooMany })
        .success,
    ).toBe(false)
  })

  test('open_quota requires count and forces sendInviteSms off', () => {
    const smsConflict = CreateReleaseCommandSchema.safeParse({
      ...base,
      type: 'open_quota',
      count: 150,
      sendInviteSms: true,
    })
    expect(smsConflict.success).toBe(false)
    if (!smsConflict.success) {
      expect(smsConflict.error.issues[0].path).toEqual(['sendInviteSms'])
    }

    expect(
      CreateReleaseCommandSchema.safeParse({ ...base, type: 'open_quota', count: 150 }).success,
    ).toBe(true)
  })

  test('expiryDays bounds and default', () => {
    expect(
      CreateReleaseCommandSchema.parse({
        ...base,
        type: 'waitlist',
        count: 1,
        expiryDays: undefined,
      }).expiryDays,
    ).toBe(14)
    expect(
      CreateReleaseCommandSchema.safeParse({ ...base, type: 'waitlist', count: 1, expiryDays: 0 })
        .success,
    ).toBe(false)
    expect(
      CreateReleaseCommandSchema.safeParse({ ...base, type: 'waitlist', count: 1, expiryDays: 91 })
        .success,
    ).toBe(false)
  })

  test('releaseId minimum length 8', () => {
    expect(
      CreateReleaseCommandSchema.safeParse({
        ...base,
        releaseId: 'rel_123',
        type: 'waitlist',
        count: 1,
      }).success,
    ).toBe(false)
    expect(
      CreateReleaseCommandSchema.safeParse({
        ...base,
        releaseId: 'rel_1234',
        type: 'waitlist',
        count: 1,
      }).success,
    ).toBe(true)
  })

  test('name maximum length 200', () => {
    const longName = 'a'.repeat(201)
    expect(
      CreateReleaseCommandSchema.safeParse({
        ...base,
        name: longName,
        type: 'waitlist',
        count: 1,
      }).success,
    ).toBe(false)
    const validName = 'a'.repeat(200)
    expect(
      CreateReleaseCommandSchema.safeParse({
        ...base,
        name: validName,
        type: 'waitlist',
        count: 1,
      }).success,
    ).toBe(true)
  })
})

describe('normaliseAuMobile bare-4 alignment (spec §7)', () => {
  test('accepts bare 4XXXXXXXX like the Python variant', () => {
    expect(normaliseAuMobile('400000001')).toBe('+61400000001')
  })
  test('existing forms unchanged', () => {
    expect(normaliseAuMobile('0400 000 001')).toBe('+61400000001')
    expect(normaliseAuMobile('+61400000001')).toBe('+61400000001')
    expect(normaliseAuMobile('61400000001')).toBe('+61400000001')
    expect(normaliseAuMobile('12345')).toBeNull()
  })
})
