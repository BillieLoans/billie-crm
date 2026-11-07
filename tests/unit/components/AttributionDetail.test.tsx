import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AttributionDetail } from '@/components/ConversationDetailView/AssessmentPanel/AttributionDetail'
import { shapeAttribution } from '@/lib/attribution'
import { formatDateMedium } from '@/lib/formatters'

describe('AttributionDetail', () => {
  it('shows the click id, campaign, keyword and match type', () => {
    const attribution = shapeAttribution({
      gclid: 'Cj0KCQjw-abc_123',
      utm_source: 'google',
      utm_campaign: 'borrow-200',
      utm_term: 'pay advance',
      matchtype: 'p',
      captured_at: '2026-10-12T01:02:03.000Z',
    })
    render(<AttributionDetail attribution={attribution} />)

    expect(screen.getByText('Cj0KCQjw-abc_123')).toBeTruthy()
    expect(screen.getByText('borrow-200')).toBeTruthy()
    expect(screen.getByText('pay advance')).toBeTruthy()
    expect(screen.getByText('p')).toBeTruthy()
    expect(screen.getByText('2026-10-12T01:02:03.000Z')).toBeTruthy()
  })

  it('omits rows that have no value', () => {
    render(<AttributionDetail attribution={shapeAttribution({ gclid: 'abc' })} />)
    expect(screen.queryByText('Keyword')).toBeNull()
  })

  it('says so when the conversation has no attribution', () => {
    render(<AttributionDetail attribution={null} />)
    expect(screen.getByText('No source recorded: direct or untracked traffic.')).toBeTruthy()
  })

  it('shows an inferred source and medium without click rows', () => {
    render(
      <AttributionDetail
        attribution={shapeAttribution({ utm_source: 'chatgpt', utm_medium: 'llm' })}
      />,
    )
    expect(screen.getByText('chatgpt')).toBeTruthy()
    expect(screen.getByText('llm')).toBeTruthy()
    expect(screen.queryByText('Campaign')).toBeNull()
    expect(screen.queryByText(/Click ID/)).toBeNull()
  })

  it('renders a hostile value as text, not markup', () => {
    const { container } = render(
      <AttributionDetail
        attribution={{ ...shapeAttribution({ gclid: 'abc' })!, utmTerm: '<img src=x>' }}
      />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x>')).toBeTruthy()
  })

  describe('Sent to Google Ads (BTB-546)', () => {
    const base = {
      statusReason: null,
      lastErrorCode: null,
      notBefore: null,
      sentAt: null,
      validatedAt: null,
    }

    it('says nothing was sent for an ad click with no conversions', () => {
      render(<AttributionDetail attribution={shapeAttribution({ gclid: 'abc' })} />)
      expect(screen.getByText('Sent to Google Ads')).toBeTruthy()
      expect(screen.getByText('Nothing sent')).toBeTruthy()
    })

    it('has no Google Ads row for traffic without a click id', () => {
      render(
        <AttributionDetail
          attribution={shapeAttribution({ utm_source: 'google', utm_medium: 'organic' })}
        />,
      )
      expect(screen.queryByText('Sent to Google Ads')).toBeNull()
    })

    it('lists each conversion with its status', () => {
      render(
        <AttributionDetail
          attribution={shapeAttribution({ gclid: 'abc' })}
          googleAdsConversions={[
            {
              ...base,
              conversionName: 'approved',
              action: 'upload',
              status: 'sent',
              sentAt: '2026-11-07T03:02:00.000Z',
            },
            {
              ...base,
              conversionName: 'funded',
              action: 'upload',
              status: 'failed',
              lastErrorCode: 'GCLID_NOT_FOUND',
            },
            {
              ...base,
              conversionName: 'approved',
              action: 'retract',
              status: 'cancelled',
              statusReason: 'DECISION_RESTORED',
            },
          ]}
        />,
      )
      // Formatted in the runner's time zone, so the expectation is too.
      expect(
        screen.getByText(`Approved: sent ${formatDateMedium('2026-11-07T03:02:00.000Z')}`),
      ).toBeTruthy()
      expect(screen.getByText('Funded: not accepted (GCLID_NOT_FOUND)')).toBeTruthy()
      expect(screen.getByText('Approved (retraction): not sent, approved again')).toBeTruthy()
    })
  })
})
