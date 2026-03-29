import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTrackCustomerView } from '@/hooks/useTrackCustomerView'
import { useRecentCustomersStore } from '@/stores/recentCustomers'

// Mock the store
vi.mock('@/stores/recentCustomers', () => ({
  useRecentCustomersStore: vi.fn(),
}))

describe('useTrackCustomerView', () => {
  const mockAddCustomer = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useRecentCustomersStore).mockImplementation((selector) => {
      if (typeof selector === 'function') {
        return selector({ addCustomer: mockAddCustomer, customers: [], clearHistory: vi.fn() })
      }
      return mockAddCustomer
    })
  })

  it('calls addCustomer when customerId is provided', () => {
    renderHook(() => useTrackCustomerView('CUST-001'))

    expect(mockAddCustomer).toHaveBeenCalledTimes(1)
    expect(mockAddCustomer).toHaveBeenCalledWith('CUST-001')
  })

  it('does not call addCustomer when customerId is undefined', () => {
    renderHook(() => useTrackCustomerView(undefined))

    expect(mockAddCustomer).not.toHaveBeenCalled()
  })

  it('does not call addCustomer when customerId is empty string', () => {
    renderHook(() => useTrackCustomerView(''))

    expect(mockAddCustomer).not.toHaveBeenCalled()
  })

  it('calls addCustomer again when customerId changes', () => {
    const { rerender } = renderHook(
      ({ customerId }) => useTrackCustomerView(customerId),
      { initialProps: { customerId: 'CUST-001' } },
    )

    expect(mockAddCustomer).toHaveBeenCalledWith('CUST-001')

    rerender({ customerId: 'CUST-002' })

    expect(mockAddCustomer).toHaveBeenCalledTimes(2)
    expect(mockAddCustomer).toHaveBeenLastCalledWith('CUST-002')
  })

  it('does not call addCustomer again when customerId stays the same', () => {
    const { rerender } = renderHook(
      ({ customerId }) => useTrackCustomerView(customerId),
      { initialProps: { customerId: 'CUST-001' } },
    )

    expect(mockAddCustomer).toHaveBeenCalledTimes(1)

    rerender({ customerId: 'CUST-001' })

    // Should still only be called once
    expect(mockAddCustomer).toHaveBeenCalledTimes(1)
  })
})
