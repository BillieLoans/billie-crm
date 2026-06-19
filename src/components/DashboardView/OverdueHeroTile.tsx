'use client'

import { useMemo } from 'react'
import { useOverdueAccounts } from '@/hooks/queries/useOverdueAccounts'
import { formatCurrency } from '@/lib/formatters'
import { HeroTile } from './primitives/HeroTile'
import { AgingBars, type AgingBucket } from './primitives/AgingBars'

const BUCKET_DEFS: Array<{ label: string; min: number; max: number; color: string }> = [
  { label: '1-7d', min: 1, max: 7, color: '#fbbf24' },
  { label: '8-30d', min: 8, max: 30, color: '#f59e0b' },
  { label: '31-60d', min: 31, max: 60, color: '#ea580c' },
  { label: '61-90d', min: 61, max: 90, color: '#dc2626' },
  { label: '90+d', min: 91, max: Number.POSITIVE_INFINITY, color: '#7f1d1d' },
]

export function OverdueHeroTile() {
  const { accounts, totalCount, isLoading, isFallback } = useOverdueAccounts({ pageSize: 1000 })

  const { buckets, totalAmount } = useMemo(() => {
    const counts = BUCKET_DEFS.map(() => 0)
    const amounts = BUCKET_DEFS.map(() => 0)
    let runningTotal = 0
    for (const acct of accounts) {
      if (acct.dpd < 1) continue
      const i = BUCKET_DEFS.findIndex((b) => acct.dpd >= b.min && acct.dpd <= b.max)
      if (i < 0) continue
      counts[i]++
      const amt = parseFloat(acct.totalOverdueAmount) || 0
      amounts[i] += amt
      runningTotal += amt
    }
    const result: AgingBucket[] = BUCKET_DEFS.map((d, i) => ({
      label: d.label,
      count: counts[i],
      amount: amounts[i],
      amountFormatted: formatCurrency(amounts[i]),
      color: d.color,
    }))
    return { buckets: result, totalAmount: runningTotal }
  }, [accounts])

  let subline: string
  if (isFallback) {
    subline = 'Data unavailable'
  } else if (totalCount === 0) {
    subline = 'All accounts current'
  } else {
    subline = `${formatCurrency(totalAmount)} at risk`
  }

  return (
    <HeroTile
      label="Overdue Accounts"
      value={totalCount}
      subline={subline}
      accent={totalCount > 0 ? 'overdue' : 'healthy'}
      meta={
        totalCount > 0 ? (
          <AgingBars buckets={buckets} testId="overdue-aging-bars" />
        ) : undefined
      }
      primaryAction={{ label: 'Open collections queue', href: '/admin/collections-queue' }}
      isLoading={isLoading}
      testId="overdue-hero-tile"
    />
  )
}
