import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AttributionDetail } from '@/components/ConversationDetailView/AssessmentPanel/AttributionDetail'
import { shapeAttribution } from '@/lib/attribution'

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

  it('says so when the conversation has no ad-click data', () => {
    render(<AttributionDetail attribution={null} />)
    expect(screen.getByText('No ad-click data.')).toBeTruthy()
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
})
