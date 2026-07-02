'use client'

import type { AttentionItem } from '@/lib/accountTriage'
import styles from './AttentionStrip.module.css'

export interface AttentionStripProps {
  items: AttentionItem[]
  onSelectAccount: (accountId: string) => void
  /** Rendered inline after the chips — e.g. an action tied to a chip (Clear block). */
  trailing?: React.ReactNode
}

const ICON: Record<AttentionItem['kind'], string> = {
  vulnerable: '⚠',
  overdue: '●',
  pending_disbursement: '⏳',
  writeoff_pending: '📝',
  reapplication_blocked: '⛔',
  collections: '☎',
  hardship: '🛡',
  stop_contact: '🔕',
}

export const AttentionStrip: React.FC<AttentionStripProps> = ({
  items,
  onSelectAccount,
  trailing,
}) => {
  if (items.length === 0) return null

  return (
    <div className={styles.strip} data-testid="attention-strip">
      <span className={styles.label}>NEEDS ATTENTION</span>
      {items.map((item) => {
        const clickable = item.accountId !== null
        return (
          <button
            key={`${item.kind}-${item.accountId ?? 'customer'}`}
            type="button"
            className={`${styles.chip} ${styles[item.kind]} ${clickable ? styles.clickable : ''}`}
            onClick={() => item.accountId && onSelectAccount(item.accountId)}
            disabled={!clickable}
            data-testid={`attention-chip-${item.kind}`}
          >
            <span aria-hidden>{ICON[item.kind]}</span> {item.label}
          </button>
        )
      })}
      {trailing}
    </div>
  )
}
