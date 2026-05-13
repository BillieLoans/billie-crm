'use client'

import { usePendingApprovals } from '@/hooks/queries/usePendingApprovals'
import { formatCurrency, formatRelativeTime } from '@/lib/formatters'
import { HeroTile } from './primitives/HeroTile'

export function ApprovalsHeroTile() {
  const { data, isLoading } = usePendingApprovals({ sort: 'oldest', limit: 1 })

  const count = data?.totalDocs ?? 0
  const oldest = data?.docs?.[0]

  let subline: string
  if (count === 0) {
    subline = 'Caught up'
  } else if (oldest) {
    const who = oldest.customerName || oldest.accountNumber || oldest.requestNumber
    subline = `Write-off ${formatCurrency(oldest.amount)} · ${who} · ${formatRelativeTime(oldest.createdAt)}`
  } else {
    subline = `${count} pending`
  }

  return (
    <HeroTile
      label="Approvals Waiting"
      value={count}
      subline={subline}
      accent={count > 0 ? 'attention' : 'healthy'}
      primaryAction={
        count > 0 ? { label: 'Review approvals', href: '/admin/approvals' } : undefined
      }
      isLoading={isLoading}
      testId="approvals-hero-tile"
    />
  )
}
