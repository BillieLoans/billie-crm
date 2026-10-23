/**
 * Unit tests for UserSessionGuard component.
 *
 * Tests the security feature that clears user-specific localStorage data
 * when a different user logs in on the same browser.
 *
 * Security Story: Cross-User Data Leakage Prevention
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'

// Constants to match the component
const SESSION_USER_STORAGE_KEY = 'billie-session-user'
const RECENT_CUSTOMERS_STORAGE_KEY = 'billie-recent-customers'
const FAILED_ACTIONS_STORAGE_KEY = 'billie-failed-actions'
const RECENT_REPORTS_STORAGE_KEY = 'billie-recent-reports'
const ASK_DRAFT_STORAGE_KEY = 'billie-ask-draft'

// Mock the stores
const mockClearHistory = vi.fn()
const mockClearRecentReports = vi.fn()
const mockClearAll = vi.fn()
const mockClearAllVersions = vi.fn()

vi.mock('@/stores/recentCustomers', () => ({
  useRecentCustomersStore: {
    getState: () => ({ clearHistory: mockClearHistory }),
  },
}))

vi.mock('@/stores/recentReports', () => ({
  useRecentReportsStore: {
    getState: () => ({ clearHistory: mockClearRecentReports }),
  },
}))

vi.mock('@/stores/failed-actions', () => ({
  useFailedActionsStore: {
    getState: () => ({ clearAll: mockClearAll }),
  },
}))

vi.mock('@/stores/version', () => ({
  useVersionStore: {
    getState: () => ({ clearAllVersions: mockClearAllVersions }),
  },
}))

// Mock useAuth from Payload
const mockUseAuth = vi.fn()
vi.mock('@payloadcms/ui', () => ({
  useAuth: () => mockUseAuth(),
}))

// Mock constants
vi.mock('@/lib/constants', () => ({
  SESSION_USER_STORAGE_KEY: 'billie-session-user',
  RECENT_CUSTOMERS_STORAGE_KEY: 'billie-recent-customers',
  FAILED_ACTIONS_STORAGE_KEY: 'billie-failed-actions',
  RECENT_REPORTS_STORAGE_KEY: 'billie-recent-reports',
  ASK_DRAFT_STORAGE_KEY: 'billie-ask-draft',
}))

// Import after mocks
import { UserSessionGuard } from '@/components/UserSessionGuard'

describe('UserSessionGuard', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  describe('Initial Load', () => {
    it('should store user ID when user is authenticated on first load', () => {
      mockUseAuth.mockReturnValue({ user: { id: 'user-123' } })

      render(<UserSessionGuard />)

      expect(localStorage.getItem(SESSION_USER_STORAGE_KEY)).toBe('user-123')
    })

    it('should not store anything when user is not authenticated', () => {
      mockUseAuth.mockReturnValue({ user: null })

      render(<UserSessionGuard />)

      expect(localStorage.getItem(SESSION_USER_STORAGE_KEY)).toBeNull()
    })

    it('should handle numeric user IDs by converting to string', () => {
      mockUseAuth.mockReturnValue({ user: { id: 12345 } })

      render(<UserSessionGuard />)

      expect(localStorage.getItem(SESSION_USER_STORAGE_KEY)).toBe('12345')
    })
  })

  describe('User Change Detection', () => {
    it('should clear data when different user logs in', () => {
      // Simulate User A was previously logged in
      localStorage.setItem(SESSION_USER_STORAGE_KEY, 'user-A')
      localStorage.setItem(RECENT_CUSTOMERS_STORAGE_KEY, '{"customers":[]}')
      localStorage.setItem(FAILED_ACTIONS_STORAGE_KEY, '[]')

      // User B logs in
      mockUseAuth.mockReturnValue({ user: { id: 'user-B' } })

      render(<UserSessionGuard />)

      // Should clear stores
      expect(mockClearHistory).toHaveBeenCalled()
      expect(mockClearRecentReports).toHaveBeenCalled()
      expect(mockClearAll).toHaveBeenCalled()
      expect(mockClearAllVersions).toHaveBeenCalled()

      // Should update stored user
      expect(localStorage.getItem(SESSION_USER_STORAGE_KEY)).toBe('user-B')
    })

    it('should NOT clear data when same user reloads page', () => {
      // User A was previously logged in
      localStorage.setItem(SESSION_USER_STORAGE_KEY, 'user-A')

      // Same user reloads
      mockUseAuth.mockReturnValue({ user: { id: 'user-A' } })

      render(<UserSessionGuard />)

      // Should NOT clear stores
      expect(mockClearHistory).not.toHaveBeenCalled()
      expect(mockClearRecentReports).not.toHaveBeenCalled()
      expect(mockClearAll).not.toHaveBeenCalled()
      expect(mockClearAllVersions).not.toHaveBeenCalled()
    })

    it('should clear data when stored user exists but no current user (logout)', () => {
      // User A was previously logged in
      localStorage.setItem(SESSION_USER_STORAGE_KEY, 'user-A')
      localStorage.setItem(RECENT_CUSTOMERS_STORAGE_KEY, '{"customers":[{"customerId":"C1"}]}')

      // User logs out (no current user)
      mockUseAuth.mockReturnValue({ user: null })

      render(<UserSessionGuard />)

      // Should clear stores because stored user doesn't match current (null)
      expect(mockClearHistory).toHaveBeenCalled()
      expect(mockClearRecentReports).toHaveBeenCalled()
      expect(mockClearAll).toHaveBeenCalled()

      // Should remove session user key
      expect(localStorage.getItem(SESSION_USER_STORAGE_KEY)).toBeNull()
    })

    it('should NOT clear data on fresh login (no previous user)', () => {
      // No previous user stored
      expect(localStorage.getItem(SESSION_USER_STORAGE_KEY)).toBeNull()

      // User A logs in
      mockUseAuth.mockReturnValue({ user: { id: 'user-A' } })

      render(<UserSessionGuard />)

      // Should NOT clear stores (fresh login)
      expect(mockClearHistory).not.toHaveBeenCalled()
      expect(mockClearRecentReports).not.toHaveBeenCalled()
      expect(mockClearAll).not.toHaveBeenCalled()

      // Should store user
      expect(localStorage.getItem(SESSION_USER_STORAGE_KEY)).toBe('user-A')
    })
  })

  describe('localStorage Cleanup', () => {
    it('should remove recent customers localStorage on user change', () => {
      localStorage.setItem(SESSION_USER_STORAGE_KEY, 'user-A')
      localStorage.setItem(RECENT_CUSTOMERS_STORAGE_KEY, '{"customers":[{"customerId":"C1"}]}')

      mockUseAuth.mockReturnValue({ user: { id: 'user-B' } })

      render(<UserSessionGuard />)

      // localStorage should be cleared directly
      expect(localStorage.getItem(RECENT_CUSTOMERS_STORAGE_KEY)).toBeNull()
    })

    it('should remove failed actions localStorage on user change', () => {
      localStorage.setItem(SESSION_USER_STORAGE_KEY, 'user-A')
      localStorage.setItem(FAILED_ACTIONS_STORAGE_KEY, '[{"id":"1"}]')

      mockUseAuth.mockReturnValue({ user: { id: 'user-B' } })

      render(<UserSessionGuard />)

      // localStorage should be cleared directly
      expect(localStorage.getItem(FAILED_ACTIONS_STORAGE_KEY)).toBeNull()
    })

    it("should remove the previous user's recent reports and Ask Claude draft on user change", () => {
      localStorage.setItem(SESSION_USER_STORAGE_KEY, 'user-A')
      localStorage.setItem(RECENT_REPORTS_STORAGE_KEY, '{"reports":[{"slug":"decline-rate"}]}')
      sessionStorage.setItem(ASK_DRAFT_STORAGE_KEY, '{"question":"arrears by state"}')

      mockUseAuth.mockReturnValue({ user: { id: 'user-B' } })

      render(<UserSessionGuard />)

      expect(localStorage.getItem(RECENT_REPORTS_STORAGE_KEY)).toBeNull()
      expect(sessionStorage.getItem(ASK_DRAFT_STORAGE_KEY)).toBeNull()
    })
  })

  describe('Rendering', () => {
    it('should render nothing (return null)', () => {
      mockUseAuth.mockReturnValue({ user: { id: 'user-123' } })

      const { container } = render(<UserSessionGuard />)

      expect(container.innerHTML).toBe('')
    })
  })
})
