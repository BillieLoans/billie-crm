'use client'

import React from 'react'
import { useReportPins } from '@/hooks/queries/useReportPreferences'
import styles from './styles.module.css'

/** Pin or unpin a report to the top of the Reports home and sidebar. */
export function PinButton({ slug, title }: { slug: string; title: string }) {
  const { isPinned, toggle } = useReportPins()
  const pinned = isPinned(slug)
  return (
    <button
      type="button"
      className={styles.pinButton}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
      title={pinned ? 'Unpin' : 'Pin to the top'}
      onClick={() => toggle(slug)}
    >
      <span aria-hidden="true">{pinned ? '★' : '☆'}</span>
      <span className={styles.pinText}>{pinned ? 'Pinned' : 'Pin'}</span>
    </button>
  )
}
