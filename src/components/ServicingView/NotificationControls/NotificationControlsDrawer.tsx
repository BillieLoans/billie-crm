'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { ContextDrawer } from '@/components/ui/ContextDrawer/ContextDrawer'
import { useNotificationSuppression } from '@/hooks/queries/useNotificationSuppression'
import { useSetNotificationSuppression } from '@/hooks/mutations/useSetNotificationSuppression'
import { useClearNotificationSuppression } from '@/hooks/mutations/useClearNotificationSuppression'
import {
  SUPPRESSION_MODE_DESCRIPTIONS,
  type SuppressionMode,
} from '@/lib/notifications/suppression'
import styles from './styles.module.css'

export interface NotificationControlsDrawerProps {
  isOpen: boolean
  onClose: () => void
  /** Platform business-key customer ID (e.g. "cust_abc"). */
  customerId: string
  customerName?: string
}

type ExpiryPreset = 'indefinite' | '30d' | '60d' | 'custom'

const MODE_OPTIONS: { mode: SuppressionMode; title: string; recommended?: boolean }[] = [
  { mode: 'non_essential', title: 'Pause non-essential (servicing + marketing)', recommended: true },
  { mode: 'marketing_only', title: 'Pause marketing only' },
  { mode: 'all', title: 'Pause everything (incl. auth)' },
]

function addDaysIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(23, 59, 59, 0)
  return d.toISOString()
}

function formatHumanDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export const NotificationControlsDrawer: React.FC<NotificationControlsDrawerProps> = ({
  isOpen,
  onClose,
  customerId,
  customerName,
}) => {
  const { suppression, isActive, isExpired } = useNotificationSuppression(customerId)
  const { setSuppressionAsync, isPending: isSetting } = useSetNotificationSuppression()
  const { clearSuppressionAsync, isPending: isClearing } = useClearNotificationSuppression()

  const [mode, setMode] = useState<SuppressionMode>('non_essential')
  const [reason, setReason] = useState('')
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>('30d')
  const [customDate, setCustomDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)

  // Reset form state when the drawer opens, seeded from current suppression if any.
  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setConfirmingClear(false)
    if (isActive && suppression) {
      setMode((suppression.mode as SuppressionMode | null) ?? 'non_essential')
      setReason(suppression.reason || '')
      if (suppression.expiresAt) {
        setExpiryPreset('custom')
        setCustomDate(suppression.expiresAt.slice(0, 10))
      } else {
        setExpiryPreset('indefinite')
        setCustomDate('')
      }
    } else {
      setMode('non_essential')
      setReason('')
      setExpiryPreset('30d')
      setCustomDate('')
    }
  }, [isOpen, isActive, suppression])

  const resolvedExpiry = useMemo<string | null>(() => {
    if (expiryPreset === 'indefinite') return null
    if (expiryPreset === '30d') return addDaysIso(30)
    if (expiryPreset === '60d') return addDaysIso(60)
    if (expiryPreset === 'custom' && customDate) {
      // Treat custom date as end-of-day UTC.
      const iso = new Date(`${customDate}T23:59:59Z`).toISOString()
      return iso
    }
    return null
  }, [expiryPreset, customDate])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    const trimmedReason = reason.trim()
    if (trimmedReason.length === 0) {
      setError('Reason is required.')
      return
    }
    if (expiryPreset === 'custom' && !customDate) {
      setError('Pick an expiry date or choose a preset.')
      return
    }

    try {
      await setSuppressionAsync({
        customerId,
        mode,
        reason: trimmedReason,
        expiresAt: resolvedExpiry,
      })
      onClose()
    } catch {
      // The hook surfaces a toast; keep the drawer open so the user can retry.
    }
  }

  const handleRequestClear = () => {
    setConfirmingClear(true)
  }

  const handleConfirmClear = async () => {
    try {
      await clearSuppressionAsync({ customerId })
      onClose()
    } catch {
      // Toast handled in the hook
    } finally {
      setConfirmingClear(false)
    }
  }

  const isBusy = isSetting || isClearing
  const title = customerName
    ? `Notification controls — ${customerName}`
    : 'Notification controls'

  return (
    <ContextDrawer isOpen={isOpen} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className={styles.drawerForm}>
        {suppression && (isActive || isExpired) && (
          <div
            className={`${styles.currentStateCard} ${
              isActive ? styles.currentStateCardActive : styles.currentStateCardExpired
            }`}
            data-testid="suppression-current-state"
          >
            <div className={styles.currentStateTitle}>
              Current suppression
              {isExpired && <span className={styles.expiredBadge}>Expired</span>}
            </div>
            <div className={styles.currentStateBody}>
              <strong>Mode:</strong> {suppression.mode ?? '—'}
              {suppression.reason && (
                <>
                  {' · '}
                  <strong>Reason:</strong> {suppression.reason}
                </>
              )}
            </div>
            <div className={styles.currentStateMeta}>
              Set by {suppression.setBy || 'unknown'} · {formatHumanDate(suppression.setAt)} · expires{' '}
              {suppression.expiresAt ? formatHumanDate(suppression.expiresAt) : 'indefinite'}
            </div>
          </div>
        )}

        <fieldset className={styles.field}>
          <legend className={styles.fieldLabel}>Mode</legend>
          <div className={styles.modeList} role="radiogroup" aria-label="Suppression mode">
            {MODE_OPTIONS.map((option) => {
              const isSelected = mode === option.mode
              return (
                <label
                  key={option.mode}
                  className={`${styles.modeOption} ${isSelected ? styles.modeOptionActive : ''}`}
                >
                  <input
                    type="radio"
                    name="suppression-mode"
                    value={option.mode}
                    checked={isSelected}
                    onChange={() => setMode(option.mode)}
                    className={styles.modeRadio}
                    disabled={isBusy}
                  />
                  <div className={styles.modeOptionBody}>
                    <div className={styles.modeOptionTitle}>
                      {option.title}
                      {option.recommended ? ' · Recommended' : ''}
                    </div>
                    <div className={styles.modeOptionDescription}>
                      {SUPPRESSION_MODE_DESCRIPTIONS[option.mode]}
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        </fieldset>

        <div className={styles.field}>
          <label htmlFor="suppression-reason" className={styles.fieldLabel}>
            Reason
          </label>
          <textarea
            id="suppression-reason"
            className={styles.reasonTextarea}
            placeholder="e.g. Hardship plan #4521, complaint resolution, legal hold"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isBusy}
            maxLength={500}
            required
            data-testid="suppression-reason"
          />
          <div className={styles.fieldHint}>Audit-only. Visible to other agents.</div>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Expires</span>
          <div className={styles.expiryRow}>
            {(
              [
                { value: 'indefinite' as const, label: 'Indefinite' },
                { value: '30d' as const, label: '30 days' },
                { value: '60d' as const, label: '60 days' },
                { value: 'custom' as const, label: 'Custom date' },
              ]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`${styles.expiryChip} ${
                  expiryPreset === opt.value ? styles.expiryChipActive : ''
                }`}
                onClick={() => setExpiryPreset(opt.value)}
                disabled={isBusy}
                data-testid={`suppression-expiry-${opt.value}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {expiryPreset === 'custom' && (
            <input
              type="date"
              className={styles.expiryDate}
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              disabled={isBusy}
              min={new Date().toISOString().slice(0, 10)}
              required
            />
          )}
        </div>

        {error && <div className={styles.fieldError}>{error}</div>}

        <div className={styles.drawerFooter}>
          {isActive && !confirmingClear && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={handleRequestClear}
              disabled={isBusy}
              data-testid="suppression-clear-btn"
            >
              Turn notifications back on
            </button>
          )}
          <div className={styles.primaryActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={onClose}
              disabled={isBusy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={isBusy}
              data-testid="suppression-submit-btn"
            >
              {isSetting ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </div>

        {confirmingClear && (
          <div className={styles.reenableConfirm}>
            <span className={styles.reenableConfirmText}>
              This customer will start receiving notifications again immediately. Continue?
            </span>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={() => setConfirmingClear(false)}
              disabled={isClearing}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={handleConfirmClear}
              disabled={isClearing}
              data-testid="suppression-clear-confirm-btn"
            >
              {isClearing ? 'Re-enabling…' : 'Yes, re-enable'}
            </button>
          </div>
        )}
      </form>
    </ContextDrawer>
  )
}
