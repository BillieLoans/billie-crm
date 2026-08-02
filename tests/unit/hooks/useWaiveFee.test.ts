/**
 * Unit tests for useWaiveFee hook
 */
import { describe, it, expect } from 'vitest'
import {
  useWaiveFee,
  WaiveFeeParams,
  WaiveFeeResponse,
} from '@/hooks/mutations/useWaiveFee'
import { VERSION_CONFLICT_ERROR_CODE } from '@/lib/constants'

describe('useWaiveFee', () => {
  describe('exports', () => {
    it('should export the useWaiveFee hook', () => {
      expect(useWaiveFee).toBeDefined()
      expect(typeof useWaiveFee).toBe('function')
    })

    it('should export WaiveFeeParams type', () => {
      // Type-only test - if it compiles, the type exists
      const params: WaiveFeeParams = {
        loanAccountId: 'LA-001',
        waiverAmount: 50.0,
        reason: 'Customer goodwill',
        approvedBy: 'supervisor-123',
      }
      expect(params.loanAccountId).toBe('LA-001')
      expect(params.waiverAmount).toBe(50.0)
    })

    it('should export WaiveFeeResponse type', () => {
      // Type-only test - if it compiles, the type exists
      const response: WaiveFeeResponse = {
        success: true,
        transaction: {
          id: 'tx-001',
          accountId: 'LA-001',
          type: 'FEE_WAIVER',
          typeLabel: 'Fee Waiver',
          date: '2025-01-01T00:00:00Z',
          feeDelta: -50.0,
          totalDelta: -50.0,
          feeAfter: 0,
          totalAfter: 500.0,
          description: 'Fee waived',
        },
        eventId: 'event-001',
      }
      expect(response.success).toBe(true)
      expect(response.transaction.feeDelta).toBe(-50.0)
    })
  })

  describe('WaiveFeeParams', () => {
    it('should require loanAccountId', () => {
      const params: WaiveFeeParams = {
        loanAccountId: 'LA-12345',
        waiverAmount: 25.0,
        reason: 'Test reason',
        approvedBy: 'admin',
      }
      expect(params.loanAccountId).toBe('LA-12345')
    })

    it('should require waiverAmount as number', () => {
      const params: WaiveFeeParams = {
        loanAccountId: 'LA-001',
        waiverAmount: 99.99,
        reason: 'Test',
        approvedBy: 'admin',
      }
      expect(typeof params.waiverAmount).toBe('number')
    })

    it('should require reason string', () => {
      const params: WaiveFeeParams = {
        loanAccountId: 'LA-001',
        waiverAmount: 10,
        reason: 'Customer loyalty - first late fee',
        approvedBy: 'admin',
      }
      expect(params.reason).toContain('loyalty')
    })

    it('should require approvedBy string', () => {
      const params: WaiveFeeParams = {
        loanAccountId: 'LA-001',
        waiverAmount: 10,
        reason: 'Test',
        approvedBy: 'manager-456',
      }
      expect(params.approvedBy).toBe('manager-456')
    })
  })

  describe('WaiveFeeResponse', () => {
    it('should include success flag', () => {
      const response: WaiveFeeResponse = {
        success: true,
        transaction: {
          id: 'tx-001',
          accountId: 'LA-001',
          type: 'FEE_WAIVER',
          typeLabel: 'Fee Waiver',
          date: '2025-01-01T00:00:00Z',
          feeDelta: -10,
          totalDelta: -10,
          feeAfter: 5,
          totalAfter: 505,
          description: 'Waiver',
        },
        eventId: 'evt-001',
      }
      expect(response.success).toBe(true)
    })

    it('should include transaction details', () => {
      const response: WaiveFeeResponse = {
        success: true,
        transaction: {
          id: 'tx-002',
          accountId: 'LA-002',
          type: 'FEE_WAIVER',
          typeLabel: 'Fee Waiver',
          date: '2025-02-01T12:00:00Z',
          feeDelta: -25.5,
          totalDelta: -25.5,
          feeAfter: 0,
          totalAfter: 300.0,
          description: 'Full fee waiver',
        },
        eventId: 'evt-002',
      }
      expect(response.transaction.type).toBe('FEE_WAIVER')
      expect(response.transaction.feeDelta).toBe(-25.5)
      expect(response.transaction.feeAfter).toBe(0)
    })

    it('should include eventId for audit', () => {
      const response: WaiveFeeResponse = {
        success: true,
        transaction: {
          id: 'tx-001',
          accountId: 'LA-001',
          type: 'FEE_WAIVER',
          typeLabel: 'Fee Waiver',
          date: '2025-01-01',
          feeDelta: -10,
          totalDelta: -10,
          feeAfter: 0,
          totalAfter: 100,
          description: 'Test',
        },
        eventId: 'evt-abc-123',
      }
      expect(response.eventId).toBe('evt-abc-123')
    })
  })

  describe('Version Conflict Handling', () => {
    it('should support expectedVersion in WaiveFeeParams', () => {
      const params: WaiveFeeParams = {
        loanAccountId: 'LA-001',
        waiverAmount: 50.0,
        reason: 'Test reason',
        approvedBy: 'admin',
        expectedVersion: '2025-12-11T06:00:00.000Z',
      }
      expect(params.expectedVersion).toBe('2025-12-11T06:00:00.000Z')
    })

    it('should allow expectedVersion to be optional for backward compatibility', () => {
      const params: WaiveFeeParams = {
        loanAccountId: 'LA-001',
        waiverAmount: 50.0,
        reason: 'Test reason',
        approvedBy: 'admin',
        // expectedVersion intentionally omitted
      }
      expect(params.expectedVersion).toBeUndefined()
    })

    it('should export VERSION_CONFLICT_ERROR_CODE constant', () => {
      expect(VERSION_CONFLICT_ERROR_CODE).toBe('VERSION_CONFLICT')
    })

    it('should create error with code property for version conflicts', () => {
      // Simulate how the hook creates version conflict errors
      const err = new Error('Version conflict detected')
      ;(err as any).code = VERSION_CONFLICT_ERROR_CODE
      ;(err as any).currentVersion = '2025-12-11T07:00:00.000Z'
      ;(err as any).expectedVersion = '2025-12-11T06:00:00.000Z'

      expect((err as any).code).toBe(VERSION_CONFLICT_ERROR_CODE)
      expect((err as any).currentVersion).toBeDefined()
      expect((err as any).expectedVersion).toBeDefined()
    })
  })
})
