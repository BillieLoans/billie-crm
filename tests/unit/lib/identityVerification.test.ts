import { describe, it, expect } from 'vitest'
import {
  checkLabel,
  decisionTone,
  getChecks,
  getIdentitySources,
  getResultReasons,
  getScreening,
  isLabV1Block,
  isLegacyLabBlock,
  outcomeTone,
  resultHint,
  resultTone,
} from '@/lib/identityVerification'

const v1 = {
  id: '9c63b029',
  verificationNumber: 'V60000296',
  status: 'completed',
  result: {
    outcome: 'refer',
    checks: [
      {
        checkType: 'screening',
        outcome: 'refer',
        providers: [
          {
            provider: 'IDMatrix',
            outcome: 'refer',
            detail: {
              pep: { result: 'no_match', sources: [] },
              sanctions: { result: 'match', sources: [], matches: [] },
            },
          },
        ],
      },
      {
        checkType: 'identity',
        outcome: 'pass',
        providers: [
          {
            provider: 'IDMatrix',
            outcome: 'pass',
            detail: { sources: [{ name: 'AEC', type: 'data', isDvs: false, result: 'match' }] },
          },
        ],
      },
      { checkType: 'deceased', outcome: 'pass' },
    ],
  },
  provider: [{ name: 'IDMatrix', reference: 'REF' }],
}

describe('identityVerification shape detection', () => {
  it('detects v1 and legacy blocks', () => {
    expect(isLabV1Block(v1)).toBe(true)
    expect(isLegacyLabBlock(v1)).toBe(false)
    const legacy = { requestId: '468881', overallResult: 'Passed' }
    expect(isLabV1Block(legacy)).toBe(false)
    expect(isLegacyLabBlock(legacy)).toBe(true)
    expect(isLabV1Block(null)).toBe(false)
    expect(isLegacyLabBlock({})).toBe(false)
  })
})

describe('identityVerification accessors', () => {
  it('orders checks identity, screening, then others', () => {
    expect(getChecks(v1).map((c) => c.checkType)).toEqual(['identity', 'screening', 'deceased'])
  })

  it('reads identity sources from the first provider', () => {
    const identity = getChecks(v1)[0]
    expect(getIdentitySources(identity)).toHaveLength(1)
    expect(getIdentitySources(identity)[0].name).toBe('AEC')
    expect(getIdentitySources({ checkType: 'identity' })).toEqual([])
  })

  it('reads pep / sanctions from the screening provider', () => {
    const screening = getChecks(v1)[1]
    const { pep, sanctions } = getScreening(screening)
    expect(pep?.result).toBe('no_match')
    expect(sanctions?.result).toBe('match')
    expect(getScreening({ checkType: 'screening', providers: [] })).toEqual({})
  })

  it('reads result-level reasons', () => {
    expect(getResultReasons(v1)).toEqual([])
    expect(
      getResultReasons({
        id: 'x',
        result: { checks: [], reasons: [{ code: 'SERVICE_PARTIAL_FAILURE', message: 'm' }] },
      }),
    ).toHaveLength(1)
  })

  it('labels check types', () => {
    expect(checkLabel('identity')).toBe('Identity')
    expect(checkLabel('screening')).toBe('Screening (PEP & sanctions)')
    expect(checkLabel('death_certificate')).toBe('Death certificate')
    expect(checkLabel('something_new')).toBe('something new')
    expect(checkLabel(null)).toBe('Check')
  })
})

describe('identityVerification tones', () => {
  it('outcomeTone', () => {
    expect(outcomeTone('pass')).toBe('pass')
    expect(outcomeTone('fail')).toBe('fail')
    expect(outcomeTone('refer')).toBe('warn')
    expect(outcomeTone(null)).toBe('muted')
  })

  it('resultTone for sources', () => {
    expect(resultTone('match')).toBe('pass')
    expect(resultTone('partial_match')).toBe('warn')
    expect(resultTone('no_match')).toBe('fail')
    expect(resultTone('no_data')).toBe('muted')
    expect(resultTone('not_checked')).toBe('muted')
    expect(resultTone('undisclosed')).toBe('muted')
  })

  it('resultTone for screening categories inverts match', () => {
    expect(resultTone('no_match', 'screening')).toBe('pass')
    expect(resultTone('no-match', 'screening')).toBe('pass')
    expect(resultTone('match', 'screening')).toBe('fail')
    expect(resultTone('inconclusive', 'screening')).toBe('warn')
    expect(resultTone('not_performed', 'screening')).toBe('muted')
  })

  it('decisionTone', () => {
    expect(decisionTone('APPROVED')).toBe('pass')
    expect(decisionTone('DECLINED')).toBe('fail')
    expect(decisionTone('MANUAL_REVIEW')).toBe('warn')
    expect(decisionTone(undefined)).toBe('muted')
  })

  it('resultHint explains the non-evidence values', () => {
    expect(resultHint('undisclosed')).toMatch(/DVS/)
    expect(resultHint('inconclusive')).toMatch(/not evidence/)
    expect(resultHint('match')).toBeUndefined()
  })
})
