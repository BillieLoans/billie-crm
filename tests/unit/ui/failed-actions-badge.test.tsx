import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'
import { FailedActionsBadge } from '@/components/FailedActions'
import { useFailedActionsStore, FailedAction } from '@/stores/failed-actions'
import { FAILED_ACTIONS_STORAGE_KEY } from '@/lib/constants'
import { installMockLocalStorage } from '../../utils/mock-local-storage'

// Helper to create a test action
function createTestAction(id: string): FailedAction {
  return {
    id,
    type: 'waive-fee',
    accountId: `ACC-${id}`,
    params: {},
    errorMessage: 'Error',
    timestamp: new Date().toISOString(),
    retryCount: 0,
  }
}

// Mock localStorage with proper storage simulation
const createMockLocalStorage = () => {
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
    _setStore: (newStore: Record<string, string>) => {
      store = newStore
    },
  }
}

const mockLocalStorage = createMockLocalStorage()
installMockLocalStorage(mockLocalStorage)

describe('FailedActionsBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocalStorage.clear()
    // Reset store state
    act(() => {
      useFailedActionsStore.setState({ actions: [] })
    })
  })

  afterEach(() => {
    cleanup()
  })

  describe('Visibility', () => {
    it('should not render when there are no failed actions', async () => {
      act(() => {
        useFailedActionsStore.setState({ actions: [] })
      })
      render(<FailedActionsBadge />)

      // Component should not render with empty actions
      expect(screen.queryByTestId('failed-actions-badge')).not.toBeInTheDocument()
    })

    it('should render when there are failed actions', async () => {
      const actions = [createTestAction('1')]
      // Store in localStorage so loadFromStorage finds them
      mockLocalStorage.setItem(FAILED_ACTIONS_STORAGE_KEY, JSON.stringify(actions))

      render(<FailedActionsBadge />)

      // Wait for effect to run
      await waitFor(() => {
        expect(screen.getByTestId('failed-actions-badge')).toBeInTheDocument()
      })
    })
  })

  describe('Count Display', () => {
    it('should show correct count', async () => {
      const actions = [createTestAction('1'), createTestAction('2'), createTestAction('3')]
      mockLocalStorage.setItem(FAILED_ACTIONS_STORAGE_KEY, JSON.stringify(actions))

      render(<FailedActionsBadge />)

      await waitFor(() => {
        expect(screen.getByTestId('failed-actions-count')).toHaveTextContent('3')
      })
    })

    it('should show 99+ when count exceeds 99', async () => {
      const actions = Array.from({ length: 100 }, (_, i) => createTestAction(`${i}`))
      mockLocalStorage.setItem(FAILED_ACTIONS_STORAGE_KEY, JSON.stringify(actions))

      render(<FailedActionsBadge />)

      await waitFor(() => {
        expect(screen.getByTestId('failed-actions-count')).toHaveTextContent('99+')
      })
    })
  })

  describe('Panel Toggle', () => {
    it('should open panel when badge is clicked', async () => {
      const actions = [createTestAction('1')]
      mockLocalStorage.setItem(FAILED_ACTIONS_STORAGE_KEY, JSON.stringify(actions))

      render(<FailedActionsBadge />)

      await waitFor(() => {
        expect(screen.getByTestId('failed-actions-badge')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('failed-actions-badge'))

      expect(screen.getByTestId('failed-actions-panel')).toBeInTheDocument()
    })

    it('should close panel on Escape key', async () => {
      const actions = [createTestAction('1')]
      mockLocalStorage.setItem(FAILED_ACTIONS_STORAGE_KEY, JSON.stringify(actions))

      render(<FailedActionsBadge />)

      await waitFor(() => {
        expect(screen.getByTestId('failed-actions-badge')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('failed-actions-badge'))
      expect(screen.getByTestId('failed-actions-panel')).toBeInTheDocument()

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByTestId('failed-actions-panel')).not.toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should have proper aria-label', async () => {
      const actions = [createTestAction('1')]
      mockLocalStorage.setItem(FAILED_ACTIONS_STORAGE_KEY, JSON.stringify(actions))

      render(<FailedActionsBadge />)

      await waitFor(() => {
        expect(screen.getByTestId('failed-actions-badge')).toBeInTheDocument()
      })

      const badge = screen.getByTestId('failed-actions-badge')
      expect(badge).toHaveAttribute('aria-label', '1 failed action. Click to view.')
    })

    it('should have aria-expanded attribute', async () => {
      const actions = [createTestAction('1')]
      mockLocalStorage.setItem(FAILED_ACTIONS_STORAGE_KEY, JSON.stringify(actions))

      render(<FailedActionsBadge />)

      await waitFor(() => {
        expect(screen.getByTestId('failed-actions-badge')).toBeInTheDocument()
      })

      const badge = screen.getByTestId('failed-actions-badge')
      expect(badge).toHaveAttribute('aria-expanded', 'false')

      fireEvent.click(badge)
      expect(badge).toHaveAttribute('aria-expanded', 'true')
    })
  })
})
