'use client'

import { useEffect, useState } from 'react'
import { msUntilCutoff, formatCountdown } from '@/lib/disbursement-cutoff'
import styles from './CutoffCountdown.module.css'

/**
 * Live "time until today's 3pm AEST cut-off" chip.
 * Amber normally, orange when under an hour, red once the cut-off has passed.
 * Shared by the dashboard triage panel and the disbursement queue page.
 */
export function CutoffCountdown({ className }: { className?: string }) {
  const [ms, setMs] = useState<number | null>(null)

  useEffect(() => {
    setMs(msUntilCutoff())
    const id = setInterval(() => setMs(msUntilCutoff()), 30_000)
    return () => clearInterval(id)
  }, [])

  const passed = ms !== null && ms <= 0
  const urgent = ms !== null && ms > 0 && ms < 60 * 60_000
  const chipClass = passed ? styles.passed : urgent ? styles.urgent : styles.normal

  return (
    <span className={className}>
      <span className={styles.label}>{passed ? 'Cut-off' : "Today's 3:00pm cut-off in"}</span>
      <span className={`${styles.chip} ${chipClass}`} data-testid="cutoff-countdown">
        {ms === null ? '—' : passed ? 'passed at 3:00pm' : formatCountdown(ms)}
      </span>
    </span>
  )
}
