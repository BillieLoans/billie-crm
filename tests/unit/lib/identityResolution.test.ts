import { describe, it, expect } from 'vitest'
import { identityResolutionSummary, shapeIdentityResolution } from '@/lib/identityResolution'

const STORED = {
  link: {
    canonical_id: '23D47AB2',
    alias_id: 'J1',
    link_id: 'lnk_1',
    reason: 'DOCUMENT_AGREE',
    at: '2026-09-24T02:00:05Z',
  },
  resolver_assessments: {
    '1758700005000-0': {
      event_id: '1758700005000-0',
      assessed_at: '2026-09-24T02:00:05Z',
      candidate_id: '23D47AB2',
      verdict: 'CANNOT_DECIDE',
      confidence: 0.4,
      factors: ['dob_exact'],
      mode: 'shadow',
      applied: false,
      platform_reason_code: 'MIDDLE_BAND',
      latency_ms: 3100,
      model: 'gpt-5.4',
    },
    '1758700000000-0': {
      event_id: '1758700000000-0',
      assessed_at: '2026-09-24T02:00:00Z',
      candidate_id: '23D47AB2',
      verdict: 'SAME_PERSON',
      confidence: 0.91,
      factors: ['name_exact', 'dob_exact'],
      mode: 'shadow',
      applied: false,
      platform_reason_code: 'MIDDLE_BAND',
      latency_ms: 2140,
      model: 'gpt-5.4',
    },
  },
  review_case: {
    case_id: 'case-1',
    band: 'REVIEW',
    posterior: 0.63,
    flags: ['ADDRESS_ONLY'],
    candidate_ids: ['23D47AB2'],
    per_signal_bits: { name: 4.1, dob: 6.2, junk: 'x' },
    recommendation: 'resolver',
    disposition: 'resolver_same_person',
    related_journeys: [],
    opened_at: '2026-09-24T02:00:01Z',
  },
}

describe('shapeIdentityResolution', () => {
  it('shapes the stored column: link, assessments ascending, review case', () => {
    const shaped = shapeIdentityResolution(STORED)!
    expect(shaped.link).toEqual({
      canonicalId: '23D47AB2',
      aliasId: 'J1',
      linkId: 'lnk_1',
      reason: 'DOCUMENT_AGREE',
      at: '2026-09-24T02:00:05Z',
    })
    expect(shaped.merge).toBeNull()
    expect(shaped.resolverAssessments.map((a) => a.verdict)).toEqual([
      'SAME_PERSON',
      'CANNOT_DECIDE',
    ])
    expect(shaped.resolverAssessments[0]).toMatchObject({
      eventId: '1758700000000-0',
      confidence: 0.91,
      factors: ['name_exact', 'dob_exact'],
      applied: false,
      platformReasonCode: 'MIDDLE_BAND',
      latencyMs: 2140,
    })
    expect(shaped.reviewCase).toMatchObject({
      caseId: 'case-1',
      band: 'REVIEW',
      posterior: 0.63,
      candidateIds: ['23D47AB2'],
      perSignalBits: { name: 4.1, dob: 6.2 },
    })
  })

  it('returns null for nothing recorded or malformed input', () => {
    expect(shapeIdentityResolution(null)).toBeNull()
    expect(shapeIdentityResolution({})).toBeNull()
    expect(shapeIdentityResolution([])).toBeNull()
    expect(shapeIdentityResolution('x')).toBeNull()
    expect(shapeIdentityResolution({ resolver_assessments: { a: 'not an object' } })).toBeNull()
  })

  it('tolerates a partial column', () => {
    const shaped = shapeIdentityResolution({ merge: { canonical_id: 'A', alias_id: 'Z' } })!
    expect(shaped.merge).toMatchObject({ canonicalId: 'A', aliasId: 'Z', reason: null })
    expect(shaped.link).toBeNull()
    expect(shaped.resolverAssessments).toEqual([])
  })
})

describe('identityResolutionSummary', () => {
  it('prefers the link outcome, then the latest resolver verdict, then the review case', () => {
    expect(identityResolutionSummary(shapeIdentityResolution(STORED))).toBe(
      'Linked to 23D47AB2 · DOCUMENT_AGREE',
    )
    const { link: _link, ...noLink } = STORED
    expect(identityResolutionSummary(shapeIdentityResolution(noLink))).toBe(
      'Resolver: CANNOT_DECIDE 0.40 (shadow)',
    )
    expect(
      identityResolutionSummary(shapeIdentityResolution({ review_case: STORED.review_case })),
    ).toBe('Review case · REVIEW')
    expect(identityResolutionSummary(null)).toBe('—')
  })
})
