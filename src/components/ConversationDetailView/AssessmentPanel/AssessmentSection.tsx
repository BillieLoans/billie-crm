'use client'

import React, { useState } from 'react'
import styles from './styles.module.css'

interface AssessmentSectionProps {
  title: string
  summary: string
  children: React.ReactNode
  defaultOpen?: boolean
}

/**
 * Collapsible section used by the right-hand assessment panel (all collapsed
 * by default — FR13). Extracted from AssessmentPanel so sibling sections
 * (e.g. LlmCostsSection) can share the chrome without importing the panel.
 */
export function AssessmentSection({
  title,
  summary,
  children,
  defaultOpen = false,
}: AssessmentSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const id = `section-${title.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div className={styles.section}>
      <button
        type="button"
        className={styles.sectionHeader}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
      >
        <span className={styles.sectionTitle}>{title}</span>
        <span className={styles.sectionSummary}>{summary}</span>
        <span className={`${styles.chevron} ${open ? styles.open : ''}`} aria-hidden="true">
          ▶
        </span>
      </button>
      {open && (
        <div id={id} className={styles.sectionContent}>
          {children}
        </div>
      )}
    </div>
  )
}
