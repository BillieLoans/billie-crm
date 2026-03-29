'use client'

import React, { useState, useCallback } from 'react'
import { Breadcrumb } from '@/components/Breadcrumb'
import { useECLConfig, type PDRateConfig } from '@/hooks/queries/useECLConfig'
import { useECLConfigHistory } from '@/hooks/queries/useECLConfigHistory'
import { usePendingConfigChanges, type PendingConfigChange } from '@/hooks/queries/usePendingConfigChanges'
import { useUpdateOverlay } from '@/hooks/mutations/useUpdateOverlay'
import { useUpdatePDRate } from '@/hooks/mutations/useUpdatePDRate'
import { useScheduleConfigChange } from '@/hooks/mutations/useScheduleConfigChange'
import { useCancelConfigChange } from '@/hooks/mutations/useCancelConfigChange'
import { useTriggerPortfolioRecalc } from '@/hooks/mutations/useTriggerPortfolioRecalc'
import styles from './styles.module.css'

export interface ECLConfigViewProps {
  /** Current user ID for audit trail */
  userId?: string
}

type EditModalType = 'overlay' | 'pd_rate' | null
type ModalMode = 'edit' | 'schedule'

/**
 * ECL Configuration View - Manage ECL parameters and scheduled changes.
 */
export const ECLConfigView: React.FC<ECLConfigViewProps> = ({
  userId = 'unknown',
}) => {
  // Modal state
  const [editModal, setEditModal] = useState<EditModalType>(null)
  const [modalMode, setModalMode] = useState<ModalMode>('edit')
  const [editBucket, setEditBucket] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [editReason, setEditReason] = useState('')
  const [editEffectiveDate, setEditEffectiveDate] = useState('')

  // History drawer state
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<string>('')

  // Recalc modal state
  const [recalcModalOpen, setRecalcModalOpen] = useState(false)
  const [recalcProgress, setRecalcProgress] = useState<'idle' | 'running' | 'complete' | 'error'>('idle')

  // Data hooks
  const { data: config, isLoading: isLoadingConfig, isFallback, fallbackMessage } = useECLConfig()
  const { data: pendingChanges, isLoading: isLoadingPending } = usePendingConfigChanges()
  const { data: history, isLoading: isLoadingHistory } = useECLConfigHistory({
    limit: 50,
    parameter: historyFilter || undefined,
    enabled: historyOpen,
  })

  // Mutation hooks
  const { updateOverlay, isPending: isUpdatingOverlay } = useUpdateOverlay()
  const { updatePDRate, isPending: isUpdatingPDRate, error: _pdRateError } = useUpdatePDRate()
  const { scheduleChange, isPending: isScheduling } = useScheduleConfigChange()
  const { cancelChange, isPending: isCancelling } = useCancelConfigChange()
  const { triggerRecalc, isPending: isRecalculating } = useTriggerPortfolioRecalc()

  // Handlers
  const openEditModal = useCallback((type: EditModalType, bucket?: string) => {
    setEditModal(type)
    setModalMode('edit')
    setEditBucket(bucket || null)
    setEditReason('')
    setEditEffectiveDate('')

    if (type === 'overlay' && config) {
      setEditValue(String(config.overlayMultiplier))
    } else if (type === 'pd_rate' && bucket && config) {
      const pdRate = config.pdRates.find((r) => r.bucket === bucket)
      setEditValue(pdRate ? String(pdRate.rate * 100) : '0')
    }
  }, [config])

  const closeEditModal = useCallback(() => {
    setEditModal(null)
    setEditBucket(null)
    setEditValue('')
    setEditReason('')
    setEditEffectiveDate('')
  }, [])

  const handleApplyNow = useCallback(async () => {
    if (!editModal) return

    try {
      if (editModal === 'overlay') {
        await updateOverlay({
          value: parseFloat(editValue),
          updatedBy: userId,
          reason: editReason || undefined,
        })
      } else if (editModal === 'pd_rate' && editBucket) {
        console.log('[ECL Config] Updating PD rate:', {
          bucket: editBucket,
          rate: parseFloat(editValue) / 100,
          updatedBy: userId,
        })
        await updatePDRate({
          bucket: editBucket,
          rate: parseFloat(editValue) / 100,
          updatedBy: userId,
          reason: editReason || undefined,
        })
        console.log('[ECL Config] PD rate update completed')
      }
      closeEditModal()
    } catch (error) {
      // Log error for debugging
      console.error('[ECL Config] Error applying change:', error)
      // Error handled by mutation - it will be available in mutation.error
    }
  }, [editModal, editValue, editBucket, editReason, userId, updateOverlay, updatePDRate, closeEditModal])

  const handleSchedule = useCallback(async () => {
    if (!editModal || !editEffectiveDate) return

    try {
      await scheduleChange({
        parameter: editModal === 'overlay' ? 'overlay_multiplier' : 'pd_rate',
        bucket: editBucket || undefined,
        newValue: editModal === 'overlay' ? parseFloat(editValue) : parseFloat(editValue) / 100,
        effectiveDate: editEffectiveDate,
        createdBy: userId,
        reason: editReason || undefined,
      })
      closeEditModal()
    } catch {
      // Error handled by mutation
    }
  }, [editModal, editValue, editBucket, editReason, editEffectiveDate, userId, scheduleChange, closeEditModal])

  const handleCancelPending = useCallback(async (changeId: string) => {
    try {
      await cancelChange({
        changeId,
        cancelledBy: userId,
      })
    } catch {
      // Error handled by mutation
    }
  }, [cancelChange, userId])

  const handleRecalc = useCallback(async () => {
    setRecalcProgress('running')
    try {
      await triggerRecalc({ triggeredBy: userId })
      setRecalcProgress('complete')
      setTimeout(() => {
        setRecalcModalOpen(false)
        setRecalcProgress('idle')
      }, 2000)
    } catch {
      setRecalcProgress('error')
    }
  }, [triggerRecalc, userId])

  const getCurrentValue = useCallback((param: string, bucket?: string) => {
    if (!config) return 0
    if (param === 'overlay_multiplier') return config.overlayMultiplier
    if (param === 'pd_rate' && bucket) {
      const pdRate = config.pdRates.find((r) => r.bucket === bucket)
      return pdRate?.rate || 0
    }
    return 0
  }, [config])

  // Loading state
  if (isLoadingConfig) {
    return (
      <div className={styles.container}>
        <Breadcrumb items={[{ label: 'Finance', href: '/admin' }, { label: 'ECL Configuration' }]} />
        <div className={styles.loadingState}>Loading configuration...</div>
      </div>
    )
  }

  return (
    <div className={styles.container} data-testid="ecl-config-view">
      <Breadcrumb items={[{ label: 'Finance', href: '/admin' }, { label: 'ECL Configuration' }]} />

      {/* Service Unavailable Warning */}
      {isFallback && (
        <div className={styles.warningBox}>
          <strong>⚠️ Ledger Service Unavailable</strong>
          <p>{fallbackMessage || 'The Accounting Ledger Service is currently unavailable. Displaying default configuration values.'}</p>
        </div>
      )}

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>ECL Configuration</h1>
          <p className={styles.subtitle}>Manage overlay multiplier, PD rates, and scheduled changes</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.historyBtn}
            onClick={() => setHistoryOpen(true)}
            data-testid="history-btn"
          >
            📋 History
          </button>
          <button
            type="button"
            className={styles.recalcBtn}
            onClick={() => setRecalcModalOpen(true)}
            data-testid="recalc-btn"
          >
            🔄 Recalculate ECL
          </button>
        </div>
      </div>

      {/* Current Configuration */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Current Configuration</h2>

        {/* Overlay Multiplier */}
        <div className={styles.configCard}>
          <div className={styles.configHeader}>
            <div>
              <h3 className={styles.configLabel}>Overlay Multiplier</h3>
              <p className={styles.configDescription}>
                Applied to all ECL calculations for economic adjustments
              </p>
            </div>
            <button
              type="button"
              className={styles.editBtn}
              onClick={() => openEditModal('overlay')}
              data-testid="edit-overlay-btn"
            >
              Edit
            </button>
          </div>
          <div className={styles.configValue}>
            <span className={styles.valueDisplay}>{config?.overlayMultiplier.toFixed(2)}x</span>
            <div className={styles.sliderContainer}>
              <div
                className={styles.sliderFill}
                style={{ width: `${((config?.overlayMultiplier || 1) - 0.5) / 1.5 * 100}%` }}
              />
            </div>
            <span className={styles.sliderLabels}>
              <span key="0.5x">0.5x</span>
              <span key="1.0x">1.0x</span>
              <span key="1.5x">1.5x</span>
              <span key="2.0x">2.0x</span>
            </span>
          </div>
          {config?.overlayUpdatedAt && (
            <p className={styles.lastUpdated}>
              Last updated: {new Date(config.overlayUpdatedAt).toLocaleString()} by{' '}
              {config.overlayUpdatedByName || config.overlayUpdatedBy}
            </p>
          )}
        </div>

        {/* PD Rates Table */}
        <div className={styles.configCard}>
          <div className={styles.configHeader}>
            <div>
              <h3 className={styles.configLabel}>Probability of Default (PD) Rates</h3>
              <p className={styles.configDescription}>
                PD rates by aging bucket for ECL calculation
              </p>
            </div>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Bucket</th>
                <th className={styles.numericCol}>PD Rate</th>
                <th>Last Updated</th>
                <th>Updated By</th>
                <th className={styles.actionCol}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {config?.pdRates.map((rate: PDRateConfig) => {
                // Get display name for bucket
                const getBucketDisplayName = (bucket: string): string => {
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

                return (
                  <tr key={rate.bucket}>
                    <td>{getBucketDisplayName(rate.bucket)}</td>
                    <td className={styles.numericCol}>{(rate.rate * 100).toFixed(2)}%</td>
                    <td>{rate.updatedAt ? new Date(rate.updatedAt).toLocaleDateString() : '-'}</td>
                    <td>{rate.updatedByName || rate.updatedBy || '-'}</td>
                    <td className={styles.actionCol}>
                      <button
                        type="button"
                        className={styles.editBtnSmall}
                        onClick={() => openEditModal('pd_rate', rate.bucket)}
                        data-testid={`edit-pd-${rate.bucket}`}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* LGD Display */}
        {config?.lgd !== undefined && (
          <div className={styles.configCard}>
            <div className={styles.configHeader}>
              <div>
                <h3 className={styles.configLabel}>Loss Given Default (LGD)</h3>
                <p className={styles.configDescription}>Fixed LGD rate for all calculations</p>
              </div>
            </div>
            <div className={styles.configValue}>
              <span className={styles.valueDisplay}>{(config.lgd * 100).toFixed(0)}%</span>
            </div>
          </div>
        )}
      </section>

      {/* Scheduled Changes */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Scheduled Changes</h2>
        </div>

        {isLoadingPending ? (
          <p>Loading...</p>
        ) : !pendingChanges?.changes?.length ? (
          <div className={styles.emptyState}>
            <p>No scheduled changes</p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Effective Date</th>
                <th>Parameter</th>
                <th className={styles.numericCol}>Current</th>
                <th className={styles.numericCol}>New Value</th>
                <th>Created By</th>
                <th className={styles.actionCol}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingChanges.changes.map((change: PendingConfigChange) => (
                <tr key={change.id}>
                  <td>{new Date(change.effectiveDate).toLocaleDateString()}</td>
                  <td>
                    {change.parameter === 'overlay_multiplier'
                      ? 'Overlay Multiplier'
                      : change.parameter === 'pd_rate'
                        ? `PD Rate (${change.bucket})`
                        : 'LGD'}
                  </td>
                  <td className={styles.numericCol}>
                    {change.parameter === 'overlay_multiplier'
                      ? `${change.currentValue.toFixed(2)}x`
                      : `${(change.currentValue * 100).toFixed(2)}%`}
                  </td>
                  <td className={styles.numericCol}>
                    {change.parameter === 'overlay_multiplier'
                      ? `${change.newValue.toFixed(2)}x`
                      : `${(change.newValue * 100).toFixed(2)}%`}
                  </td>
                  <td>{change.createdByName || change.createdBy}</td>
                  <td className={styles.actionCol}>
                    <button
                      type="button"
                      className={styles.cancelBtn}
                      onClick={() => handleCancelPending(change.id)}
                      disabled={isCancelling}
                      data-testid={`cancel-${change.id}`}
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Edit Modal */}
      {editModal && (
        <>
          <div className={styles.modalOverlay} onClick={closeEditModal} />
          <div className={styles.modal} role="dialog" aria-modal="true" data-testid="edit-modal">
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {modalMode === 'edit' ? 'Edit' : 'Schedule'}{' '}
                {editModal === 'overlay' ? 'Overlay Multiplier' : `PD Rate (${editBucket})`}
              </h2>
              <button type="button" className={styles.closeBtn} onClick={closeEditModal}>
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {/* Mode Toggle */}
              <div className={styles.modeToggle}>
                <button
                  type="button"
                  className={`${styles.modeBtn} ${modalMode === 'edit' ? styles.active : ''}`}
                  onClick={() => setModalMode('edit')}
                >
                  Apply Now
                </button>
                <button
                  type="button"
                  className={`${styles.modeBtn} ${modalMode === 'schedule' ? styles.active : ''}`}
                  onClick={() => setModalMode('schedule')}
                >
                  Schedule for Later
                </button>
              </div>

              {/* Current Value */}
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Current Value</label>
                <p className={styles.currentValue}>
                  {editModal === 'overlay'
                    ? `${config?.overlayMultiplier.toFixed(2)}x`
                    : `${(getCurrentValue('pd_rate', editBucket || undefined) * 100).toFixed(2)}%`}
                </p>
              </div>

              {/* New Value */}
              <div className={styles.fieldGroup}>
                <label htmlFor="new-value" className={styles.fieldLabel}>
                  New Value {editModal === 'pd_rate' && '(%)'}
                </label>
                <input
                  id="new-value"
                  type="number"
                  step={editModal === 'overlay' ? '0.01' : '0.1'}
                  className={styles.input}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  data-testid="new-value-input"
                />
              </div>

              {/* Effective Date (schedule mode) */}
              {modalMode === 'schedule' && (
                <div className={styles.fieldGroup}>
                  <label htmlFor="effective-date" className={styles.fieldLabel}>
                    Effective Date
                  </label>
                  <input
                    id="effective-date"
                    type="date"
                    className={styles.input}
                    value={editEffectiveDate}
                    onChange={(e) => setEditEffectiveDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    data-testid="effective-date-input"
                  />
                </div>
              )}

              {/* Reason */}
              <div className={styles.fieldGroup}>
                <label htmlFor="reason" className={styles.fieldLabel}>
                  Reason for Change
                </label>
                <textarea
                  id="reason"
                  className={styles.textarea}
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Enter reason for this change..."
                  rows={3}
                  data-testid="reason-input"
                />
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button type="button" className={styles.cancelModalBtn} onClick={closeEditModal}>
                Cancel
              </button>
              {modalMode === 'edit' ? (
                <button
                  type="button"
                  className={styles.applyBtn}
                  onClick={handleApplyNow}
                  disabled={isUpdatingOverlay || isUpdatingPDRate || !editValue}
                  data-testid="apply-btn"
                >
                  {isUpdatingOverlay || isUpdatingPDRate ? 'Applying...' : 'Apply Now'}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.scheduleBtn}
                  onClick={handleSchedule}
                  disabled={isScheduling || !editValue || !editEffectiveDate}
                  data-testid="schedule-btn"
                >
                  {isScheduling ? 'Scheduling...' : 'Schedule Change'}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* History Drawer */}
      <div
        className={`${styles.drawerOverlay} ${historyOpen ? styles.open : ''}`}
        onClick={() => setHistoryOpen(false)}
      />
      <div className={`${styles.drawer} ${historyOpen ? styles.open : ''}`} role="dialog" aria-modal="true">
        <div className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>Configuration History</h2>
          <button type="button" className={styles.closeBtn} onClick={() => setHistoryOpen(false)}>
            ×
          </button>
        </div>
        <div className={styles.drawerContent}>
          {/* Filter */}
          <div className={styles.historyFilter}>
            <select
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="">All Parameters</option>
              <option value="overlay_multiplier">Overlay Multiplier</option>
              <option value="pd_rate">PD Rates</option>
              <option value="lgd">LGD</option>
            </select>
          </div>

          {/* History Table */}
          {isLoadingHistory ? (
            <p>Loading...</p>
          ) : !history?.entries?.length ? (
            <p className={styles.emptyState}>No history found</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Parameter</th>
                  <th className={styles.numericCol}>Old</th>
                  <th className={styles.numericCol}>New</th>
                  <th>Changed By</th>
                </tr>
              </thead>
              <tbody>
                {history.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.timestamp).toLocaleString()}</td>
                    <td>
                      {entry.parameter === 'overlay_multiplier'
                        ? 'Overlay'
                        : entry.parameter === 'pd_rate'
                          ? `PD (${entry.bucket})`
                          : 'LGD'}
                    </td>
                    <td className={styles.numericCol}>
                      {entry.parameter === 'overlay_multiplier'
                        ? `${entry.oldValue.toFixed(2)}x`
                        : `${(entry.oldValue * 100).toFixed(2)}%`}
                    </td>
                    <td className={styles.numericCol}>
                      {entry.parameter === 'overlay_multiplier'
                        ? `${entry.newValue.toFixed(2)}x`
                        : `${(entry.newValue * 100).toFixed(2)}%`}
                    </td>
                    <td>{entry.changedByName || entry.changedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Recalc Modal */}
      {recalcModalOpen && (
        <>
          <div className={styles.modalOverlay} onClick={() => setRecalcModalOpen(false)} />
          <div className={styles.modal} role="dialog" aria-modal="true" data-testid="recalc-modal">
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Recalculate Portfolio ECL</h2>
              <button type="button" className={styles.closeBtn} onClick={() => setRecalcModalOpen(false)}>
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {recalcProgress === 'idle' && (
                <>
                  <div className={styles.warningBox}>
                    ⚠️ This will recalculate ECL for all accounts in the portfolio. This may take several
                    minutes depending on portfolio size.
                  </div>
                  <p>Are you sure you want to proceed?</p>
                </>
              )}
              {recalcProgress === 'running' && (
                <div className={styles.progressState}>
                  <div className={styles.spinner} />
                  <p>Recalculating ECL...</p>
                </div>
              )}
              {recalcProgress === 'complete' && (
                <div className={styles.successBox}>✓ Recalculation completed successfully</div>
              )}
              {recalcProgress === 'error' && (
                <div className={styles.errorBox}>Failed to start recalculation. Please try again.</div>
              )}
            </div>
            <div className={styles.modalFooter}>
              {recalcProgress === 'idle' && (
                <>
                  <button
                    type="button"
                    className={styles.cancelModalBtn}
                    onClick={() => setRecalcModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.recalcConfirmBtn}
                    onClick={handleRecalc}
                    disabled={isRecalculating}
                    data-testid="confirm-recalc-btn"
                  >
                    Start Recalculation
                  </button>
                </>
              )}
              {recalcProgress === 'error' && (
                <button
                  type="button"
                  className={styles.recalcConfirmBtn}
                  onClick={handleRecalc}
                  disabled={isRecalculating}
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default ECLConfigView
