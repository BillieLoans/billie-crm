'use client'

import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { formatCurrency } from '@/lib/formatters'
import { useClosedPeriods } from '@/hooks/queries/useClosedPeriods'
import {
  usePeriodClosePreview,
  type PeriodClosePreview,
  type PeriodCloseAnomaly,
} from '@/hooks/mutations/usePeriodClosePreview'
import { useAcknowledgeAnomaly } from '@/hooks/mutations/useAcknowledgeAnomaly'
import { useFinalizePeriodClose } from '@/hooks/mutations/useFinalizePeriodClose'
import styles from './styles.module.css'

type WizardStep = 'select' | 'preview' | 'movement' | 'anomalies' | 'finalize' | 'success'

const STEPS: { id: WizardStep; label: string; number: number }[] = [
  { id: 'select', label: 'Select Period', number: 1 },
  { id: 'preview', label: 'Preview Summary', number: 2 },
  { id: 'movement', label: 'Movement Analysis', number: 3 },
  { id: 'anomalies', label: 'Anomaly Review', number: 4 },
  { id: 'finalize', label: 'Finalize', number: 5 },
]

export interface PeriodCloseWizardProps {
  /** Current user ID for audit trail */
  userId?: string
  /** Current user name */
  userName?: string
}

/**
 * Period Close Wizard - Multi-step wizard for month-end close process.
 *
 * Steps:
 * 1. Select Period - Choose period date and generate preview
 * 2. Preview Summary - Review totals and ECL breakdown
 * 3. Movement Analysis - ECL movement from prior period
 * 4. Anomaly Review - Acknowledge any anomalies
 * 5. Finalize - Type-to-confirm and generate journals
 */
export const PeriodCloseWizard: React.FC<PeriodCloseWizardProps> = ({
  userId = 'unknown',
  userName = 'Unknown User',
}) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>('select')
  const [periodDate, setPeriodDate] = useState<string>('')
  const [preview, setPreview] = useState<PeriodClosePreview | null>(null)
  const [localAnomalies, setLocalAnomalies] = useState<PeriodCloseAnomaly[]>([])
  const [confirmText, setConfirmText] = useState('')
  const [finalizeResult, setFinalizeResult] = useState<{
    periodDate: string
    journalEntries: { id: string; type: string; amount: number }[]
    finalizedAt: string
  } | null>(null)

  // Hooks
  const { data: closedPeriodsData, isLoading: isLoadingHistory, isFallback, fallbackMessage } = useClosedPeriods()
  const { generatePreview, isPending: isGenerating, error: previewError, reset: resetPreview } = usePeriodClosePreview()
  const { acknowledgeAnomaly, isPending: isAcknowledging } = useAcknowledgeAnomaly()
  const { finalizePeriodClose, isPending: isFinalizing, error: finalizeError } = useFinalizePeriodClose()

  // Sync local anomalies when preview changes
  useEffect(() => {
    if (preview?.anomalies) {
      setLocalAnomalies(preview.anomalies)
    }
  }, [preview?.anomalies])

  // Calculate preview expiry countdown
  const [timeRemaining, setTimeRemaining] = useState<string>('')
  useEffect(() => {
    if (!preview?.expiresAt) return

    const updateTimer = () => {
      const now = new Date()
      const expiry = new Date(preview.expiresAt)
      const diff = expiry.getTime() - now.getTime()

      if (diff <= 0) {
        setTimeRemaining('Expired')
        return
      }

      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      setTimeRemaining(`${hours}h ${minutes}m`)
    }

    updateTimer()
    const interval = setInterval(updateTimer, 60_000)
    return () => clearInterval(interval)
  }, [preview?.expiresAt])

  // Calculate expected confirm text
  const expectedConfirmText = useMemo(() => {
    if (!periodDate) return ''
    const date = new Date(periodDate)
    const month = date.toLocaleString('en-US', { month: 'short' }).toUpperCase()
    const year = date.getFullYear()
    return `CLOSE ${month} ${year}`
  }, [periodDate])

  // Validation
  const validatePeriodDate = useCallback(
    (date: string): string | null => {
      if (!date) return 'Please select a period date'

      const d = new Date(date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      // Must not be in the future
      if (d > today) return 'Period date cannot be in the future'

      // Must be end of month
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      if (d.getDate() !== lastDay.getDate()) {
        return 'Period date must be the last day of the month'
      }

      // Must not already be closed
      if (closedPeriodsData?.periods?.some((p) => p.periodDate === date)) {
        return 'This period is already closed'
      }

      return null
    },
    [closedPeriodsData]
  )

  const periodError = periodDate ? validatePeriodDate(periodDate) : null

  // Generate end-of-month date options
  const periodOptions = useMemo(() => {
    const options: { value: string; label: string; disabled?: boolean }[] = []
    const now = new Date()

    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 0)
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
      const isClosed = closedPeriodsData?.periods?.some((p) => p.periodDate === value)

      options.push({ value, label, disabled: isClosed })
    }

    return options
  }, [closedPeriodsData])

  // Handlers
  const handleGeneratePreview = useCallback(async () => {
    if (!periodDate || periodError) return

    resetPreview()
    try {
      const result = await generatePreview({
        periodDate,
        requestedBy: userId,
      })
      setPreview(result)
      setCurrentStep('preview')
    } catch {
      // Error handled by mutation
    }
  }, [periodDate, periodError, generatePreview, userId, resetPreview])

  const handleAcknowledge = useCallback(
    async (anomalyId: string) => {
      if (!preview?.previewId) return

      try {
        await acknowledgeAnomaly({
          previewId: preview.previewId,
          anomalyId,
          acknowledgedBy: userId,
        })

        // Optimistically update local state
        setLocalAnomalies((prev) =>
          prev.map((a) =>
            a.id === anomalyId
              ? { ...a, acknowledged: true, acknowledgedBy: userName, acknowledgedAt: new Date().toISOString() }
              : a
          )
        )
      } catch {
        // Error handled by mutation
      }
    },
    [preview?.previewId, acknowledgeAnomaly, userId, userName]
  )

  const handleFinalize = useCallback(async () => {
    if (!preview?.previewId || confirmText !== expectedConfirmText) return

    try {
      const result = await finalizePeriodClose({
        previewId: preview.previewId,
        finalizedBy: userId,
      })

      setFinalizeResult({
        periodDate: result.periodDate,
        journalEntries: result.journalEntries.map((j) => ({
          id: j.id,
          type: j.type,
          amount: j.amount,
        })),
        finalizedAt: result.finalizedAt,
      })
      setCurrentStep('success')
    } catch {
      // Error handled by mutation
    }
  }, [preview?.previewId, confirmText, expectedConfirmText, finalizePeriodClose, userId])

  const handleStartNew = useCallback(() => {
    setCurrentStep('select')
    setPeriodDate('')
    setPreview(null)
    setLocalAnomalies([])
    setConfirmText('')
    setFinalizeResult(null)
  }, [])

  // Navigation
  const canProceed = useMemo(() => {
    switch (currentStep) {
      case 'select':
        return !!periodDate && !periodError
      case 'preview':
        return !!preview
      case 'movement':
        return !!preview
      case 'anomalies':
        return localAnomalies.every((a) => a.acknowledged) || localAnomalies.length === 0
      case 'finalize':
        return confirmText === expectedConfirmText
      default:
        return false
    }
  }, [currentStep, periodDate, periodError, preview, localAnomalies, confirmText, expectedConfirmText])

  const goNext = useCallback(() => {
    const stepOrder: WizardStep[] = ['select', 'preview', 'movement', 'anomalies', 'finalize']
    const currentIndex = stepOrder.indexOf(currentStep)
    if (currentIndex < stepOrder.length - 1) {
      setCurrentStep(stepOrder[currentIndex + 1])
    }
  }, [currentStep])

  const goBack = useCallback(() => {
    const stepOrder: WizardStep[] = ['select', 'preview', 'movement', 'anomalies', 'finalize']
    const currentIndex = stepOrder.indexOf(currentStep)
    if (currentIndex > 0) {
      setCurrentStep(stepOrder[currentIndex - 1])
    }
  }, [currentStep])

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 'select':
        return (
          <div className={styles.stepContent}>
            <div className={styles.selectPeriod}>
              <label htmlFor="period-date" className={styles.fieldLabel}>
                Select Period End Date
              </label>
              <select
                id="period-date"
                className={styles.select}
                value={periodDate}
                onChange={(e) => setPeriodDate(e.target.value)}
                data-testid="period-select"
              >
                <option value="">Choose a period...</option>
                {periodOptions.map((opt) => (
                  <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                    {opt.label}
                    {opt.disabled ? ' (Already Closed)' : ''}
                  </option>
                ))}
              </select>
              {periodError && <p className={styles.fieldError}>{periodError}</p>}
            </div>

            {closedPeriodsData?.lastClosedPeriod && (
              <div className={styles.lastClosed}>
                <span className={styles.lastClosedLabel}>Last Closed Period:</span>
                <span className={styles.lastClosedValue}>
                  {new Date(closedPeriodsData.lastClosedPeriod).toLocaleDateString('en-US', {
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </div>
            )}

            {previewError && <div className={styles.errorBox}>{previewError.message}</div>}

            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleGeneratePreview}
              disabled={!canProceed || isGenerating}
              data-testid="generate-preview-btn"
            >
              {isGenerating ? 'Generating Preview...' : 'Generate Preview'}
            </button>

            {/* Recent Closed Periods Table */}
            {!isLoadingHistory && closedPeriodsData?.periods && closedPeriodsData.periods.length > 0 && (
              <div className={styles.historySection}>
                <h3 className={styles.sectionTitle}>Recent Closed Periods</h3>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Closed</th>
                      <th>By</th>
                      <th className={styles.numericCol}>Total ECL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedPeriodsData.periods.slice(0, 6).map((period) => (
                      <tr key={period.periodDate}>
                        <td>
                          {new Date(period.periodDate).toLocaleDateString('en-US', {
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td>
                          {new Date(period.closedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </td>
                        <td>{period.closedByName || period.closedBy}</td>
                        <td className={styles.numericCol}>{formatCurrency(period.totalECLAllowance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )

      case 'preview':
        if (!preview) return null
        return (
          <div className={styles.stepContent}>
            <div className={styles.previewHeader}>
              <h3 className={styles.periodTitle}>
                {new Date(preview.periodDate).toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
              </h3>
              <span className={styles.expiryBadge} title="Preview expires after this time">
                ⏱ Expires in {timeRemaining}
              </span>
            </div>

            {/* Summary Cards */}
            <div className={styles.summaryCards}>
              <div className={styles.summaryCard}>
                <span className={styles.cardLabel}>Total Accounts</span>
                <span className={styles.cardValue}>{preview.totalAccounts.toLocaleString()}</span>
              </div>
              <div className={styles.summaryCard}>
                <span className={styles.cardLabel}>Accrued Yield</span>
                <span className={styles.cardValue}>{formatCurrency(preview.totalAccruedYield)}</span>
              </div>
              <div className={styles.summaryCard}>
                <span className={styles.cardLabel}>ECL Allowance</span>
                <span className={styles.cardValue}>{formatCurrency(preview.totalECLAllowance)}</span>
              </div>
              <div className={styles.summaryCard}>
                <span className={styles.cardLabel}>Carrying Amount</span>
                <span className={styles.cardValue}>{formatCurrency(preview.totalCarryingAmount)}</span>
              </div>
            </div>

            {/* ECL by Bucket */}
            <div className={styles.section}>
              <h4 className={styles.sectionTitle}>ECL by Bucket</h4>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Bucket</th>
                    <th className={styles.numericCol}>Accounts</th>
                    <th className={styles.numericCol}>ECL Amount</th>
                    <th className={styles.numericCol}>Carrying Amount</th>
                    <th className={styles.numericCol}>PD Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.eclByBucket.map((bucket) => (
                    <tr key={bucket.bucket}>
                      <td>{bucket.bucket}</td>
                      <td className={styles.numericCol}>{bucket.accountCount}</td>
                      <td className={styles.numericCol}>{formatCurrency(bucket.eclAmount)}</td>
                      <td className={styles.numericCol}>{formatCurrency(bucket.carryingAmount)}</td>
                      <td className={styles.numericCol}>{(bucket.pdRate * 100).toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Anomaly Warning */}
            {preview.anomalyCount > 0 && (
              <div className={styles.warningBox}>
                ⚠️ {preview.anomalyCount} anomal{preview.anomalyCount === 1 ? 'y' : 'ies'} detected. You will need to
                acknowledge all anomalies before finalizing.
              </div>
            )}

            {/* Reconciliation Status */}
            <div className={preview.reconciled ? styles.successBox : styles.warningBox}>
              {preview.reconciled ? '✓ Reconciliation check passed' : '⚠️ Reconciliation check pending'}
              {preview.reconciliationNotes && <p className={styles.notes}>{preview.reconciliationNotes}</p>}
            </div>
          </div>
        )

      case 'movement':
        if (!preview) return null
        return (
          <div className={styles.stepContent}>
            <h3 className={styles.sectionTitle}>ECL Movement Analysis</h3>

            {/* Prior vs Current */}
            <div className={styles.movementSummary}>
              <div className={styles.movementCard}>
                <span className={styles.cardLabel}>Prior Period ECL</span>
                <span className={styles.cardValue}>{formatCurrency(preview.priorPeriodECL || 0)}</span>
              </div>
              <div className={styles.movementCard}>
                <span className={styles.cardLabel}>Current Period ECL</span>
                <span className={styles.cardValue}>{formatCurrency(preview.totalECLAllowance)}</span>
              </div>
              <div className={styles.movementCard}>
                <span className={styles.cardLabel}>Net Change</span>
                <span
                  className={`${styles.cardValue} ${
                    (preview.eclChange || 0) >= 0 ? styles.changePositive : styles.changeNegative
                  }`}
                >
                  {(preview.eclChange || 0) >= 0 ? '+' : ''}
                  {formatCurrency(preview.eclChange || 0)}
                  <span className={styles.changePercent}>
                    ({(preview.eclChange || 0) >= 0 ? '+' : ''}
                    {(preview.eclChangePercent || 0).toFixed(1)}%)
                  </span>
                </span>
              </div>
            </div>

            {/* Movement by Cause */}
            {preview.movementByCause && preview.movementByCause.length > 0 && (
              <div className={styles.section}>
                <h4 className={styles.sectionTitle}>Movement by Cause</h4>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Cause</th>
                      <th className={styles.numericCol}>Accounts</th>
                      <th className={styles.numericCol}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.movementByCause.map((item) => (
                      <tr key={item.cause}>
                        <td>{item.cause}</td>
                        <td className={styles.numericCol}>{item.accountCount}</td>
                        <td className={styles.numericCol}>{formatCurrency(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Movement by Bucket */}
            {preview.movementByBucket && preview.movementByBucket.length > 0 && (
              <div className={styles.section}>
                <h4 className={styles.sectionTitle}>Movement by Bucket</h4>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Bucket</th>
                      <th className={styles.numericCol}>Moved In</th>
                      <th className={styles.numericCol}>Moved Out</th>
                      <th className={styles.numericCol}>Net Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.movementByBucket.map((item) => (
                      <tr key={item.bucket}>
                        <td>{item.bucket}</td>
                        <td className={styles.numericCol}>{item.inCount}</td>
                        <td className={styles.numericCol}>{item.outCount}</td>
                        <td className={styles.numericCol}>{formatCurrency(item.netChange)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!preview.priorPeriodECL && (
              <div className={styles.infoBox}>
                ℹ️ This is the first period close. No prior period data available for comparison.
              </div>
            )}
          </div>
        )

      case 'anomalies':
        if (!preview) return null
        const acknowledgedCount = localAnomalies.filter((a) => a.acknowledged).length
        const totalAnomalies = localAnomalies.length

        return (
          <div className={styles.stepContent}>
            <div className={styles.anomalyHeader}>
              <h3 className={styles.sectionTitle}>Anomaly Review</h3>
              <span className={styles.progressBadge}>
                Acknowledged: {acknowledgedCount} of {totalAnomalies}
              </span>
            </div>

            {totalAnomalies === 0 ? (
              <div className={styles.successBox}>✓ No anomalies detected. You may proceed to finalize.</div>
            ) : (
              <div className={styles.anomalyList}>
                {localAnomalies.map((anomaly) => (
                  <div key={anomaly.id} className={`${styles.anomalyCard} ${styles[`severity${anomaly.severity}`]}`}>
                    <div className={styles.anomalyMeta}>
                      <span className={`${styles.severityBadge} ${styles[anomaly.severity]}`}>
                        {anomaly.severity.toUpperCase()}
                      </span>
                      <span className={styles.anomalyType}>{anomaly.type.replace(/_/g, ' ')}</span>
                    </div>
                    <p className={styles.anomalyDescription}>{anomaly.description}</p>
                    {anomaly.accountId && (
                      <a
                        href={`/admin/servicing/${anomaly.accountId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.viewAccountLink}
                      >
                        View Account →
                      </a>
                    )}
                    <div className={styles.anomalyActions}>
                      {anomaly.acknowledged ? (
                        <span className={styles.acknowledgedBadge}>
                          ✓ Acknowledged by {anomaly.acknowledgedBy}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={styles.acknowledgeBtn}
                          onClick={() => handleAcknowledge(anomaly.id)}
                          disabled={isAcknowledging}
                          data-testid={`acknowledge-${anomaly.id}`}
                        >
                          {isAcknowledging ? 'Acknowledging...' : 'Acknowledge'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )

      case 'finalize':
        if (!preview) return null
        return (
          <div className={styles.stepContent}>
            <h3 className={styles.sectionTitle}>Finalize Period Close</h3>

            {/* Checklist */}
            <div className={styles.checklist}>
              <div className={styles.checkItem}>
                <span className={styles.checkIcon}>✓</span>
                <span>Preview generated for {new Date(preview.periodDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
              </div>
              <div className={styles.checkItem}>
                <span className={styles.checkIcon}>✓</span>
                <span>Summary reviewed ({preview.totalAccounts} accounts)</span>
              </div>
              <div className={styles.checkItem}>
                <span className={styles.checkIcon}>✓</span>
                <span>Movement analysis reviewed</span>
              </div>
              <div className={styles.checkItem}>
                <span className={styles.checkIcon}>✓</span>
                <span>All anomalies acknowledged ({localAnomalies.filter((a) => a.acknowledged).length} of {localAnomalies.length})</span>
              </div>
            </div>

            {/* Summary */}
            <div className={styles.finalSummary}>
              <div className={styles.summaryRow}>
                <span>Total ECL Allowance:</span>
                <strong>{formatCurrency(preview.totalECLAllowance)}</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>Total Accrued Yield:</span>
                <strong>{formatCurrency(preview.totalAccruedYield)}</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>Total Carrying Amount:</span>
                <strong>{formatCurrency(preview.totalCarryingAmount)}</strong>
              </div>
            </div>

            {/* Journal Entries Preview */}
            {preview.journalEntries && preview.journalEntries.length > 0 && (
              <div className={styles.section}>
                <h4 className={styles.sectionTitle}>Journal Entries to Generate</h4>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Description</th>
                      <th className={styles.numericCol}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.journalEntries.map((entry, idx) => (
                      <tr key={idx}>
                        <td>{entry.type}</td>
                        <td>{entry.description}</td>
                        <td className={styles.numericCol}>{formatCurrency(entry.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Type to Confirm */}
            <div className={styles.confirmSection}>
              <label htmlFor="confirm-text" className={styles.confirmLabel}>
                Type <code>{expectedConfirmText}</code> to confirm:
              </label>
              <input
                id="confirm-text"
                type="text"
                className={styles.confirmInput}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                placeholder={expectedConfirmText}
                data-testid="confirm-input"
              />
            </div>

            {finalizeError && <div className={styles.errorBox}>{finalizeError.message}</div>}

            <button
              type="button"
              className={styles.finalizeBtn}
              onClick={handleFinalize}
              disabled={!canProceed || isFinalizing}
              data-testid="finalize-btn"
            >
              {isFinalizing ? 'Finalizing...' : 'Finalize Period Close'}
            </button>
          </div>
        )

      case 'success':
        if (!finalizeResult) return null
        return (
          <div className={styles.stepContent}>
            <div className={styles.successState}>
              <div className={styles.successIcon}>✓</div>
              <h2 className={styles.successTitle}>Period Close Complete</h2>
              <p className={styles.successPeriod}>
                {new Date(finalizeResult.periodDate).toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
              <p className={styles.successTimestamp}>
                Finalized at {new Date(finalizeResult.finalizedAt).toLocaleString()}
              </p>

              {finalizeResult.journalEntries.length > 0 && (
                <div className={styles.section}>
                  <h4 className={styles.sectionTitle}>Generated Journal Entries</h4>
                  <ul className={styles.journalList}>
                    {finalizeResult.journalEntries.map((entry) => (
                      <li key={entry.id}>
                        {entry.type}: {formatCurrency(entry.amount)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className={styles.successActions}>
                <button type="button" className={styles.primaryBtn} onClick={handleStartNew}>
                  Start New Close
                </button>
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className={styles.wizard} data-testid="period-close-wizard">
      {/* Service Unavailable Warning */}
      {isFallback && (
        <div className={styles.warningBox}>
          <strong>⚠️ Ledger Service Unavailable</strong>
          <p>{fallbackMessage || 'The Accounting Ledger Service is currently unavailable. Period close history is not available.'}</p>
        </div>
      )}

      {/* Progress Indicator */}
      {currentStep !== 'success' && (
        <div className={styles.progressBar}>
          {STEPS.map((step) => {
            const stepIndex = STEPS.findIndex((s) => s.id === currentStep)
            const thisIndex = STEPS.findIndex((s) => s.id === step.id)
            const isCompleted = thisIndex < stepIndex
            const isCurrent = step.id === currentStep

            return (
              <div
                key={step.id}
                className={`${styles.progressStep} ${isCompleted ? styles.completed : ''} ${
                  isCurrent ? styles.current : ''
                }`}
              >
                <div className={styles.progressNumber}>{isCompleted ? '✓' : step.number}</div>
                <span className={styles.progressLabel}>{step.label}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Step Content */}
      {renderStepContent()}

      {/* Navigation */}
      {currentStep !== 'success' && currentStep !== 'select' && (
        <div className={styles.navigation}>
          <button
            type="button"
            className={styles.backBtn}
            onClick={goBack}
            disabled={currentStep === 'preview' && isGenerating}
          >
            ← Back
          </button>
          {currentStep !== 'finalize' && (
            <button type="button" className={styles.nextBtn} onClick={goNext} disabled={!canProceed}>
              Continue →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default PeriodCloseWizard
