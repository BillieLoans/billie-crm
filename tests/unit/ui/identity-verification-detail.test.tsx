/**
 * IdentityVerificationDetail — structured rendering of the LAB verification
 * block carried on identityRisk_assessment (v1 envelope, legacy block, or
 * no block at all).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import React from 'react'
import { IdentityVerificationDetail } from '@/components/ConversationDetailView/AssessmentPanel/IdentityVerificationDetail'

const passSample = () => ({
  decision: 'APPROVED',
  application_number: 'APP-1',
  customer_id: 'C1',
  pepResult: 'no_match',
  sanctionsResult: 'no_match',
  lab_verification: {
    id: '9c63b029-d3a9-4d0c-90d8-fdcca3aad5de',
    verificationNumber: 'V60000296',
    reference: 'APP-1',
    status: 'completed',
    createdAt: '2026-09-11T05:13:09Z',
    updatedAt: '2026-09-11T05:13:09Z',
    result: {
      outcome: 'pass',
      checks: [
        {
          checkType: 'identity',
          outcome: 'pass',
          providers: [
            {
              provider: 'IDMatrix',
              outcome: 'pass',
              detail: {
                sources: [
                  {
                    name: 'Australian Electoral Roll',
                    type: 'data',
                    dataSource: 'aec',
                    isDvs: false,
                    result: 'match',
                    attributes: {
                      name: 'match',
                      address: 'match',
                      dateOfBirth: 'match',
                      documentIdentifier: 'no_match',
                    },
                  },
                  {
                    name: 'NSW Driver Licence',
                    type: 'document',
                    dataSource: 'nsw_driver_licence',
                    documentType: 'drivers_licence',
                    issuingRegion: 'NSW',
                    isDvs: true,
                    result: 'undisclosed',
                    attributes: {
                      name: 'undisclosed',
                      address: 'undisclosed',
                      dateOfBirth: 'undisclosed',
                      documentIdentifier: 'undisclosed',
                    },
                  },
                ],
              },
            },
          ],
          links: { report: '/verifications/v1/individuals/9c63b029/report?check=identity' },
        },
        {
          checkType: 'screening',
          outcome: 'pass',
          providers: [
            {
              provider: 'IDMatrix',
              outcome: 'pass',
              detail: {
                pep: {
                  result: 'no_match',
                  sources: [{ name: 'GlobalScreening - PEPs (Domestic)', result: 'no_match' }],
                },
                sanctions: {
                  result: 'no_match',
                  sources: [
                    { name: 'GlobalScreening - Sanctions (International)', result: 'no_match' },
                  ],
                },
              },
            },
          ],
          links: { report: '/verifications/v1/individuals/9c63b029/report?check=screening' },
        },
      ],
    },
    provider: [{ name: 'IDMatrix', reference: '260212-E3106-FD08B' }],
    links: {},
  },
})

const hitSample = () => {
  const sample = passSample()
  sample.decision = 'DECLINED'
  sample.sanctionsResult = 'match'
  const lab = sample.lab_verification
  lab.result.outcome = 'refer'
  lab.result.checks[1] = {
    checkType: 'screening',
    outcome: 'refer',
    reasons: [
      {
        code: 'SCREENING_HIT',
        message: 'Potential sanctions match detected; manual review required.',
        provider: 'IDMatrix',
        suggestedAction: 'Review the matched screening entries and confirm or dismiss.',
      },
    ],
    providers: [
      {
        provider: 'IDMatrix',
        outcome: 'refer',
        detail: {
          pep: { result: 'no_match', sources: [{ name: 'PEPs (Domestic)', result: 'no_match' }] },
          sanctions: {
            result: 'match',
            sources: [
              { name: 'Sanctions (International)', result: 'match' },
              { name: 'Sanctions (Domestic)', result: 'inconclusive' },
            ],
            matches: [
              {
                matchedOn: 'name',
                matchedTerm: 'SMITH JOHN',
                listings: [
                  {
                    name: 'SMITH, JOHN ALEXANDER',
                    title: 'FORMER MINISTER OF FINANCE',
                    source: 'DFAT',
                    listedDate: '2022-02-28',
                    lastUpdated: '2025-11-07',
                    reference: '6402066',
                    version: '20251107161754',
                    attributes: { otherInformation: 'Targeted Financial Sanction: Y' },
                  },
                ],
              },
            ],
          },
        },
      },
    ],
    links: { report: '/verifications/v1/individuals/9c63b029/report?check=screening' },
  } as (typeof lab.result.checks)[number]
  return sample
}

describe('IdentityVerificationDetail — LAB API v1 block', () => {
  afterEach(cleanup)

  it('renders the decision banner, meta and per-check cards for a pass', () => {
    render(<IdentityVerificationDetail identity={passSample()} customerId="C1" />)

    const banner = screen.getByTestId('identity-decision')
    expect(banner).toHaveTextContent('APPROVED')
    expect(banner).toHaveTextContent('LAB outcome: pass')
    expect(screen.getByText('V60000296')).toBeInTheDocument()
    expect(screen.getByText(/IDMatrix · 260212-E3106-FD08B/)).toBeInTheDocument()

    const identity = screen.getByTestId('identity-check-identity')
    expect(within(identity).getByText('Identity')).toBeInTheDocument()
    expect(within(identity).getByText('pass')).toBeInTheDocument()
    const sources = within(identity).getByTestId('identity-sources')
    expect(within(sources).getByText('Australian Electoral Roll')).toBeInTheDocument()
    expect(within(sources).getByText('NSW Driver Licence')).toBeInTheDocument()
    expect(within(sources).getByText(/drivers licence · NSW/)).toBeInTheDocument()
    expect(within(sources).getAllByText('match').length).toBeGreaterThanOrEqual(4)

    const screening = screen.getByTestId('identity-check-screening')
    expect(within(screening).getByTestId('screening-pep')).toHaveTextContent('no match')
    expect(within(screening).getByTestId('screening-sanctions')).toHaveTextContent(
      'GlobalScreening - Sanctions (International)',
    )
  })

  it('explains DVS undisclosed results with a tooltip', () => {
    render(<IdentityVerificationDetail identity={passSample()} customerId="C1" />)
    const chips = screen.getAllByText('undisclosed')
    expect(chips.length).toBeGreaterThan(0)
    expect(chips[0]).toHaveAttribute('title', expect.stringMatching(/DVS/))
  })

  it('renders reasons and matched listings on a screening hit', () => {
    render(<IdentityVerificationDetail identity={hitSample()} customerId="C1" />)

    expect(screen.getByTestId('identity-decision')).toHaveTextContent('DECLINED')
    const screening = screen.getByTestId('identity-check-screening')
    expect(within(screening).getByText('refer')).toBeInTheDocument()
    const reasons = within(screening).getByTestId('identity-reasons')
    expect(reasons).toHaveTextContent('SCREENING_HIT')
    expect(reasons).toHaveTextContent('Review the matched screening entries and confirm or dismiss.')

    const sanctions = within(screening).getByTestId('screening-sanctions')
    expect(sanctions).toHaveTextContent('SMITH JOHN')
    expect(sanctions).toHaveTextContent('SMITH, JOHN ALEXANDER')
    expect(sanctions).toHaveTextContent('FORMER MINISTER OF FINANCE')
    expect(sanctions).toHaveTextContent('DFAT')
    expect(sanctions).toHaveTextContent('6402066 / 20251107161754')
    expect(sanctions).toHaveTextContent('otherInformation')
    expect(sanctions).toHaveTextContent('inconclusive')
  })

  it('links per-check reports and the raw response when archived', () => {
    render(
      <IdentityVerificationDetail
        identity={passSample()}
        customerId="C1"
        report={{
          reportAvailable: true,
          screeningReportAvailable: true,
          rawResponseAvailable: true,
        }}
      />,
    )
    expect(screen.getByTestId('identity-check-identity-report')).toHaveAttribute(
      'href',
      '/api/customer/C1/identity-report?artifact=report',
    )
    expect(screen.getByTestId('identity-check-screening-report')).toHaveAttribute(
      'href',
      '/api/customer/C1/identity-report?artifact=screening',
    )
    expect(screen.getByTestId('identity-raw-download')).toHaveAttribute(
      'href',
      '/api/customer/C1/identity-report?artifact=raw&disposition=attachment',
    )
  })

  it('hides report links when nothing is archived', () => {
    render(
      <IdentityVerificationDetail
        identity={passSample()}
        customerId="C1"
        report={{ reportAvailable: false, screeningReportAvailable: false }}
      />,
    )
    expect(screen.queryByTestId('identity-check-identity-report')).not.toBeInTheDocument()
    expect(screen.queryByTestId('identity-check-screening-report')).not.toBeInTheDocument()
    expect(screen.queryByTestId('identity-raw-download')).not.toBeInTheDocument()
  })

  it('renders result-level processing reasons', () => {
    const sample = passSample()
    sample.decision = 'DECLINED'
    sample.lab_verification.status = 'failed'
    sample.lab_verification.result = {
      outcome: 'fail',
      checks: [],
      reasons: [{ code: 'SERVICE_PARTIAL_FAILURE', message: 'Processing failed.', retryable: true }],
    } as unknown as ReturnType<typeof passSample>['lab_verification']['result']
    render(<IdentityVerificationDetail identity={sample} customerId="C1" />)
    expect(screen.getByText('Processing')).toBeInTheDocument()
    expect(screen.getByTestId('identity-reasons')).toHaveTextContent('SERVICE_PARTIAL_FAILURE')
    expect(screen.getByTestId('identity-reasons')).toHaveTextContent('retryable')
  })

  it('keeps the raw JSON collapsed by default', () => {
    render(<IdentityVerificationDetail identity={passSample()} customerId="C1" />)
    const toggle = screen.getByRole('button', { name: /Raw JSON data/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/"verificationNumber"/)).not.toBeInTheDocument()
  })
})

describe('IdentityVerificationDetail — legacy and no-block assessments', () => {
  afterEach(cleanup)

  it('renders a legacy EVS block as key-value rows', () => {
    render(
      <IdentityVerificationDetail
        identity={{
          decision: 'APPROVED',
          lab_verification: {
            requestId: '468881',
            provider: 'IDMatrix',
            providerReference: '260610-52BC8-A4A67',
            overallResult: 'Passed',
            pepResult: 'no-match',
            sanctionsResult: 'no-match',
          },
        }}
        customerId="C1"
        report={{ reportAvailable: true }}
      />,
    )
    const legacy = screen.getByTestId('identity-legacy')
    expect(legacy).toHaveTextContent('Request ID')
    expect(legacy).toHaveTextContent('468881')
    expect(legacy).toHaveTextContent('Passed')
    expect(screen.getByTestId('identity-check-identity-report')).toHaveAttribute(
      'href',
      '/api/customer/C1/identity-report?artifact=report',
    )
  })

  it('renders a manual verification without a LAB block', () => {
    render(
      <IdentityVerificationDetail
        identity={{
          decision: 'APPROVED',
          manual_verification: true,
          manual_verification_basis: 'Documents sighted in branch',
          manual_verification_reviewed_by: 'ops@billie',
        }}
      />,
    )
    expect(screen.getByTestId('identity-decision')).toHaveTextContent('Manual verification')
    expect(screen.getByTestId('identity-no-block')).toHaveTextContent('Documents sighted in branch')
    expect(screen.getByTestId('identity-no-block')).toHaveTextContent('ops@billie')
  })

  it('renders a bare assessment (mock mode / historical) with its screening results', () => {
    render(
      <IdentityVerificationDetail
        identity={{ decision: 'DECLINED', pepResult: 'match', sanctionsResult: 'no-match' }}
      />,
    )
    expect(screen.getByTestId('identity-decision')).toHaveTextContent('DECLINED')
    const block = screen.getByTestId('identity-no-block')
    expect(block).toHaveTextContent('PEP')
    expect(within(block).getByText('match')).toBeInTheDocument()
  })
})
