'use client'

import { useMemo } from 'react'
import { useDashboard } from '@/hooks/queries/useDashboard'
import { formatCurrency, formatRelativeTime } from '@/lib/formatters'
import { HeroTile } from './primitives/HeroTile'

export function DisbursementsHeroTile() {
  const { data, isLoading } = useDashboard()

  const count = data?.pendingDisbursementsCount ?? 0

  const { totalAmount, oldestCreatedAt } = useMemo(() => {
    let total = 0
    let oldest: string | null = null
    for (const acct of data?.pendingDisbursements ?? []) {
      total += acct.loanAmount || 0
      if (!oldest || acct.createdAt < oldest) {
        oldest = acct.createdAt
      }
    }
    return { totalAmount: total, oldestCreatedAt: oldest }
  }, [data])

  let subline: string
  if (count === 0) {
    subline = 'All loans disbursed'
  } else if (oldestCreatedAt) {
    subline = `${formatCurrency(totalAmount)} · oldest ${formatRelativeTime(oldestCreatedAt)}`
  } else {
    subline = formatCurrency(totalAmount)
  }

  return (
    <HeroTile
      label="Disbursements Awaiting"
      value={count}
      subline={subline}
      accent={count > 0 ? 'warning' : 'healthy'}
      primaryAction={{
        label: 'Open disbursement queue',
        href: '/admin/pending-disbursements',
      }}
      isLoading={isLoading}
      testId="disbursements-hero-tile"
    />
  )
}
