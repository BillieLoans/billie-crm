'use client'

import { useAuth } from '@payloadcms/ui'
import { hasAnyRole } from '@/lib/access'

/**
 * Whether the current admin user is on the lending side of the wall
 * (admin/supervisor/operations/readonly — `hasAnyRole`). The `marketing`
 * and `service` roles are deliberately excluded: global lending chrome
 * (approvals bell, ledger status, read-only sync) must not render or poll
 * for them — their requests would only 403 against the lending collections.
 */
export function useLendingAccess(): boolean {
  const { user } = useAuth()
  return hasAnyRole(user)
}
