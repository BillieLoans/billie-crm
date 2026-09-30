import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { IdentityResolutionDetail } from '@/components/ConversationDetailView/AssessmentPanel/IdentityResolutionDetail'
import { shapeIdentityResolution } from '@/lib/identityResolution'

const STORED = {
  link: {
    canonical_id: '23D47AB2',
    alias_id: 'J1',
    link_id: 'lnk_1',
    reason: 'LOGIN_CONTINUITY',
    at: '2026-09-24T02:00:05Z',
  },
  resolver_assessments: {
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
    '1758700005000-0': {
      event_id: '1758700005000-0',
      assessed_at: '2026-09-24T02:00:05Z',
      candidate_id: '23D47AB2',
      verdict: 'CANNOT_DECIDE',
      confidence: 0.4,
      factors: [],
      mode: 'shadow',
      applied: false,
      platform_reason_code: 'MIDDLE_BAND',
      latency_ms: 3100,
      model: 'gpt-5.4',
    },
  },
  review_case: {
    case_id: 'case-1',
    band: 'REVIEW',
    posterior: 0.63,
    flags: ['ADDRESS_ONLY'],
    candidate_ids: ['23D47AB2'],
    recommendation: 'resolver',
    disposition: 'resolver_same_person',
    opened_at: '2026-09-24T02:00:01Z',
  },
}

describe('IdentityResolutionDetail', () => {
  it('renders the link outcome with its reason and the origin id', () => {
    render(
      <IdentityResolutionDetail
        resolution={shapeIdentityResolution({ link: STORED.link })}
        originCustomerId="J1"
      />,
    )
    const link = screen.getByRole('region', { name: 'Link' })
    expect(within(link).getByRole('link', { name: '23D47AB2' })).toHaveAttribute(
      'href',
      '/admin/servicing/23D47AB2',
    )
    expect(link).toHaveTextContent('LOGIN_CONTINUITY')
    expect(link).toHaveTextContent('lnk_1')
    expect(link).toHaveTextContent('arrived as J1')
  })

  it('renders resolver assessments as rows in assessed order with factors behind a disclosure', () => {
    render(<IdentityResolutionDetail resolution={shapeIdentityResolution(STORED)} />)
    const rows = screen.getAllByTestId('resolver-assessment-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('SAME_PERSON')
    expect(rows[0]).toHaveTextContent('0.91')
    expect(rows[0]).toHaveTextContent('shadow')
    expect(rows[0]).toHaveTextContent('No') // applied
    expect(rows[0]).toHaveTextContent('MIDDLE_BAND')
    expect(rows[0]).toHaveTextContent('2140 ms')
    expect(rows[1]).toHaveTextContent('CANNOT_DECIDE')
    expect(rows[1]).toHaveTextContent('none') // no factors

    const toggle = within(rows[0]).getByRole('button', { name: /2 factors/ })
    expect(screen.queryByText('name_exact')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('name_exact')).toBeInTheDocument()
  })

  it('renders the review case', () => {
    render(<IdentityResolutionDetail resolution={shapeIdentityResolution(STORED)} />)
    const review = screen.getByRole('region', { name: 'Recognition review case' })
    expect(review).toHaveTextContent('case-1')
    expect(review).toHaveTextContent('REVIEW')
    expect(review).toHaveTextContent('0.630')
    expect(review).toHaveTextContent('ADDRESS_ONLY')
    expect(review).toHaveTextContent('resolver_same_person')
  })

  it('says so when nothing was recorded, with no empty tables', () => {
    render(<IdentityResolutionDetail resolution={null} />)
    expect(screen.getByTestId('identity-resolution-empty')).toHaveTextContent(
      'No identity resolution recorded.',
    )
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
