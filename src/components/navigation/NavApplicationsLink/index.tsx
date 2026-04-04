'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@payloadcms/ui'
import styles from './styles.module.css'

/**
 * Navigation link to the Applications (conversation monitoring) view.
 * Visible to all authenticated roles including readonly.
 * Registered in Payload's beforeNavLinks to appear in the sidebar.
 *
 * Story 2.1: ApplicationsView Scaffold & Navigation (FR34, FR35)
 */
export function NavApplicationsLink() {
  const { user } = useAuth()
  const pathname = usePathname()

  // All authenticated roles can access applications view (FR32, FR33)
  if (!user) return null

  const isActive =
    pathname === '/admin/applications' || pathname.startsWith('/admin/applications/')

  return (
    <Link
      href="/admin/applications"
      className={`${styles.navLink} ${isActive ? styles.active : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className={styles.icon} aria-hidden="true">
        💬
      </span>
      <span className={styles.label}>Applications</span>
    </Link>
  )
}

export default NavApplicationsLink
