import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { LedgerStatusIndicator } from '@/components/LedgerStatus'

// Mock useAuth — lending-side role by default; individual tests flip it
const mockUseAuth = vi.fn(() => ({ user: { id: 'u-1', role: 'operations' } }))
vi.mock('@payloadcms/ui', () => ({
  useAuth: () => mockUseAuth(),
}))

// Create query client wrapper
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const mockConnectedResponse = {
  status: 'connected',
  latencyMs: 150,
  message: 'Ledger Connected',
  checkedAt: '2025-12-11T10:00:00Z',
}

const mockDegradedResponse = {
  status: 'degraded',
  latencyMs: 2500,
  message: 'Ledger Degraded - some operations may be slow',
  checkedAt: '2025-12-11T10:00:00Z',
}

const mockOfflineResponse = {
  status: 'offline',
  latencyMs: 0,
  message: 'Ledger Offline - read-only mode active',
  checkedAt: '2025-12-11T10:00:00Z',
}

function setupMockFetch(response = mockConnectedResponse) {
  ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(response),
  })
}

describe('LedgerStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Rendering', () => {
    it('should render the status indicator', async () => {
      setupMockFetch()
      render(<LedgerStatusIndicator />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByTestId('ledger-status-indicator')).toBeInTheDocument()
      })
    })

    it('should show loading state initially', () => {
      setupMockFetch()
      render(<LedgerStatusIndicator />, { wrapper: createWrapper() })

      // Initial state shows "Checking..."
      expect(screen.getByText('Checking...')).toBeInTheDocument()
    })
  })

  describe('Lending wall', () => {
    it('does not render or poll for lending-walled roles (marketing)', async () => {
      setupMockFetch()
      mockUseAuth.mockReturnValue({ user: { id: 'u-2', role: 'marketing' } })
      render(<LedgerStatusIndicator />, { wrapper: createWrapper() })

      // Give the mount effect + any (wrong) query a tick to fire.
      await new Promise((r) => setTimeout(r, 50))
      expect(screen.queryByTestId('ledger-status-indicator')).not.toBeInTheDocument()
      expect(global.fetch).not.toHaveBeenCalled()

      mockUseAuth.mockReturnValue({ user: { id: 'u-1', role: 'operations' } })
    })
  })

  describe('Connected State', () => {
    it('should show "Connected" when ledger is healthy', async () => {
      setupMockFetch(mockConnectedResponse)
      render(<LedgerStatusIndicator />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeInTheDocument()
      })
    })

    it('should have data-status="connected"', async () => {
      setupMockFetch(mockConnectedResponse)
      render(<LedgerStatusIndicator />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByTestId('ledger-status-indicator')).toHaveAttribute(
          'data-status',
          'connected'
        )
      })
    })
  })

  describe('Degraded State', () => {
    it('should show "Degraded" when ledger is slow', async () => {
      setupMockFetch(mockDegradedResponse)
      render(<LedgerStatusIndicator />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText('Degraded')).toBeInTheDocument()
      })
    })

    it('should show latency badge when degraded', async () => {
      setupMockFetch(mockDegradedResponse)
      render(<LedgerStatusIndicator />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText('2500ms')).toBeInTheDocument()
      })
    })

    it('should have data-status="degraded"', async () => {
      setupMockFetch(mockDegradedResponse)
      render(<LedgerStatusIndicator />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByTestId('ledger-status-indicator')).toHaveAttribute(
          'data-status',
          'degraded'
        )
      })
    })
  })

  describe('Offline State', () => {
    it('should show "Offline" when ledger is unreachable', async () => {
      setupMockFetch(mockOfflineResponse)
      render(<LedgerStatusIndicator />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText('Offline')).toBeInTheDocument()
      })
    })

    it('should have data-status="offline"', async () => {
      setupMockFetch(mockOfflineResponse)
      render(<LedgerStatusIndicator />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByTestId('ledger-status-indicator')).toHaveAttribute(
          'data-status',
          'offline'
        )
      })
    })
  })

  describe('Refresh Button', () => {
    it('should have a refresh button', async () => {
      setupMockFetch()
      render(<LedgerStatusIndicator />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
      })
    })

    it('should call refetch when clicked', async () => {
      setupMockFetch()
      render(<LedgerStatusIndicator />, { wrapper: createWrapper() })

      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeInTheDocument()
      })

      const refreshButton = screen.getByRole('button', { name: /refresh/i })
      fireEvent.click(refreshButton)

      // Should trigger another fetch
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe('Tooltip', () => {
    it('should have tooltip with detailed message', async () => {
      setupMockFetch(mockConnectedResponse)
      render(<LedgerStatusIndicator />, { wrapper: createWrapper() })

      // Wait for connected state first
      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeInTheDocument()
      })

      // The tooltip is hidden by CSS but present in the DOM
      // Use getByRole with hidden: true to include hidden elements
      expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Ledger Connected')
    })
  })
})
