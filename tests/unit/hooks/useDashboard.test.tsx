import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDashboard, dashboardQueryKey } from '@/hooks/queries/useDashboard'
import type { DashboardResponse } from '@/lib/schemas/dashboard'
import React from 'react'

// Mock the stores
vi.mock('@/stores/recentCustomers', () => ({
  useRecentCustomersStore: vi.fn((selector) =>
    selector({
      customers: [
        { customerId: 'CUST-001', viewedAt: Date.now() - 60000 },
        { customerId: 'CUST-002', viewedAt: Date.now() - 120000 },
      ],
    }),
  ),
}))

vi.mock('@/stores/failed-actions', () => ({
  useFailedActionsStore: vi.fn((selector) =>
    selector({
      getActiveCount: () => 1,
    }),
  ),
}))

// Mock response
const mockDashboardResponse: DashboardResponse = {
  user: {
    firstName: 'Test',
    role: 'supervisor',
  },
  actionItems: {
    pendingApprovalsCount: 3,
    failedActionsCount: 0, // Will be overridden by client store
  },
  recentCustomersSummary: [
    {
      customerId: 'CUST-001',
      name: 'John Smith',
      accountCount: 2,
      totalOutstanding: '$1,500.00',
    },
  ],
  recentAccounts: [
    {
      loanAccountId: 'LA-001',
      accountNumber: 'ACC-001',
      customerName: 'John Smith',
      customerId: 'CUST-001',
      loanAmount: 5000,
      loanAmountFormatted: '$5,000.00',
      createdAt: new Date().toISOString(),
    },
  ],
  pendingDisbursements: [],
  pendingDisbursementsCount: 0,
  upcomingPayments: [
    {
      loanAccountId: 'LA-001',
      accountNumber: 'ACC-001',
      customerName: 'John Smith',
      customerId: 'CUST-001',
      dueDate: '2025-12-15',
      amount: 250,
      amountFormatted: '$250.00',
      daysUntilDue: 4,
      status: 'upcoming',
    },
  ],
  systemStatus: {
    ledger: 'online',
    latencyMs: 42,
    lastChecked: new Date().toISOString(),
  },
}

describe('useDashboard', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    queryClient.clear()
  })

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  it('should return loading state initially', async () => {
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: () => Promise.resolve(mockDashboardResponse),
            })
          }, 100)
        }),
    )

    const { result } = renderHook(() => useDashboard(), { wrapper })

    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toBeUndefined()
  })

  it('should fetch dashboard data successfully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDashboardResponse),
    })

    const { result } = renderHook(() => useDashboard(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBeDefined()
    expect(result.current.data?.user.firstName).toBe('Test')
    expect(result.current.data?.actionItems.pendingApprovalsCount).toBe(3)
  })

  it('should merge client-side failedActionsCount', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDashboardResponse),
    })

    const { result } = renderHook(() => useDashboard(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Should override server value (0) with client store value (1)
    expect(result.current.data?.actionItems.failedActionsCount).toBe(1)
  })

  it('should include recent customer IDs in query params', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDashboardResponse),
    })

    renderHook(() => useDashboard(), { wrapper })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })

    const fetchUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(fetchUrl).toContain('recentCustomerIds=CUST-001,CUST-002')
  })

  it('should handle fetch errors gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'Server error' } }),
    })

    const { result } = renderHook(() => useDashboard(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error).toBeDefined()
    expect(result.current.data).toBeUndefined()
  })

  it('should respect enabled option', () => {
    global.fetch = vi.fn()

    renderHook(() => useDashboard({ enabled: false }), { wrapper })

    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('dashboardQueryKey', () => {
  it('should include recent customer IDs', () => {
    const key = dashboardQueryKey(['CUST-001', 'CUST-002'])
    expect(key).toEqual(['dashboard', ['CUST-001', 'CUST-002']])
  })

  it('should work with empty customer IDs', () => {
    const key = dashboardQueryKey([])
    expect(key).toEqual(['dashboard', []])
  })
})
