'use client'

import React, { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { ISSUE_5XX_EVENT, NO_TRACK_ATTR, installIssueTrackers } from '@/lib/issue-diagnostics'
import { useUIStore } from '@/stores/ui'
import { IssueReporterButton } from './IssueReporterButton'
import { IssueReporterModal } from './IssueReporterModal'

/** At most one "something went wrong" prompt per minute — a broken page can
 *  fire dozens of failing requests, and a toast per failure is its own bug. */
const FIVE_XX_TOAST_INTERVAL_MS = 60_000

/**
 * Global issue reporter: the floating launcher, the report modal, and the
 * diagnostics trackers that feed them.
 *
 * The whole subtree carries `data-issue-no-track`, so operating the reporter
 * never shows up in the diagnostics the reporter collects.
 */
export const IssueReporter: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null)
  const reportIssueOpen = useUIStore((state) => state.reportIssueOpen)
  const openReportIssue = useUIStore((state) => state.openReportIssue)
  const lastToastAtRef = useRef(0)

  // Idempotent — safe under React strict-mode double effects and remounts.
  useEffect(() => {
    installIssueTrackers()
  }, [])

  useEffect(() => {
    const onServerError = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; status: number }>).detail
      if (!detail) return

      const now = Date.now()
      if (now - lastToastAtRef.current < FIVE_XX_TOAST_INTERVAL_MS) return
      lastToastAtRef.current = now

      const trigger = detail.status >= 500 ? 'server-error' : 'network-error'

      toast.error('Something went wrong with a request', {
        id: 'issue-reporter-request-failed',
        action: {
          label: 'Report issue',
          onClick: () => openReportIssue(trigger),
        },
      })
    }

    window.addEventListener(ISSUE_5XX_EVENT, onServerError)
    return () => window.removeEventListener(ISSUE_5XX_EVENT, onServerError)
  }, [openReportIssue])

  return (
    <div ref={rootRef} {...{ [NO_TRACK_ATTR]: '' }} data-testid="issue-reporter">
      {!reportIssueOpen && <IssueReporterButton />}
      {reportIssueOpen && <IssueReporterModal reporterRootRef={rootRef} />}
    </div>
  )
}

export default IssueReporter

// Barrel re-exports live here rather than in a sibling index.ts — two index
// modules in one directory is an ambiguous resolution.
export { IssueReporterButton } from './IssueReporterButton'
export { IssueReporterModal } from './IssueReporterModal'
export type { IssueReporterModalProps } from './IssueReporterModal'
export { RouteTracker } from './RouteTracker'
