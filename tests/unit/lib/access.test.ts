import { describe, it, test, expect } from 'vitest'
import {
  getUserRole,
  isAdmin,
  hasApprovalAuthority,
  canService,
  hasAnyRole,
  hideFromNonAdmins,
  canMarketing,
  canReadMarketing,
} from '@/lib/access'

describe('Access Control Helpers', () => {
  describe('getUserRole', () => {
    it('should return role when user has valid role', () => {
      expect(getUserRole({ role: 'admin' })).toBe('admin')
      expect(getUserRole({ role: 'supervisor' })).toBe('supervisor')
      expect(getUserRole({ role: 'operations' })).toBe('operations')
      expect(getUserRole({ role: 'readonly' })).toBe('readonly')
    })

    it('should return undefined for null user', () => {
      expect(getUserRole(null)).toBeUndefined()
    })

    it('should return undefined for undefined user', () => {
      expect(getUserRole(undefined)).toBeUndefined()
    })

    it('should return undefined for user without role', () => {
      expect(getUserRole({})).toBeUndefined()
      expect(getUserRole({ email: 'test@test.com' })).toBeUndefined()
    })

    it('should return undefined for non-object user', () => {
      expect(getUserRole('admin')).toBeUndefined()
      expect(getUserRole(123)).toBeUndefined()
    })
  })

  describe('isAdmin', () => {
    it('should return true for admin role', () => {
      expect(isAdmin({ role: 'admin' })).toBe(true)
    })

    it('should return false for non-admin roles', () => {
      expect(isAdmin({ role: 'supervisor' })).toBe(false)
      expect(isAdmin({ role: 'operations' })).toBe(false)
      expect(isAdmin({ role: 'readonly' })).toBe(false)
    })

    it('should return false for null/undefined user', () => {
      expect(isAdmin(null)).toBe(false)
      expect(isAdmin(undefined)).toBe(false)
    })
  })

  describe('hasApprovalAuthority', () => {
    it('should return true for admin', () => {
      expect(hasApprovalAuthority({ role: 'admin' })).toBe(true)
    })

    it('should return true for supervisor', () => {
      expect(hasApprovalAuthority({ role: 'supervisor' })).toBe(true)
    })

    it('should return false for operations', () => {
      expect(hasApprovalAuthority({ role: 'operations' })).toBe(false)
    })

    it('should return false for readonly', () => {
      expect(hasApprovalAuthority({ role: 'readonly' })).toBe(false)
    })

    it('should return false for null/undefined user', () => {
      expect(hasApprovalAuthority(null)).toBe(false)
      expect(hasApprovalAuthority(undefined)).toBe(false)
    })
  })

  describe('canService', () => {
    it('should return true for admin', () => {
      expect(canService({ role: 'admin' })).toBe(true)
    })

    it('should return true for supervisor', () => {
      expect(canService({ role: 'supervisor' })).toBe(true)
    })

    it('should return true for operations', () => {
      expect(canService({ role: 'operations' })).toBe(true)
    })

    it('should return false for readonly', () => {
      expect(canService({ role: 'readonly' })).toBe(false)
    })

    it('should return false for null/undefined user', () => {
      expect(canService(null)).toBe(false)
      expect(canService(undefined)).toBe(false)
    })
  })

  describe('hasAnyRole', () => {
    it('should return true for all valid roles', () => {
      expect(hasAnyRole({ role: 'admin' })).toBe(true)
      expect(hasAnyRole({ role: 'supervisor' })).toBe(true)
      expect(hasAnyRole({ role: 'operations' })).toBe(true)
      expect(hasAnyRole({ role: 'readonly' })).toBe(true)
    })

    it('should return false for invalid role', () => {
      expect(hasAnyRole({ role: 'unknown' })).toBe(false)
    })

    it('should return false for null/undefined user', () => {
      expect(hasAnyRole(null)).toBe(false)
      expect(hasAnyRole(undefined)).toBe(false)
    })
  })

  describe('hideFromNonAdmins', () => {
    it('should return false for admin (not hidden)', () => {
      expect(hideFromNonAdmins({ user: { role: 'admin' } })).toBe(false)
    })

    it('should return true for supervisor (hidden)', () => {
      expect(hideFromNonAdmins({ user: { role: 'supervisor' } })).toBe(true)
    })

    it('should return true for operations (hidden)', () => {
      expect(hideFromNonAdmins({ user: { role: 'operations' } })).toBe(true)
    })

    it('should return true for readonly (hidden)', () => {
      expect(hideFromNonAdmins({ user: { role: 'readonly' } })).toBe(true)
    })

    it('should return true for null user (hidden)', () => {
      expect(hideFromNonAdmins({ user: null })).toBe(true)
    })

    it('should return true for undefined user (hidden)', () => {
      expect(hideFromNonAdmins({ user: undefined })).toBe(true)
    })
  })
})

describe('Access Control - Role Matrix (AC1, AC2)', () => {
  // Test the full role matrix as documented in Story 6.7

  describe('Collection Visibility Matrix', () => {
    it.each([
      ['admin', false],      // Admin sees collections (not hidden)
      ['supervisor', true],  // Hidden from supervisor
      ['operations', true],  // Hidden from operations
      ['readonly', true],    // Hidden from readonly
    ])('hideFromNonAdmins for %s role should return %s', (role, expectedHidden) => {
      expect(hideFromNonAdmins({ user: { role } })).toBe(expectedHidden)
    })
  })

  describe('Approval Authority Matrix', () => {
    it.each([
      ['admin', true],
      ['supervisor', true],
      ['operations', false],
      ['readonly', false],
    ])('hasApprovalAuthority for %s role should return %s', (role, expected) => {
      expect(hasApprovalAuthority({ role })).toBe(expected)
    })
  })

  describe('Servicing Access Matrix', () => {
    it.each([
      ['admin', true],
      ['supervisor', true],
      ['operations', true],
      ['readonly', false],
    ])('canService for %s role should return %s', (role, expected) => {
      expect(canService({ role })).toBe(expected)
    })
  })
})

const user = (role: string) => ({ role }) as unknown

describe('marketing role wall', () => {
  test('marketing is a valid role', () => {
    expect(getUserRole(user('marketing'))).toBe('marketing')
  })
  test('canMarketing: admin and marketing only', () => {
    expect(canMarketing(user('admin'))).toBe(true)
    expect(canMarketing(user('marketing'))).toBe(true)
    expect(canMarketing(user('supervisor'))).toBe(false)
    expect(canMarketing(user('operations'))).toBe(false)
  })
  test('canReadMarketing: everything except service', () => {
    for (const r of ['admin', 'marketing', 'supervisor', 'operations', 'readonly'])
      expect(canReadMarketing(user(r))).toBe(true)
    expect(canReadMarketing(user('service'))).toBe(false)
  })
  test('LENDING WALL: hasAnyRole must NOT admit marketing', () => {
    expect(hasAnyRole(user('marketing'))).toBe(false)
  })
})
