'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './styles.module.css'

/**
 * Sidebar nav link for the Browse Accounts page. Registered in Payload's
 * `beforeNavLinks` between Dashboard and Collections.
 *
 * MVP has no count badge — the page is exploratory rather than queue-based,
 * so a single number wouldn't carry the same meaning as the Collections /
 * Approvals queues.
 */
export function NavAccountsLink() {
  const pathname = usePathname()
  const isActive = pathname === '/admin/accounts' || pathname.startsWith('/admin/accounts?')

  return (
    <Link
      href="/admin/accounts"
      className={`${styles.navLink} ${isActive ? styles.active : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className={styles.icon} aria-hidden="true">
        🗂
      </span>
      <span className={styles.label}>Accounts</span>
    </Link>
  )
}

export default NavAccountsLink
