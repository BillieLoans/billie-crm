'use client'

import React from 'react'
import { useUIStore } from '@/stores/ui'
import styles from './styles.module.css'

/**
 * Floating launcher for the issue reporter.
 *
 * Sits bottom-LEFT: FailedActionsBadge owns bottom-right, and the two must not
 * overlap on a narrow viewport. Same z-index (1000) as that badge so both sit
 * above page chrome but below the modal backdrop.
 */
export const IssueReporterButton: React.FC = () => {
  const openReportIssue = useUIStore((state) => state.openReportIssue)

  return (
    <div className={styles.launcherContainer}>
      <button
        type="button"
        className={styles.launcherButton}
        onClick={() => openReportIssue()}
        aria-label="Report an issue"
        data-testid="issue-reporter-button"
      >
        <span className={styles.launcherIcon} aria-hidden="true">
          🐞
        </span>
        <span>Report issue</span>
      </button>
    </div>
  )
}

export default IssueReporterButton
