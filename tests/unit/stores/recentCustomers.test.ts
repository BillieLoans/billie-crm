import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'

// Mock localStorage before importing the store
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Import store after mocking localStorage
import { useRecentCustomersStore } from '@/stores/recentCustomers'

describe('useRecentCustomersStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    act(() => {
      useRecentCustomersStore.setState({ customers: [] })
    })
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  describe('addCustomer', () => {
    it('adds a new customer to the list', () => {
      const { addCustomer } = useRecentCustomersStore.getState()

      act(() => {
        addCustomer('CUST-001')
      })

      const { customers } = useRecentCustomersStore.getState()
      expect(customers).toHaveLength(1)
      expect(customers[0].customerId).toBe('CUST-001')
      expect(typeof customers[0].viewedAt).toBe('number')
    })

    it('moves existing customer to top with updated timestamp', () => {
      const { addCustomer } = useRecentCustomersStore.getState()

      act(() => {
        addCustomer('CUST-001')
        addCustomer('CUST-002')
        addCustomer('CUST-003')
      })

      // CUST-001 should be at index 2 (oldest)
      let customers = useRecentCustomersStore.getState().customers
      expect(customers[2].customerId).toBe('CUST-001')

      // View CUST-001 again - should move to top
      act(() => {
        addCustomer('CUST-001')
      })

      customers = useRecentCustomersStore.getState().customers
      expect(customers).toHaveLength(3)
      expect(customers[0].customerId).toBe('CUST-001') // Now most recent
      expect(customers[1].customerId).toBe('CUST-003')
      expect(customers[2].customerId).toBe('CUST-002')
    })

    it('limits to 10 customers (FIFO)', () => {
      const { addCustomer } = useRecentCustomersStore.getState()

      act(() => {
        for (let i = 1; i <= 15; i++) {
          addCustomer(`CUST-${String(i).padStart(3, '0')}`)
        }
      })

      const { customers } = useRecentCustomersStore.getState()
      expect(customers).toHaveLength(10)
      expect(customers[0].customerId).toBe('CUST-015') // Most recent
      expect(customers[9].customerId).toBe('CUST-006') // Oldest remaining
    })

    it('deduplicates when same customer viewed multiple times', () => {
      const { addCustomer } = useRecentCustomersStore.getState()

      act(() => {
        addCustomer('CUST-001')
        addCustomer('CUST-002')
        addCustomer('CUST-001') // Duplicate
        addCustomer('CUST-003')
        addCustomer('CUST-001') // Duplicate again
      })

      const { customers } = useRecentCustomersStore.getState()
      expect(customers).toHaveLength(3)
      // CUST-001 should be at top (most recent)
      expect(customers[0].customerId).toBe('CUST-001')
      expect(customers[1].customerId).toBe('CUST-003')
      expect(customers[2].customerId).toBe('CUST-002')
    })
  })

  describe('clearHistory', () => {
    it('removes all customers from the list', () => {
      const { addCustomer, clearHistory } = useRecentCustomersStore.getState()

      act(() => {
        addCustomer('CUST-001')
        addCustomer('CUST-002')
        addCustomer('CUST-003')
      })

      expect(useRecentCustomersStore.getState().customers).toHaveLength(3)

      act(() => {
        clearHistory()
      })

      expect(useRecentCustomersStore.getState().customers).toHaveLength(0)
    })
  })

  describe('security - no PII storage', () => {
    it('only stores customerId and viewedAt (no PII)', () => {
      const { addCustomer } = useRecentCustomersStore.getState()

      act(() => {
        addCustomer('CUST-001')
      })

      const { customers } = useRecentCustomersStore.getState()
      const storedKeys = Object.keys(customers[0])

      // Should ONLY have these two keys - no name, email, etc.
      expect(storedKeys).toHaveLength(2)
      expect(storedKeys).toContain('customerId')
      expect(storedKeys).toContain('viewedAt')
    })
  })

  describe('localStorage persistence', () => {
    it('store is configured with correct persist options', () => {
      // Verify the store has persist middleware configured
      // We can check that the store exists and has the expected structure
      const state = useRecentCustomersStore.getState()

      // Store should have expected methods
      expect(typeof state.addCustomer).toBe('function')
      expect(typeof state.clearHistory).toBe('function')
      expect(Array.isArray(state.customers)).toBe(true)

      // Zustand persist adds persist method to store
      const persistOptions = useRecentCustomersStore.persist
      expect(persistOptions).toBeDefined()
      expect(persistOptions.getOptions().name).toBe('billie-recent-customers')
    })

    it('persists only non-PII data structure (security validation)', () => {
      const { addCustomer } = useRecentCustomersStore.getState()

      act(() => {
        addCustomer('CUST-SEC-001')
        addCustomer('CUST-SEC-002')
      })

      // Get the persisted state structure
      const persistOptions = useRecentCustomersStore.persist
      const storageName = persistOptions.getOptions().name

      // Simulate what would be persisted by getting current state
      const state = useRecentCustomersStore.getState()

      // Verify structure: only customerId and viewedAt, no PII fields
      expect(state.customers).toHaveLength(2)
      state.customers.forEach((c) => {
        const keys = Object.keys(c)
        expect(keys).toEqual(['customerId', 'viewedAt'])
        expect(typeof c.customerId).toBe('string')
        expect(typeof c.viewedAt).toBe('number')
        // Verify no PII fields exist (type assertion for testing)
        const anyC = c as unknown as Record<string, unknown>
        expect(anyC.name).toBeUndefined()
        expect(anyC.email).toBeUndefined()
        expect(anyC.phone).toBeUndefined()
        expect(anyC.balance).toBeUndefined()
      })

      // Verify localStorage key is correct
      expect(storageName).toBe('billie-recent-customers')
    })
  })
})
