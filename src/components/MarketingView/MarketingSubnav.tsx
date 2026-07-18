'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMarketingOverview } from '@/hooks/queries/useMarketingOverview'
import styles from './styles.module.css'

/**
 * Persistent sub-navigation for the marketing module — the same three tabs on
 * every marketing page, replacing the old ad-hoc "Feedback queue →" /
 * "← Back to Marketing" links. The Feedback tab carries a live open-items
 * badge (red once any complaint is overdue) so the queue can't silently age.
 */
export const MarketingSubnav: React.FC = () => {
  const pathname = usePathname() ?? ''
  const { data: overview } = useMarketingOverview()

  const tabs = [
    {
      href: '/admin/marketing',
      label: 'Contacts',
      active:
        pathname === '/admin/marketing' || pathname.startsWith('/admin/marketing/contacts'),
    },
    {
      href: '/admin/marketing/campaigns',
      label: 'Campaigns',
      active: pathname.startsWith('/admin/marketing/campaigns'),
    },
    {
      href: '/admin/marketing/feedback',
      label: 'Feedback',
      active: pathname.startsWith('/admin/marketing/feedback'),
      badge: overview?.openFeedback || 0,
      badgeUrgent: (overview?.overdueComplaints ?? 0) > 0,
    },
  ]

  return (
    <nav className={styles.subnav} aria-label="Marketing sections">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={tab.active ? `${styles.subnavTab} ${styles.subnavTabActive}` : styles.subnavTab}
          aria-current={tab.active ? 'page' : undefined}
        >
          {tab.label}
          {tab.badge ? (
            <span
              className={
                tab.badgeUrgent
                  ? `${styles.subnavBadge} ${styles.subnavBadgeUrgent}`
                  : styles.subnavBadge
              }
              title={
                tab.badgeUrgent
                  ? 'Open feedback — includes overdue complaints'
                  : 'Open feedback items'
              }
            >
              {tab.badge > 99 ? '99+' : tab.badge}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}

export default MarketingSubnav
