'use client'

import React, { useState } from 'react'
import { useECLAllowance } from '@/hooks/queries/useECLAllowance'
import { CarryingAmountModal } from './CarryingAmountModal'
import { formatCurrency } from '@/lib/formatters'
import styles from './ecl-tab.module.css'

export interface ECLTabProps {
  /** Loan account ID to fetch ECL for */
  loanAccountId: string
}

/**
 * Format currency for display
 */
/**
 * Format percentage for display
 */
function formatPercent(rate: string): string {
  const num = parseFloat(rate) * 100
  return `${num.toFixed(1)}%`
}

/**
 * Format date/time for display
 */
function formatDateTime(dateString: string | undefined): string {
  if (!dateString) return '—'
  const date = new Date(dateString)
  return date.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

/**
 * Get bucket display name
 */
function getBucketDisplay(bucket: string): string {
  switch (bucket) {
    case 'current':
      return 'Current (0 DPD, Stage 1, 3% rate)'
    case 'early_arrears':
      return 'Early Arrears (1-14 DPD, Stage 1, 25% rate)'
    case 'late_arrears':
      return 'Late Arrears (15-61 DPD, Stage 2 / SICR, 55% rate)'
    case 'default':
      return 'Default (62+ DPD, Stage 3 / Credit-Impaired, 100% rate)'
    default:
      return bucket
  }
}

/**
 * ECLTab - Displays Expected Credit Loss (ECL) information.
 *
 * Shows:
 * - Current ECL allowance and delta from prior
 * - Carrying amount breakdown
 * - Calculation section (bucket, PD rate, overlay, formula)
 * - Trigger information
 * - ECL history table
 *
 * Story E2-S6: Implement ECL Tab Component
 */
export const ECLTab: React.FC<ECLTabProps> = ({ loanAccountId }) => {
  const [showCarryingAmountModal, setShowCarryingAmountModal] = useState(false)

  const {
    eclAmount,
    eclChange,
    changeDirection,
    carryingAmount,
    bucket,
    pdRate,
    overlayMultiplier,
    lgdRate,
    calculatedAt,
    triggeredBy,
    history,
    isFallback,
    isLoading,
    error,
  } = useECLAllowance({ accountId: loanAccountId })

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Loading ECL data...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <span className={styles.errorIcon}>⚠️</span>
          <span className={styles.errorText}>Failed to load ECL data</span>
        </div>
      </div>
    )
  }

  if (isFallback) {
    return (
      <div className={styles.container}>
        <div className={styles.fallback}>
          <span className={styles.fallbackIcon}>⚠️</span>
          <span className={styles.fallbackText}>
            Ledger service unavailable. ECL data cannot be displayed.
          </span>
        </div>
      </div>
    )
  }

  // Parse values for formula display
  const overlayNum = parseFloat(overlayMultiplier)

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Expected Credit Loss</h3>

      {/* Summary Cards */}
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Current ECL Allowance</span>
          <span className={styles.summaryValue}>{formatCurrency(eclAmount)}</span>
          {eclChange && changeDirection !== 'unchanged' && (
            <span
              className={`${styles.summaryChange} ${
                changeDirection === 'increase' ? styles.changeIncrease : styles.changeDecrease
              }`}
            >
              {changeDirection === 'increase' ? '↑' : '↓'} {formatCurrency(eclChange)} from last calc
            </span>
          )}
        </div>

        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Carrying Amount</span>
          <span className={styles.summaryValue}>{formatCurrency(carryingAmount)}</span>
          <span className={styles.summaryMeta}>Principal + Accrued Yield</span>
          <button
            type="button"
            className={styles.viewBreakdownLink}
            onClick={() => setShowCarryingAmountModal(true)}
          >
            View Breakdown →
          </button>
        </div>
      </div>

      {/* Carrying Amount Modal - E2-S10 */}
      <CarryingAmountModal
        accountId={loanAccountId}
        isOpen={showCarryingAmountModal}
        onClose={() => setShowCarryingAmountModal(false)}
      />

      {/* ECL Calculation */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>ECL Calculation</h4>
        <div className={styles.calculationGrid}>
          <div className={styles.calculationItem}>
            <span className={styles.calculationLabel}>Aging Bucket</span>
            <span className={styles.calculationValue}>{getBucketDisplay(bucket)}</span>
          </div>
          <div className={styles.calculationItem}>
            <span className={styles.calculationLabel}>PD Rate</span>
            <span className={styles.calculationValue}>{formatPercent(pdRate)}</span>
          </div>
          <div className={styles.calculationItem}>
            <span className={styles.calculationLabel}>Overlay Multiplier</span>
            <span className={styles.calculationValue}>{overlayNum.toFixed(2)}</span>
          </div>
          <div className={styles.calculationItem}>
            <span className={styles.calculationLabel}>LGD Rate</span>
            <span className={styles.calculationValue}>{formatPercent(lgdRate)}</span>
          </div>
        </div>

        {/* Formula */}
        <div className={styles.formula}>
          <div className={styles.formulaRow}>
            <span className={styles.formulaLabel}>ECL =</span>
            <span className={styles.formulaExpression}>
              {formatCurrency(carryingAmount)} × {formatPercent(pdRate)} × {overlayNum.toFixed(2)} × {formatPercent(lgdRate)}
            </span>
          </div>
          <div className={styles.formulaResult}>
            = <strong>{formatCurrency(eclAmount)}</strong>
          </div>
        </div>
      </div>

      {/* Trigger Information */}
      <div className={styles.triggerCard}>
        <div className={styles.triggerRow}>
          <span className={styles.triggerLabel}>Last Calculated</span>
          <span className={styles.triggerValue}>{formatDateTime(calculatedAt)}</span>
        </div>
        {triggeredBy && (
          <div className={styles.triggerRow}>
            <span className={styles.triggerLabel}>Triggered By</span>
            <span className={styles.triggerValue}>{triggeredBy.description}</span>
          </div>
        )}
      </div>

      {/* ECL History */}
      {history && history.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>ECL History</h4>
          <table className={styles.historyTable}>
            <thead>
              <tr>
                <th>Date</th>
                <th>ECL</th>
                <th>Bucket</th>
                <th>PD Rate</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 5).map((entry, index) => (
                <tr key={`${entry.calculatedAt}-${index}`}>
                  <td>{formatDateTime(entry.calculatedAt)}</td>
                  <td className={styles.amountCell}>{formatCurrency(entry.eclAmount)}</td>
                  <td>{entry.bucket}</td>
                  <td>{formatPercent(entry.pdRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Trace Link */}
      <button type="button" className={styles.traceLink}>
        Trace to Source Events →
      </button>
    </div>
  )
}
