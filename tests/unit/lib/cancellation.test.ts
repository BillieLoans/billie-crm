import { describe, it, expect } from 'vitest'
import {
  CANCELLATION_REASON_CODES,
  CANCELLATION_REASON_LABELS,
  buildCancellationNoteText,
  cancellationReasonLabel,
  formatCancellationTime,
} from '@/lib/cancellation'

describe('cancellationReasonLabel', () => {
  it('has a label for every offered code', () => {
    for (const code of CANCELLATION_REASON_CODES) {
      expect(CANCELLATION_REASON_LABELS[code], code).toBeTruthy()
      expect(cancellationReasonLabel(code)).toBe(CANCELLATION_REASON_LABELS[code])
    }
  })

  it('does not offer the reserved reason', () => {
    expect(CANCELLATION_REASON_CODES).not.toContain('lender_declined_pre_disbursement')
  })

  it('shows a code it does not know as it is, and a dash for none', () => {
    expect(cancellationReasonLabel('some_future_code')).toBe('some_future_code')
    expect(cancellationReasonLabel(null)).toBe('—')
    expect(cancellationReasonLabel('')).toBe('—')
  })
})

describe('formatCancellationTime', () => {
  it('formats in Sydney time with daylight saving (AEDT, UTC+11)', () => {
    expect(formatCancellationTime('2026-10-30T04:45:00+00:00')).toBe('30 Oct 2026, 3:45 pm')
  })

  it('formats in Sydney standard time (AEST, UTC+10) in winter', () => {
    expect(formatCancellationTime('2026-06-30T04:45:00Z')).toBe('30 June 2026, 2:45 pm')
  })

  it('rolls over to the next Sydney day', () => {
    expect(formatCancellationTime('2026-10-30T22:30:00Z')).toBe('31 Oct 2026, 9:30 am')
  })

  it('uses ordinary spaces only', () => {
    expect(formatCancellationTime('2026-10-30T04:45:00Z')).not.toMatch(/[  ]/)
  })

  it('hands back text that is not a date', () => {
    expect(formatCancellationTime('not a date')).toBe('not a date')
  })
})

describe('buildCancellationNoteText', () => {
  const base = {
    reason: 'duplicate',
    note: 'A second application for the same customer was approved by mistake.',
    actorName: 'Sam Supervisor',
    cancelledAt: '2026-10-30T04:45:00Z',
  }

  it('follows "Cancelled — reason — note — by name at time — evidence: ref"', () => {
    expect(buildCancellationNoteText({ ...base, evidenceRef: 'ticket-42' })).toBe(
      'Cancelled — Duplicate — A second application for the same customer was approved by mistake. — by Sam Supervisor at 30 Oct 2026, 3:45 pm — evidence: ticket-42',
    )
  })

  it.each([undefined, null, '', '   '])('says evidence: none for %j', (evidenceRef) => {
    expect(buildCancellationNoteText({ ...base, evidenceRef })).toMatch(/ — evidence: none$/)
  })
})
