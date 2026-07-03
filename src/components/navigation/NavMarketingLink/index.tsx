'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './styles.module.css'

/**
 * Navigation link to the Marketing admin view (Task C6).
 * Registered in Payload's beforeNavLinks to appear in the sidebar.
 */
export function NavMarketingLink() {
  const pathname = usePathname()
  const isActive = pathname?.startsWith('/admin/marketing') ?? false

  return (
    <Link
      href="/admin/marketing"
      className={`${styles.navLink} ${isActive ? styles.active : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className={styles.icon} aria-hidden="true">
        📣
      </span>
      <span className={styles.label}>Marketing</span>
    </Link>
  )
}

// Default export for Payload component registration
export default NavMarketingLink
