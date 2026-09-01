'use client'

import React, { useState } from 'react'
import { ContextDrawer } from '@/components/ui/ContextDrawer'
import { formatDateMedium } from '@/lib/formatters'
import type { CancellationRecordSchema } from '@/lib/schemas/conversations'
import type { z } from 'zod'
import styles from '../styles.module.css'

type CancellationRecord = z.infer<typeof CancellationRecordSchema>

interface CancellationBannerProps {
  cancellationRecord: CancellationRecord | null | undefined
}

const CATEGORY_LABELS: Record<string, string> = {
  customer_declined: 'Declined by customer',
  system_expired: 'Offer expired',
  abandoned: 'Abandoned',
}

const REASON_LABELS: Record<string, string> = {
  attestation_declined: 'Attestation declined',
  preliminary_approval_cancelled: 'Preliminary approval declined',
  statement_consent_declined: 'Bank-statement consent declined',
  final_offer_declined: 'Final offer declined',
  browser_close: 'Browser closed',
  session_timeout: 'Offer window elapsed',
  cutover_exhausted: 'Offer refresh exhausted',
  customer_request: 'Customer requested cancellation',
}

/** Raw value when unmapped (a category/reason added upstream before the CRM
 * knows a label for it), em-dash when null — same contract as reasonLabel(). */
const label = (map: Record<string, string>, value: string | null | undefined): string =>
  (value && map[value]) || value || '—'

/**
 * One-line summary of why an application was not taken up — customer decline,
 * offer expiry, or abandonment — following the KillBanner pattern: a fixed
 * clickable line opening a ContextDrawer with the audit detail. A
 * customer_request kill shows BOTH banners: the kill banner says who ended it,
 * this one says why.
 */
export function CancellationBanner({ cancellationRecord }: CancellationBannerProps) {
  const [open, setOpen] = useState(false)

  if (!cancellationRecord) return null

  const { reason, category, cancelled_at, application_number } = cancellationRecord
  const displayCategory = label(CATEGORY_LABELS, category)
  const displayReason = label(REASON_LABELS, reason)
  const displayDate = cancelled_at ? formatDateMedium(cancelled_at) : '—'

  return (
    <>
      <button
        type="button"
        className={styles.killBanner}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="cancellation-banner"
      >
        <span className={styles.killBannerText}>
          {displayCategory} · {displayReason} · {displayDate}
        </span>
        <span className={styles.killBannerAffordance} aria-hidden="true">
          Details
        </span>
      </button>
      <ContextDrawer isOpen={open} onClose={() => setOpen(false)} title="Application not taken up">
        <div className={styles.killDrawerRow}>
          <span className={styles.killDrawerLabel}>Outcome</span>
          <span className={styles.killDrawerValue}>{displayCategory}</span>
        </div>
        <div className={styles.killDrawerRow}>
          <span className={styles.killDrawerLabel}>Reason</span>
          <span className={styles.killDrawerValue}>{displayReason}</span>
        </div>
        <div className={styles.killDrawerRow}>
          <span className={styles.killDrawerLabel}>Application</span>
          <span className={styles.killDrawerValue}>{application_number || '—'}</span>
        </div>
        <div className={styles.killDrawerRow}>
          <span className={styles.killDrawerLabel}>Cancelled at</span>
          <span className={styles.killDrawerValue}>{displayDate}</span>
        </div>
      </ContextDrawer>
    </>
  )
}
