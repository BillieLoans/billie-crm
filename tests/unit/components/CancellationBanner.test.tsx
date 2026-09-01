import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: null }) }))

import { CancellationBanner } from '@/components/ConversationDetailView/CancellationBanner'

const RECORD = {
  reason: 'final_offer_declined',
  category: 'customer_declined',
  cancelled_at: '2026-08-28T01:37:30.993832+00:00',
  source_event: 'customer_cancelled',
  application_number: 'C6F7C8E6-77F',
}

describe('CancellationBanner', () => {
  it('summarises a customer decline in one line', () => {
    render(<CancellationBanner cancellationRecord={RECORD} />)
    const banner = screen.getByTestId('cancellation-banner')
    expect(banner).toHaveTextContent('Declined by customer')
    expect(banner).toHaveTextContent('Final offer declined')
  })

  it('summarises a system expiry differently', () => {
    render(
      <CancellationBanner
        cancellationRecord={{ ...RECORD, category: 'system_expired', reason: 'session_timeout' }}
      />,
    )
    expect(screen.getByTestId('cancellation-banner')).toHaveTextContent('Offer expired')
  })

  it('labels a customer-requested cancellation taken by an operator', () => {
    render(
      <CancellationBanner
        cancellationRecord={{
          ...RECORD,
          reason: 'customer_request',
          source_event: 'conversation.killed.v1',
        }}
      />,
    )
    expect(screen.getByTestId('cancellation-banner')).toHaveTextContent(
      'Customer requested cancellation',
    )
  })

  it('falls back to the raw reason for an unmapped value', () => {
    render(<CancellationBanner cancellationRecord={{ ...RECORD, reason: 'brand_new' }} />)
    expect(screen.getByTestId('cancellation-banner')).toHaveTextContent('brand_new')
  })

  it('opens a drawer with outcome, reason, application, and timestamp', () => {
    render(<CancellationBanner cancellationRecord={RECORD} />)
    fireEvent.click(screen.getByTestId('cancellation-banner'))
    const drawer = screen.getByTestId('context-drawer')
    expect(drawer).toHaveTextContent('Declined by customer')
    expect(drawer).toHaveTextContent('Final offer declined')
    expect(drawer).toHaveTextContent('C6F7C8E6-77F')
  })

  it('renders nothing without a record', () => {
    render(<CancellationBanner cancellationRecord={null} />)
    expect(screen.queryByTestId('cancellation-banner')).not.toBeInTheDocument()
  })
})
