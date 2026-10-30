// tests/unit/lib/reapplication-block.test.ts
import { describe, it, expect } from 'vitest'
import {
  formatBlockLabel,
  formatBlockReason,
  formatBlockedUntil,
  isBlockActive,
  isBlockDeclineReason,
  isManualBlockActive,
  manualBlockExpiresAt,
  manualBlockReasonCode,
  MANUAL_BLOCK_REASON_CODES,
  MANUAL_BLOCK_REASON_LABELS,
} from '@/lib/reapplicationBlock'

const TODAY = new Date('2026-06-10T12:00:00+10:00')

describe('formatBlockReason', () => {
  it('humanizes known reason enums', () => {
    expect(formatBlockReason('ID_VERIFICATION')).toBe('ID verification')
    expect(formatBlockReason('ACTIVE_LOAN')).toBe('Active loan')
    expect(formatBlockReason('PRIOR_DEFAULT')).toBe('Prior default')
    expect(formatBlockReason('PEP')).toBe('PEP')
    expect(formatBlockReason('SERVICEABILITY')).toBe('Serviceability')
    expect(formatBlockReason('ACCOUNT_CONDUCT')).toBe('Account conduct')
    expect(formatBlockReason('IDENTITY_CONFLICT')).toBe('Identity conflict')
    expect(formatBlockReason('PRIOR_SERIOUS_ARREARS')).toBe('Prior serious arrears')
    expect(formatBlockReason('APPLICATION_IN_PROGRESS')).toBe('Application in progress')
    expect(formatBlockReason('MANUAL_ADMIN')).toBe('Manually blocked (staff)')
  })

  it('falls back to the raw value for unknown enums', () => {
    expect(formatBlockReason('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })

  it('returns em dash for missing reason', () => {
    expect(formatBlockReason(null)).toBe('—')
    expect(formatBlockReason(undefined)).toBe('—')
  })
})

describe('formatBlockedUntil', () => {
  it('formats a dated window', () => {
    expect(
      formatBlockedUntil({ reason: 'ID_VERIFICATION', blockedUntil: '2026-12-10T01:02:21+00:00' }),
    ).toBe('until 10 December 2026')
  })

  it('null window is permanent for PEP-class reasons', () => {
    expect(formatBlockedUntil({ reason: 'PEP', blockedUntil: null })).toBe('permanent')
    expect(formatBlockedUntil({ reason: 'PRIOR_DEFAULT', blockedUntil: null })).toBe('permanent')
    expect(formatBlockedUntil({ reason: 'IDENTITY_CONFLICT', blockedUntil: null })).toBe('permanent')
  })

  it('null window is while-loan-open for ACTIVE_LOAN', () => {
    expect(formatBlockedUntil({ reason: 'ACTIVE_LOAN', blockedUntil: null })).toBe('while loan open')
  })

  it('PRIOR_SERIOUS_ARREARS is a dated window, not permanent (BTB-154)', () => {
    // Cured serious arrears/default carries a 12-month blockedUntil from
    // closure — it must render as a date, never "permanent".
    expect(
      formatBlockedUntil({
        reason: 'PRIOR_SERIOUS_ARREARS',
        blockedUntil: '2027-06-10T01:02:21+00:00',
      }),
    ).toBe('until 10 June 2027')
  })

  it('APPLICATION_IN_PROGRESS reads as ongoing state despite its dated backstop (BTB-397)', () => {
    // The in-flight claim carries blockedUntil = claim + 3 h purely as a
    // self-lapse backstop; staff should see the state, not a date that is
    // always today.
    expect(
      formatBlockedUntil({
        reason: 'APPLICATION_IN_PROGRESS',
        blockedUntil: '2026-10-06T12:34:00+00:00',
      }),
    ).toBe('while application in progress')
    expect(formatBlockedUntil({ reason: 'APPLICATION_IN_PROGRESS', blockedUntil: null })).toBe(
      'while application in progress',
    )
  })
})

describe('isBlockActive', () => {
  it('false for missing block', () => {
    expect(isBlockActive(null, TODAY)).toBe(false)
    expect(isBlockActive(undefined, TODAY)).toBe(false)
    expect(isBlockActive({ reason: null, blockedUntil: null }, TODAY)).toBe(false)
  })

  it('active while blockedUntil is in the future', () => {
    expect(
      isBlockActive({ reason: 'ID_VERIFICATION', blockedUntil: '2026-12-10T01:02:21+00:00' }, TODAY),
    ).toBe(true)
  })

  it('inclusive boundary — still active on the blockedUntil day itself', () => {
    expect(isBlockActive({ reason: 'SERVICEABILITY', blockedUntil: '2026-06-10' }, TODAY)).toBe(true)
  })

  it('inactive once the window has lapsed', () => {
    expect(
      isBlockActive({ reason: 'SERVICEABILITY', blockedUntil: '2026-06-01T00:00:00+00:00' }, TODAY),
    ).toBe(false)
  })

  it('null window (permanent / ongoing) is always active', () => {
    expect(isBlockActive({ reason: 'PEP', blockedUntil: null }, TODAY)).toBe(true)
    expect(isBlockActive({ reason: 'ACTIVE_LOAN', blockedUntil: null }, TODAY)).toBe(true)
  })

  it('unparseable dates are treated as inactive', () => {
    expect(isBlockActive({ reason: 'PEP', blockedUntil: 'not-a-date' }, TODAY)).toBe(false)
  })
})

describe('isBlockDeclineReason', () => {
  it('matches REAPPLICATION_BLOCK-prefixed decision reasons', () => {
    expect(isBlockDeclineReason('REAPPLICATION_BLOCK:ID_VERIFICATION')).toBe(true)
    expect(isBlockDeclineReason('REAPPLICATION_BLOCK:PEP')).toBe(true)
  })

  it('does not match other or missing reasons', () => {
    expect(isBlockDeclineReason('SERVICEABILITY_FAILED')).toBe(false)
    expect(isBlockDeclineReason(null)).toBe(false)
    expect(isBlockDeclineReason(undefined)).toBe(false)
  })
})

// BTB-517: a MANUAL_ADMIN block raised by the CRM's "Set manual block" carries a
// reason code. It is shown only while the mirrored block is the one that set
// put in place: state.changed binds the block to the set's request id, and the
// manual_set_applied reply supplies that request's code.
describe('manual block reason code (BTB-517)', () => {
  const setBlock = {
    reason: 'MANUAL_ADMIN',
    blockedUntil: null,
    manualBlockRequestId: 'req-1',
    manualSetRequestId: 'req-1',
    manualSetReasonCode: 'credit_review_hold',
  }

  it('offers exactly the three manual block reason codes, with staff labels', () => {
    expect([...MANUAL_BLOCK_REASON_CODES]).toEqual([
      'credit_review_hold',
      'cancelled_pre_disbursement',
      'fraud_hold',
    ])
    expect(MANUAL_BLOCK_REASON_LABELS.credit_review_hold).toBe('Credit review hold')
    expect(MANUAL_BLOCK_REASON_LABELS.cancelled_pre_disbursement).toBe('Cancelled before disbursement')
    expect(MANUAL_BLOCK_REASON_LABELS.fraud_hold).toBe('Fraud hold')
  })

  it('labels a MANUAL_ADMIN block with the reason code of the set that raised it', () => {
    expect(manualBlockReasonCode(setBlock)).toBe('credit_review_hold')
    expect(formatBlockLabel(setBlock)).toBe('Manual block — credit review hold')
    expect(formatBlockLabel({ ...setBlock, manualSetReasonCode: 'cancelled_pre_disbursement' })).toBe(
      'Manual block — cancelled before disbursement',
    )
    expect(formatBlockLabel({ ...setBlock, manualSetReasonCode: 'fraud_hold' })).toBe(
      'Manual block — fraud hold',
    )
  })

  it('a block raised by a conversation kill never shows an older set\'s code', () => {
    // state.changed for the kill unbinds the block (manualBlockRequestId null);
    // the older set's applied reply is still stored.
    const killBlock = { ...setBlock, manualBlockRequestId: null }
    expect(manualBlockReasonCode(killBlock)).toBeNull()
    expect(formatBlockLabel(killBlock)).toBe('Manually blocked (staff)')
  })

  it('a late reply for an older set does not relabel a newer block', () => {
    const block = { ...setBlock, manualBlockRequestId: 'req-2', manualSetRequestId: 'req-1' }
    expect(formatBlockLabel(block)).toBe('Manually blocked (staff)')
  })

  it('stays generic while the applied reply has not arrived yet', () => {
    const block = { ...setBlock, manualSetRequestId: null, manualSetReasonCode: null }
    expect(formatBlockLabel(block)).toBe('Manually blocked (staff)')
  })

  it('stays generic for a code it does not know', () => {
    expect(formatBlockLabel({ ...setBlock, manualSetReasonCode: 'something_else' })).toBe(
      'Manually blocked (staff)',
    )
  })

  it('never applies a manual code to another reason', () => {
    const block = { ...setBlock, reason: 'ACTIVE_LOAN' }
    expect(manualBlockReasonCode(block)).toBeNull()
    expect(formatBlockLabel(block)).toBe('Active loan')
    expect(formatBlockLabel(null)).toBe('—')
  })

  it('isManualBlockActive: an active MANUAL_ADMIN block only', () => {
    expect(isManualBlockActive(setBlock, TODAY)).toBe(true)
    expect(isManualBlockActive({ reason: 'MANUAL_ADMIN', blockedUntil: '2026-06-01' }, TODAY)).toBe(false)
    expect(isManualBlockActive({ reason: 'ACTIVE_LOAN', blockedUntil: null }, TODAY)).toBe(false)
    expect(isManualBlockActive(null, TODAY)).toBe(false)
  })

  it('manualBlockExpiresAt: the block runs to the end of the chosen Sydney day', () => {
    // AEDT (UTC+11): 23:59:59.999 on 3 Nov 2026 Sydney is 12:59:59.999Z.
    expect(manualBlockExpiresAt('2026-11-03')).toBe('2026-11-03T12:59:59.999Z')
    // AEST (UTC+10) in winter.
    expect(manualBlockExpiresAt('2026-07-15')).toBe('2026-07-15T13:59:59.999Z')
    // The day the clocks go forward (4 Oct 2026) ends on AEDT.
    expect(manualBlockExpiresAt('2026-10-04')).toBe('2026-10-04T12:59:59.999Z')
  })
})
