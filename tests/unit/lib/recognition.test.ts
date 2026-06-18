import { describe, test, expect } from 'vitest'
import {
  formatPosterior,
  signalSign,
  formatSignalBits,
  signalLabel,
  groupSignalBits,
} from '@/lib/recognition'

describe('formatPosterior', () => {
  test('renders a 0..1 score as a 2-dp percentage', () => {
    expect(formatPosterior(0.989831)).toBe('98.98%')
  })

  test('renders a confident link near the ceiling', () => {
    expect(formatPosterior(0.9994)).toBe('99.94%')
  })

  test('returns a dash when the score is absent', () => {
    expect(formatPosterior(null)).toBe('—')
    expect(formatPosterior(undefined)).toBe('—')
  })
})

describe('signalSign', () => {
  test('positive bits mean the signal agrees (same person)', () => {
    expect(signalSign(10)).toBe('agrees')
  })

  test('negative bits mean the signal disagrees', () => {
    expect(signalSign(-5.06)).toBe('disagrees')
  })

  test('zero bits are neutral', () => {
    expect(signalSign(0)).toBe('neutral')
  })
})

describe('formatSignalBits', () => {
  test('prefixes a + for agreeing signals, to 1 dp', () => {
    expect(formatSignalBits(10)).toBe('+10.0')
    expect(formatSignalBits(8.94)).toBe('+8.9')
  })

  test('keeps the minus for disagreeing signals', () => {
    expect(formatSignalBits(-5.06)).toBe('-5.1')
  })
})

describe('signalLabel', () => {
  test('humanises known signals', () => {
    expect(signalLabel('dob')).toBe('DOB')
    expect(signalLabel('name')).toBe('Name')
    expect(signalLabel('address')).toBe('Address')
  })

  test('title-cases unknown signals rather than dropping them', () => {
    expect(signalLabel('device')).toBe('Device')
  })
})

describe('groupSignalBits', () => {
  // The example from the brief: a high overall score driven by agreeing contact
  // details, but disagreeing name/dob — "same contact details, different identity".
  const bits = { email: 10.0, bank: 8.94, address: 5.0, name: -5.06, dob: -5.64 }

  test('splits identity-core (name, dob) from corroborating signals', () => {
    const { core, corroborating } = groupSignalBits(bits)
    expect(core.map((s) => s.signal)).toEqual(['name', 'dob'])
    expect(corroborating.map((s) => s.signal)).toEqual(['email', 'bank', 'address'])
  })

  test('carries the sign so the chip can colour agree vs disagree', () => {
    const { core } = groupSignalBits(bits)
    expect(core).toEqual([
      { signal: 'name', bits: -5.06, sign: 'disagrees' },
      { signal: 'dob', bits: -5.64, sign: 'disagrees' },
    ])
  })

  test('keeps a fixed canonical order regardless of payload key order', () => {
    const shuffled = { address: 5, dob: -5.64, email: 10, name: -5.06, bank: 8.94 }
    const { core, corroborating } = groupSignalBits(shuffled)
    expect(core.map((s) => s.signal)).toEqual(['name', 'dob'])
    expect(corroborating.map((s) => s.signal)).toEqual(['email', 'bank', 'address'])
  })

  test('appends unknown signals to corroborating without dropping them', () => {
    const { corroborating } = groupSignalBits({ email: 1, device: 2 })
    expect(corroborating.map((s) => s.signal)).toEqual(['email', 'device'])
  })

  test('handles a missing or empty bit map', () => {
    expect(groupSignalBits(null)).toEqual({ core: [], corroborating: [] })
    expect(groupSignalBits(undefined)).toEqual({ core: [], corroborating: [] })
    expect(groupSignalBits({})).toEqual({ core: [], corroborating: [] })
  })
})
