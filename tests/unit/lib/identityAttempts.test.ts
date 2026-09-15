/**
 * shapeAttempts — stored attempts object → sorted browser-safe array
 * (billieChat spec 2026-09-15).
 */
import { describe, it, expect } from 'vitest'
import {
  attemptDocumentsLabel,
  documentTypeLabel,
  shapeAttempts,
} from '@/lib/identityAttempts'

const STORED = {
  '60000651': {
    attempt_number: 2,
    step_up: true,
    step_up_requested: false,
    document_types: ['DRIVERS_LICENCE', 'PASSPORT'],
    decision: 'APPROVED',
    identity_verification_failed: false,
    screening_hit: false,
    pep_result: 'no-match',
    sanctions_result: 'no-match',
    lab_verification: { requestId: '60000651', overallResult: 'Passed' },
    lab_request_id: '60000651',
    checked_at: '2026-09-15T00:10:00+00:00',
    report_file_location: 's3://b/86332415-5F3/IdentityVerification/verification_report_60000651.pdf',
    report_file_name: 'verification_report_60000651.pdf',
    raw_response_file_location: 's3://b/x.json',
    raw_response_file_name: 'verify_response_60000651.json',
    archived_at: '2026-09-15T00:10:05+00:00',
  },
  '60000650': {
    attempt_number: 1,
    step_up: false,
    step_up_requested: true,
    document_types: ['DRIVERS_LICENCE'],
    decision: 'DECLINED',
    identity_verification_failed: true,
    screening_hit: false,
    lab_verification: { requestId: '60000650', overallResult: 'Failed' },
    lab_request_id: '60000650',
    checked_at: '2026-09-15T00:00:00+00:00',
  },
}

describe('shapeAttempts', () => {
  it('returns attempts sorted by attempt number with camelCase fields', () => {
    const attempts = shapeAttempts(STORED)
    expect(attempts.map((a) => a.attemptNumber)).toEqual([1, 2])
    expect(attempts[0]).toMatchObject({
      key: '60000650',
      stepUp: false,
      stepUpRequested: true,
      documentTypes: ['DRIVERS_LICENCE'],
      decision: 'DECLINED',
      identityVerificationFailed: true,
      labRequestId: '60000650',
      reportAvailable: false,
      rawResponseAvailable: false,
    })
    expect(attempts[1]).toMatchObject({
      key: '60000651',
      stepUp: true,
      reportAvailable: true,
      reportFileName: 'verification_report_60000651.pdf',
      rawResponseAvailable: true,
      archivedAt: '2026-09-15T00:10:05+00:00',
    })
    expect(attempts[1].labVerification).toEqual({ requestId: '60000651', overallResult: 'Passed' })
  })

  it('never exposes S3 locations', () => {
    const json = JSON.stringify(shapeAttempts(STORED))
    expect(json).not.toContain('s3://')
    expect(json).not.toContain('file_location')
  })

  it('tolerates null, arrays and malformed entries', () => {
    expect(shapeAttempts(null)).toEqual([])
    expect(shapeAttempts(undefined)).toEqual([])
    expect(shapeAttempts([1, 2])).toEqual([])
    expect(shapeAttempts({ a: 'nope', b: { attempt_number: '1', document_types: 'x' } })).toEqual([
      expect.objectContaining({ key: 'b', attemptNumber: 1, documentTypes: [] }),
    ])
  })

  it('places entries without an attempt number last', () => {
    const attempts = shapeAttempts({ ...STORED, 'attempt-x': { decision: 'APPROVED' } })
    expect(attempts.at(-1)?.key).toBe('attempt-x')
  })
})

describe('labels', () => {
  it('names the three DVS document types', () => {
    expect(documentTypeLabel('DRIVERS_LICENCE')).toBe('Driver licence')
    expect(documentTypeLabel('PASSPORT')).toBe('Passport')
    expect(documentTypeLabel('MEDICARE')).toBe('Medicare card')
    expect(documentTypeLabel('BIRTH_CERTIFICATE')).toBe('birth certificate')
  })

  it('joins documents and falls back to electronic only', () => {
    expect(attemptDocumentsLabel(['DRIVERS_LICENCE', 'PASSPORT'])).toBe('Driver licence + Passport')
    expect(attemptDocumentsLabel([])).toBe('Electronic only')
  })
})
