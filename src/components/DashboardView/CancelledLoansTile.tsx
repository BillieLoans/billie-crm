'use client'

import { useDashboard } from '@/hooks/queries/useDashboard'
import { HeroTile } from './primitives/HeroTile'

/**
 * Loans cancelled before disbursement (BTB-517). Neutral: a cancelled loan is
 * closed, not work waiting. Links to those loans in the accounts browser.
 */
export function CancelledLoansTile() {
  const { data, isLoading } = useDashboard()
  const count = data?.cancelledBeforeDisbursementCount ?? 0

  return (
    <HeroTile
      label="Cancelled before disbursement"
      value={count}
      subline={count === 0 ? 'None' : 'Closed before any money was paid out. Nothing owing.'}
      accent="neutral"
      primaryAction={
        count > 0
          ? { label: 'View cancelled loans', href: '/admin/accounts?status=cancelled' }
          : undefined
      }
      isLoading={isLoading}
      testId="cancelled-loans-tile"
    />
  )
}
