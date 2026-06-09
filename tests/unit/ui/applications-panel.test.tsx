// tests/unit/ui/applications-panel.test.tsx
import { describe, test, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Mock the conversations query so no QueryClient / network is needed.
vi.mock('@/hooks/queries/useConversations', () => ({
  useCustomerConversations: () => ({
    data: {
      conversations: [
        {
          conversationId: 'c-same',
          applicationNumber: 'APP-SAME',
          status: 'historical',
          decisionStatus: 'approved',
          updatedAt: '2026-06-01T00:00:00Z',
          application: { loanAmount: 100, purpose: 'pay a bill' },
          customer: { customerId: 'CUST-1' },
        },
        {
          conversationId: 'c-diff',
          applicationNumber: 'APP-DIFF',
          status: 'historical',
          decisionStatus: 'approved',
          updatedAt: '2026-06-02T00:00:00Z',
          application: { loanAmount: 200, purpose: 'pay a bill' },
          customer: { customerId: 'CUST-2' },
        },
      ],
    },
    isLoading: false,
    error: null,
  }),
}))

import { ApplicationsPanel } from '@/components/ServicingView/ApplicationsPanel'

afterEach(() => cleanup())

describe('ApplicationsPanel — loan-account arrow', () => {
  test('hides the → arrow when the application belongs to the customer being viewed', () => {
    render(<ApplicationsPanel customerIdString="CUST-1" />)
    // Self-referential (same customer) → arrow hidden
    expect(screen.queryByLabelText('View loan account for APP-SAME')).not.toBeInTheDocument()
  })

  test('shows the → arrow when the application belongs to a different customer', () => {
    render(<ApplicationsPanel customerIdString="CUST-1" />)
    // Different customer → arrow shown
    expect(screen.getByLabelText('View loan account for APP-DIFF')).toBeInTheDocument()
  })

  test('still renders the application card link to the application detail', () => {
    render(<ApplicationsPanel customerIdString="CUST-1" />)
    expect(screen.getByLabelText('Application APP-SAME')).toBeInTheDocument()
  })
})
