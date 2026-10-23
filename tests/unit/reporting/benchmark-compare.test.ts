/**
 * Unit tests for the benchmark's result-equivalence check and reviewer packet (BTB-508).
 */
import { describe, test, expect } from 'vitest'
import { normaliseCell, resultsEquivalent } from '../../../scripts/report-benchmark/compare'
import { buildPacket, shuffled } from '../../../scripts/report-benchmark/reviewer-packet'
import { REVIEWER_SET } from '../../../scripts/report-benchmark/questions'

describe('resultsEquivalent', () => {
  const reference = [
    { source: 'paid', rate: 0.5 },
    { source: 'organic', rate: 0.25 },
  ]

  test('ignores column names, column order and row order', () => {
    expect(
      resultsEquivalent(reference, [
        { approval_rate: 0.25, acquisition: 'organic' },
        { approval_rate: 0.5, acquisition: 'paid' },
      ]),
    ).toBe(true)
  })

  test('allows extra columns but not extra or missing rows', () => {
    expect(
      resultsEquivalent(reference, [
        { s: 'paid', r: 0.5, decided: 4 },
        { s: 'organic', r: 0.25, decided: 8 },
      ]),
    ).toBe(true)
    expect(resultsEquivalent(reference, [{ s: 'paid', r: 0.5 }])).toBe(false)
    expect(resultsEquivalent(reference, [...reference, { source: 'direct', rate: 0 }])).toBe(false)
  })

  test('a different value is not equivalent; numbers compare within half a cent or 0.1%', () => {
    expect(
      resultsEquivalent(reference, [
        { s: 'paid', r: 0.5 },
        { s: 'organic', r: 0.3 },
      ]),
    ).toBe(false)
    expect(
      resultsEquivalent(reference, [
        { s: 'paid', r: 0.5001 },
        { s: 'organic', r: '0.25' },
      ]),
    ).toBe(true)
    // A rate to four places matches the same rate to two, but not a neighbour.
    expect(resultsEquivalent([{ r: 0.2449 }], [{ r: 0.24 }])).toBe(true)
    expect(resultsEquivalent([{ r: 0.2449 }], [{ r: 0.2351 }])).toBe(false)
    // A percentage is not a fraction.
    expect(
      resultsEquivalent(reference, [
        { s: 'paid', r: 50 },
        { s: 'organic', r: 25 },
      ]),
    ).toBe(false)
  })

  test('duplicate values must be matched by distinct rows', () => {
    expect(resultsEquivalent([{ n: 1 }, { n: 1 }], [{ n: 1 }, { n: 2 }])).toBe(false)
  })

  test('values swapped between columns in some rows do not match', () => {
    expect(
      resultsEquivalent(
        [
          { source: 'paid', started: 10, submitted: 8 },
          { source: 'organic', started: 6, submitted: 5 },
        ],
        [
          { source: 'paid', started: 8, submitted: 10 },
          { source: 'organic', started: 6, submitted: 5 },
        ],
      ),
    ).toBe(false)
  })

  test('a timestamp at midnight matches the date', () => {
    expect(
      resultsEquivalent(
        [{ week_start: '2026-10-05', n: 3 }],
        [{ week: '2026-10-05T00:00:00.000Z', n: 3 }],
      ),
    ).toBe(true)
  })

  test('finds a matching where a greedy pass would not', () => {
    // Reference rows (a,1) and (a,2); a greedy pass could pair (a,1) with the
    // generated row that the other reference row needs.
    expect(
      resultsEquivalent(
        [
          { k: 'a', n: 1 },
          { k: 'a', n: 2 },
        ],
        [
          { k: 'a', n: 2, extra: 1 },
          { k: 'a', n: 1, extra: 2 },
        ],
      ),
    ).toBe(true)
  })

  test('normalises cells', () => {
    expect(normaliseCell(null)).toEqual({ kind: 'text', value: 'null' })
    expect(normaliseCell('3')).toEqual({ kind: 'number', value: 3 })
    expect(normaliseCell(true)).toEqual({ kind: 'text', value: 'true' })
    expect(normaliseCell(' a ')).toEqual({ kind: 'text', value: 'a' })
    expect(normaliseCell('2026-10-05 00:00:00+11')).toEqual({ kind: 'text', value: '2026-10-05' })
  })
})

describe('reviewer packet', () => {
  test('holds all 20 definitions in a fixed order, with the errors only in the key', () => {
    const { packet, answerKey } = buildPacket()
    expect(packet.match(/^## Item \d+$/gm)).toHaveLength(20)
    expect(buildPacket().packet).toBe(packet)
    for (const d of REVIEWER_SET) {
      if (d.seededError) {
        expect(packet).not.toContain(d.seededError)
        expect(answerKey).toContain(d.seededError)
      }
    }
    expect(answerKey.match(/\| No \|/g)).toHaveLength(10)
  })

  test('shuffles without losing or duplicating items', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    const out = shuffled(items)
    expect([...out].sort((a, b) => a - b)).toEqual(items)
    expect(out).not.toEqual(items)
  })
})
