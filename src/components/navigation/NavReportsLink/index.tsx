'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@payloadcms/ui'
import { hasAnyRole } from '@/lib/access'
import styles from './styles.module.css'

/**
 * Navigation link to Reports (BTB-506). Shown to staff roles; marketing and
 * service accounts stay outside the lending data.
 */
export function NavReportsLink() {
  const { user } = useAuth()
  const pathname = usePathname()
  if (!hasAnyRole(user)) return null
  const isActive = pathname?.startsWith('/admin/reports') ?? false

  return (
    <Link
      href="/admin/reports"
      className={`${styles.navLink} ${isActive ? styles.active : ''}`}
      aria-current={isActive ? 'page' : undefined}
      data-testid="nav-reports-link"
    >
      <span className={styles.icon} aria-hidden="true">
        📈
      </span>
      <span className={styles.label}>Reports</span>
    </Link>
  )
}

export default NavReportsLink
