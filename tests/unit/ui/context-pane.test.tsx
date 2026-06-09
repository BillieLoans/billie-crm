// tests/unit/ui/context-pane.test.tsx
import { describe, test, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('@/components/ServicingView/Communications/CommunicationsPanel', () => ({
  CommunicationsPanel: () => <div data-testid="mock-comms" />,
}))
vi.mock('@/components/ServicingView/ApplicationsPanel', () => ({
  ApplicationsPanel: () => <div data-testid="mock-apps" />,
}))

import { ContextPane } from '@/components/ServicingView/ContextPane'

const props = {
  customerDocId: 'c1', customerBusinessId: 'CUST-1', customerName: 'Jane', selectedAccountId: null,
  accounts: [], onNavigateToAccount: () => {},
}

afterEach(() => cleanup())

describe('ContextPane', () => {
  test('shows Communications by default', () => {
    render(<ContextPane {...props} />)
    expect(screen.getByTestId('mock-comms')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-apps')).not.toBeInTheDocument()
  })

  test('switches to Applications when its tab is clicked', () => {
    render(<ContextPane {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: /applications/i }))
    expect(screen.getByTestId('mock-apps')).toBeInTheDocument()
  })
})
