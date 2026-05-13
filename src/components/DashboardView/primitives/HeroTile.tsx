import type { ReactNode } from 'react'
import Link from 'next/link'
import styles from './HeroTile.module.css'

export type HeroTileAccent = 'overdue' | 'warning' | 'healthy' | 'neutral' | 'attention'

export interface HeroTileProps {
  label: string
  value: ReactNode
  subline?: ReactNode
  accent?: HeroTileAccent
  primaryAction?: {
    label: string
    href: string
  }
  meta?: ReactNode
  isLoading?: boolean
  testId?: string
}

export function HeroTile({
  label,
  value,
  subline,
  accent = 'neutral',
  primaryAction,
  meta,
  isLoading,
  testId,
}: HeroTileProps) {
  return (
    <div className={styles.tile} data-accent={accent} data-testid={testId}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value} data-loading={isLoading ? 'true' : undefined}>
        {isLoading ? '—' : value}
      </div>
      {subline && <div className={styles.subline}>{subline}</div>}
      {meta && <div className={styles.meta}>{meta}</div>}
      {primaryAction && (
        <Link href={primaryAction.href} className={styles.action}>
          <span>{primaryAction.label}</span>
          <span aria-hidden="true" className={styles.arrow}>
            →
          </span>
        </Link>
      )}
    </div>
  )
}
