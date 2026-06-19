'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useOverdueAccounts } from '@/hooks/queries/useOverdueAccounts'
import styles from './styles.module.css'

/**
 * Navigation link to the Collections Queue with overdue count badge.
 * Registered in Payload's beforeNavLinks to appear in the sidebar.
 *
 * Story E1-S1: Collections Queue View Shell
 */
export function NavCollectionsLink() {
  const pathname = usePathname()

  // Fetch overdue count (small page size since we only need count)
  const { totalCount, isFallback } = useOverdueAccounts({ pageSize: 1 })

  const isActive = pathname === '/admin/collections-queue'

  return (
    <Link
      href="/admin/collections-queue"
      className={`${styles.navLink} ${isActive ? styles.active : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className={styles.icon} aria-hidden="true">
        📋
      </span>
      <span className={styles.label}>Collections</span>
      {totalCount > 0 && !isFallback && (
        <span className={styles.badge} aria-label={`${totalCount} overdue accounts`}>
          {totalCount > 99 ? '99+' : totalCount}
        </span>
      )}
    </Link>
  )
}

// Default export for Payload component registration
export default NavCollectionsLink
