import type { User } from '@/payload-types'

/**
 * Role-based access control helpers for Payload CMS.
 *
 * Role hierarchy:
 * - admin: Full system access, sees all collections
 * - supervisor: Operations + approval authority, no raw collection access
 * - operations: Day-to-day servicing, no raw collection access
 * - readonly: View-only access, no raw collection access
 */

type UserRole = User['role']

/**
 * Safely extract the role from a user object.
 * Handles cases where user might be undefined or have an unexpected shape.
 */
const VALID_ROLES: readonly string[] = ['admin', 'supervisor', 'operations', 'readonly']

export function getUserRole(user: unknown): UserRole | undefined {
  if (user && typeof user === 'object' && 'role' in user) {
    const role = (user as User).role
    if (VALID_ROLES.includes(role)) return role
  }
  return undefined
}

/**
 * Check if a user has the admin role.
 */
export function isAdmin(user: unknown): boolean {
  return getUserRole(user) === 'admin'
}

/**
 * Check if a user has approval authority (admin or supervisor).
 */
export function hasApprovalAuthority(user: unknown): boolean {
  const role = getUserRole(user)
  return role === 'admin' || role === 'supervisor'
}

/**
 * Check if a user can perform servicing operations.
 * Includes admin, supervisor, and operations roles.
 */
export function canService(user: unknown): boolean {
  const role = getUserRole(user)
  return role !== undefined && ['admin', 'supervisor', 'operations'].includes(role)
}

/**
 * Check if a user has any valid role (is authenticated with a role).
 */
export function hasAnyRole(user: unknown): boolean {
  const role = getUserRole(user)
  return role !== undefined && ['admin', 'supervisor', 'operations', 'readonly'].includes(role)
}

/**
 * Payload admin.hidden function to hide collections from non-admin users.
 * Use this in collection config: `admin: { hidden: hideFromNonAdmins }`
 */
export function hideFromNonAdmins({ user }: { user: unknown }): boolean {
  return !isAdmin(user)
}
