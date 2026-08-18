'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@payloadcms/ui'
import { useOpenIssueCount } from '@/hooks'
import styles from './styles.module.css'

/**
 * Navigation link to the Issue Reports queue with an open-report count badge.
 * Only visible to admins — reports carry diagnostics and screenshots from
 * other operators' sessions.
 * Registered in Payload's beforeNavLinks to appear at the top of the sidebar.
 */
export function NavIssueReportsLink() {
  const { user } = useAuth()
  const pathname = usePathname()

  // RBAC check — uses the singular 'role' field from the Users collection
  const isAdminUser = ((user?.role as string | undefined) ?? '') === 'admin'

  // Only poll the open count for admins (the endpoint 403s for everyone else)
  const { data: openCount = 0 } = useOpenIssueCount(isAdminUser)

  if (!isAdminUser) {
    return null
  }

  const isActive = pathname?.startsWith('/admin/issue-reports') ?? false

  return (
    <Link
      href="/admin/issue-reports"
      className={`${styles.navLink} ${isActive ? styles.active : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className={styles.icon} aria-hidden="true">
        🐞
      </span>
      <span className={styles.label}>Issue Reports</span>
      {openCount > 0 && (
        <span className={styles.badge} aria-label={`${openCount} open issue reports`}>
          {openCount > 99 ? '99+' : openCount}
        </span>
      )}
    </Link>
  )
}

// Default export for Payload component registration
export default NavIssueReportsLink
