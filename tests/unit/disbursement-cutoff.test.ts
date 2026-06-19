import { describe, it, expect } from 'vitest'
import {
  sydneyOffsetMinutes,
  sydneyDateString,
  classifyBucket,
  cutoffInstant,
  msUntilCutoff,
  formatCountdown,
  getCommencementDate,
  nextSydneyDateString,
  summariseDisbursementBuckets,
} from '@/lib/disbursement-cutoff'

describe('sydneyDateString', () => {
  it('rolls a late-UTC instant into the correct Sydney calendar day', () => {
    // 2026-06-17T22:00:00Z is 2026-06-18 08:00 AEST
    expect(sydneyDateString(new Date('2026-06-17T22:00:00Z'))).toBe('2026-06-18')
  })
})

describe('classifyBucket', () => {
  const now = new Date('2026-06-17T01:00:00Z') // 2026-06-17 11:00 AEST
  it('past commencement -> overdue', () => {
    expect(classifyBucket('2026-06-16', now)).toBe('overdue')
  })
  it('same Sydney day -> today', () => {
    expect(classifyBucket('2026-06-17', now)).toBe('today')
  })
  it('future commencement -> scheduled', () => {
    expect(classifyBucket('2026-06-18', now)).toBe('scheduled')
  })
})

describe('cutoffInstant / msUntilCutoff', () => {
  it('is 15:00 AEST (UTC+10) in winter -> 05:00Z', () => {
    const now = new Date('2026-06-17T01:00:00Z')
    expect(cutoffInstant(now).toISOString()).toBe('2026-06-17T05:00:00.000Z')
  })
  it('is 15:00 AEDT (UTC+11) in summer -> 04:00Z', () => {
    const now = new Date('2026-01-15T01:00:00Z')
    expect(cutoffInstant(now).toISOString()).toBe('2026-01-15T04:00:00.000Z')
  })
  it('msUntilCutoff is positive before 3pm, negative after', () => {
    expect(msUntilCutoff(new Date('2026-06-17T01:00:00Z'))).toBeGreaterThan(0)
    expect(msUntilCutoff(new Date('2026-06-17T06:00:00Z'))).toBeLessThan(0)
  })
})

describe('formatCountdown', () => {
  it('formats hours and minutes', () => {
    expect(formatCountdown(2 * 3600_000 + 14 * 60_000)).toBe('2h 14m')
  })
  it('formats minutes only under an hour', () => {
    expect(formatCountdown(9 * 60_000)).toBe('9m')
  })
})

describe('getCommencementDate', () => {
  it('prefers a dedicated commencementDate field', () => {
    expect(
      getCommencementDate({
        commencementDate: '2026-06-20',
        loanTerms: { openedDate: '2026-06-17' },
      }),
    ).toBe('2026-06-20')
  })
  it('falls back to loanTerms.openedDate', () => {
    expect(getCommencementDate({ loanTerms: { openedDate: '2026-06-17T00:00:00Z' } })).toBe(
      '2026-06-17T00:00:00Z',
    )
  })
  it('returns null when neither present', () => {
    expect(getCommencementDate({})).toBeNull()
  })
})

describe('sydneyOffsetMinutes', () => {
  it('is +600 in winter (AEST) and +660 in summer (AEDT)', () => {
    expect(sydneyOffsetMinutes(new Date('2026-06-17T01:00:00Z'))).toBe(600)
    expect(sydneyOffsetMinutes(new Date('2026-01-15T01:00:00Z'))).toBe(660)
  })
})

describe('formatCountdown negative clamp', () => {
  it('clamps negative durations to 0m', () => {
    expect(formatCountdown(-5 * 60_000)).toBe('0m')
  })
})

describe('nextSydneyDateString', () => {
  it('returns the next Sydney calendar day', () => {
    expect(nextSydneyDateString(new Date('2026-06-17T01:00:00Z'))).toBe('2026-06-18')
  })
  it('rolls month/year boundaries', () => {
    expect(nextSydneyDateString(new Date('2026-06-30T01:00:00Z'))).toBe('2026-07-01')
  })
})

describe('summariseDisbursementBuckets', () => {
  const now = new Date('2026-06-17T01:00:00Z') // Wed 17 Jun 2026, 11:00 AEST
  it('aggregates counts/totals per bucket and flags tomorrow', () => {
    const loans = [
      { loanAmount: 100, commencementDate: '2026-06-16', bucket: 'overdue' as const },
      { loanAmount: 200, commencementDate: '2026-06-17', bucket: 'today' as const },
      { loanAmount: 50, commencementDate: '2026-06-18', bucket: 'scheduled' as const },
      { loanAmount: 75, commencementDate: '2026-06-20', bucket: 'scheduled' as const },
    ]
    const s = summariseDisbursementBuckets(loans, 3, now)
    expect(s.overdue).toEqual({ count: 1, total: 100 })
    expect(s.today).toEqual({ count: 1, total: 200 })
    expect(s.scheduled).toEqual({ count: 2, total: 125 })
    expect(s.scheduledTomorrowCount).toBe(1)
    expect(s.todayDoneCount).toBe(3)
    expect(s.todayTotalCount).toBe(4)
  })
  it('handles empty input', () => {
    const s = summariseDisbursementBuckets([], 0, now)
    expect(s.today).toEqual({ count: 0, total: 0 })
    expect(s.todayTotalCount).toBe(0)
    expect(s.scheduledTomorrowCount).toBe(0)
  })
})
