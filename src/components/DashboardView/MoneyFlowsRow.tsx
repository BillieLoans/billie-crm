'use client'

import { SectionCard } from './primitives/SectionCard'
import styles from './MoneyFlowsRow.module.css'

interface FlowTileProps {
  label: string
  value: string
  hint?: string
  testId?: string
}

function FlowTile({ label, value, hint, testId }: FlowTileProps) {
  return (
    <SectionCard density="compact" title={label} testId={testId}>
      <div className={styles.value}>{value}</div>
      {hint && <div className={styles.hint}>{hint}</div>}
    </SectionCard>
  )
}

export function MoneyFlowsRow() {
  return (
    <div className={styles.row} data-testid="money-flows-row">
      <FlowTile
        label="Payments expected today"
        value="—"
        hint="Awaiting Phase 2 aggregation"
        testId="money-flows-expected"
      />
      <FlowTile
        label="Payments received today"
        value="—"
        hint="Awaiting Phase 2 aggregation"
        testId="money-flows-received"
      />
      <FlowTile
        label="Disbursed today"
        value="—"
        hint="Awaiting Phase 2 aggregation"
        testId="money-flows-disbursed"
      />
    </div>
  )
}
