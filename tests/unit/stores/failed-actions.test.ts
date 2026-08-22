import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { useFailedActionsStore } from '@/stores/failed-actions'
import {
  FAILED_ACTIONS_STORAGE_KEY,
  FAILED_ACTIONS_TTL_MS,
  MAX_FAILED_ACTIONS,
} from '@/lib/constants'

import { installMockLocalStorage } from '../../utils/mock-local-storage'

// Mock localStorage
const mockLocalStorage = (() => {
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
  }
})()

installMockLocalStorage(mockLocalStorage)

describe('useFailedActionsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocalStorage.clear()
    // Reset store state
    useFailedActionsStore.setState({ actions: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('addFailedAction', () => {
    it('should add a failed action to the store', () => {
      const store = useFailedActionsStore.getState()

      const id = store.addFailedAction(
        'waive-fee',
        'ACC-123',
        { amount: 10 },
        'Network error',
        'LOAN-123'
      )

      expect(id).toBeDefined()
      expect(typeof id).toBe('string')

      const actions = useFailedActionsStore.getState().actions
      expect(actions).toHaveLength(1)
      expect(actions[0]).toMatchObject({
        type: 'waive-fee',
        accountId: 'ACC-123',
        accountLabel: 'LOAN-123',
        params: { amount: 10 },
        errorMessage: 'Network error',
        retryCount: 0,
      })
    })

    it('should persist to localStorage', () => {
      const store = useFailedActionsStore.getState()

      store.addFailedAction('waive-fee', 'ACC-123', { amount: 10 }, 'Network error')

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        FAILED_ACTIONS_STORAGE_KEY,
        expect.any(String)
      )
    })

    it('should limit actions to MAX_FAILED_ACTIONS', () => {
      const store = useFailedActionsStore.getState()

      // Add more than max
      for (let i = 0; i < MAX_FAILED_ACTIONS + 10; i++) {
        store.addFailedAction('waive-fee', `ACC-${i}`, { amount: i }, `Error ${i}`)
      }

      const actions = useFailedActionsStore.getState().actions
      expect(actions.length).toBeLessThanOrEqual(MAX_FAILED_ACTIONS)
    })

    it('should prevent duplicate actions with same type and accountId', () => {
      const store = useFailedActionsStore.getState()

      // Add first action
      const id1 = store.addFailedAction('waive-fee', 'ACC-123', { amount: 10 }, 'Error 1')
      expect(useFailedActionsStore.getState().actions).toHaveLength(1)

      // Add duplicate (same type + accountId)
      const id2 = store.addFailedAction('waive-fee', 'ACC-123', { amount: 20 }, 'Error 2')
      
      // Should still have only 1 action
      const actions = useFailedActionsStore.getState().actions
      expect(actions).toHaveLength(1)
      
      // Should return the existing ID
      expect(id2).toBe(id1)
      
      // Should update the error message and timestamp
      expect(actions[0].errorMessage).toBe('Error 2')
    })

    it('should allow different action types for same account', () => {
      const store = useFailedActionsStore.getState()

      store.addFailedAction('waive-fee', 'ACC-123', {}, 'Error 1')
      store.addFailedAction('record-repayment', 'ACC-123', {}, 'Error 2')

      expect(useFailedActionsStore.getState().actions).toHaveLength(2)
    })

    it('should allow same action type for different accounts', () => {
      const store = useFailedActionsStore.getState()

      store.addFailedAction('waive-fee', 'ACC-123', {}, 'Error 1')
      store.addFailedAction('waive-fee', 'ACC-456', {}, 'Error 2')

      expect(useFailedActionsStore.getState().actions).toHaveLength(2)
    })
  })

  describe('removeAction', () => {
    it('should remove a specific action', () => {
      const store = useFailedActionsStore.getState()

      const id = store.addFailedAction('waive-fee', 'ACC-123', { amount: 10 }, 'Error')
      expect(useFailedActionsStore.getState().actions).toHaveLength(1)

      store.removeAction(id)
      expect(useFailedActionsStore.getState().actions).toHaveLength(0)
    })

    it('should persist removal to localStorage', () => {
      const store = useFailedActionsStore.getState()

      const id = store.addFailedAction('waive-fee', 'ACC-123', { amount: 10 }, 'Error')
      vi.clearAllMocks()

      store.removeAction(id)

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        FAILED_ACTIONS_STORAGE_KEY,
        '[]'
      )
    })
  })

  describe('incrementRetryCount', () => {
    it('should increment retry count for an action', () => {
      const store = useFailedActionsStore.getState()

      const id = store.addFailedAction('waive-fee', 'ACC-123', { amount: 10 }, 'Error')
      expect(useFailedActionsStore.getState().actions[0].retryCount).toBe(0)

      store.incrementRetryCount(id)
      expect(useFailedActionsStore.getState().actions[0].retryCount).toBe(1)

      store.incrementRetryCount(id)
      expect(useFailedActionsStore.getState().actions[0].retryCount).toBe(2)
    })
  })

  describe('clearAll', () => {
    it('should remove all actions', () => {
      const store = useFailedActionsStore.getState()

      store.addFailedAction('waive-fee', 'ACC-1', {}, 'Error 1')
      store.addFailedAction('record-repayment', 'ACC-2', {}, 'Error 2')
      expect(useFailedActionsStore.getState().actions).toHaveLength(2)

      store.clearAll()
      expect(useFailedActionsStore.getState().actions).toHaveLength(0)
    })
  })

  describe('getActiveCount', () => {
    it('should return count of non-expired actions', () => {
      const store = useFailedActionsStore.getState()

      store.addFailedAction('waive-fee', 'ACC-1', {}, 'Error 1')
      store.addFailedAction('record-repayment', 'ACC-2', {}, 'Error 2')

      expect(store.getActiveCount()).toBe(2)
    })
  })

  describe('loadFromStorage', () => {
    it('should load actions from localStorage', () => {
      const storedActions = [
        {
          id: 'test-1',
          type: 'waive-fee',
          accountId: 'ACC-123',
          params: { amount: 10 },
          errorMessage: 'Error',
          timestamp: new Date().toISOString(),
          retryCount: 0,
        },
      ]

      mockLocalStorage.getItem.mockReturnValueOnce(JSON.stringify(storedActions))

      const store = useFailedActionsStore.getState()
      store.loadFromStorage()

      const actions = useFailedActionsStore.getState().actions
      expect(actions).toHaveLength(1)
      expect(actions[0].id).toBe('test-1')
    })

    it('should filter expired actions on load', () => {
      const expiredDate = new Date(Date.now() - FAILED_ACTIONS_TTL_MS - 1000).toISOString()
      const validDate = new Date().toISOString()

      const storedActions = [
        {
          id: 'expired',
          type: 'waive-fee',
          accountId: 'ACC-1',
          params: {},
          errorMessage: 'Error',
          timestamp: expiredDate,
          retryCount: 0,
        },
        {
          id: 'valid',
          type: 'waive-fee',
          accountId: 'ACC-2',
          params: {},
          errorMessage: 'Error',
          timestamp: validDate,
          retryCount: 0,
        },
      ]

      mockLocalStorage.getItem.mockReturnValueOnce(JSON.stringify(storedActions))

      const store = useFailedActionsStore.getState()
      store.loadFromStorage()

      const actions = useFailedActionsStore.getState().actions
      expect(actions).toHaveLength(1)
      expect(actions[0].id).toBe('valid')
    })

    it('should handle empty localStorage gracefully', () => {
      mockLocalStorage.getItem.mockReturnValueOnce(null)

      const store = useFailedActionsStore.getState()
      store.loadFromStorage()

      expect(useFailedActionsStore.getState().actions).toHaveLength(0)
    })

    it('should handle invalid JSON gracefully', () => {
      mockLocalStorage.getItem.mockReturnValueOnce('invalid json')

      const store = useFailedActionsStore.getState()
      store.loadFromStorage()

      expect(useFailedActionsStore.getState().actions).toHaveLength(0)
    })
  })

  describe('Action Types', () => {
    it('should support waive-fee type', () => {
      const store = useFailedActionsStore.getState()
      store.addFailedAction('waive-fee', 'ACC-123', {}, 'Error')

      expect(useFailedActionsStore.getState().actions[0].type).toBe('waive-fee')
    })

    it('should support record-repayment type', () => {
      const store = useFailedActionsStore.getState()
      store.addFailedAction('record-repayment', 'ACC-123', {}, 'Error')

      expect(useFailedActionsStore.getState().actions[0].type).toBe('record-repayment')
    })

    it('should support write-off-request type', () => {
      const store = useFailedActionsStore.getState()
      store.addFailedAction('write-off-request', 'ACC-123', {}, 'Error')

      expect(useFailedActionsStore.getState().actions[0].type).toBe('write-off-request')
    })
  })
})
