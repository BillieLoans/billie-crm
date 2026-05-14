'use client'

import { useDashboard } from '@/hooks/queries/useDashboard'
import type { MoneyFlowMetric } from '@/lib/schemas/dashboard'
import { SectionCard } from './primitives/SectionCard'
import styles from './MoneyFlowsRow.module.css'

interface FlowTileProps {
  label: string
  metric: MoneyFlowMetric | undefined
  isLoading: boolean
  testId?: string
}

function FlowTile({ label, metric, isLoading, testId }: FlowTileProps) {
  if (isLoading) {
    return (
      <SectionCard density="compact" title={label} testId={testId}>
        <div className={`${styles.value} ${styles.valueMuted}`}>—</div>
      </SectionCard>
    )
  }

  const count = metric?.count ?? 0
  const isEmpty = count === 0

  return (
    <SectionCard density="compact" title={label} testId={testId}>
      <div
        className={`${styles.value} ${isEmpty ? styles.valueMuted : ''}`}
        data-testid={testId ? `${testId}-count` : undefined}
      >
        {count}
      </div>
      <div className={styles.subtext} data-testid={testId ? `${testId}-amount` : undefined}>
        {metric?.totalAmountFormatted ?? '$0.00'}
      </div>
    </SectionCard>
  )
}

export function MoneyFlowsRow() {
  const { data, isLoading } = useDashboard()
  const flows = data?.moneyFlowsToday

  return (
    <div className={styles.row} data-testid="money-flows-row">
      <FlowTile
        label="Payments expected today"
        metric={flows?.paymentsExpected}
        isLoading={isLoading}
        testId="money-flows-expected"
      />
      <FlowTile
        label="Payments received today"
        metric={flows?.paymentsReceived}
        isLoading={isLoading}
        testId="money-flows-received"
      />
      <FlowTile
        label="Disbursed today"
        metric={flows?.disbursed}
        isLoading={isLoading}
        testId="money-flows-disbursed"
      />
    </div>
  )
}
