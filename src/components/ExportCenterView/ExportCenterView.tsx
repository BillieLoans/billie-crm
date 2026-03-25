'use client'

import React, { useState, useCallback } from 'react'
import { Breadcrumb } from '@/components/Breadcrumb'
import { useExportJobs, type ExportJob, type ExportJobType, type ExportFormat } from '@/hooks/queries/useExportJobs'
import { useCreateExportJob } from '@/hooks/mutations/useCreateExportJob'
import { useRetryExport } from '@/hooks/mutations/useRetryExport'
import { useClosedPeriods } from '@/hooks/queries/useClosedPeriods'
import styles from './styles.module.css'

export interface ExportCenterViewProps {
  userId?: string
}

type WizardStep = 'type' | 'options' | 'confirm'

interface ExportWizardState {
  type: ExportJobType | null
  format: ExportFormat
  periodDate: string
  accountIds: string
  includeCalculationBreakdown: boolean
}

const EXPORT_TYPES: Array<{ type: ExportJobType; title: string; description: string; icon: string }> = [
  {
    type: 'journal_entries',
    title: 'Journal Entries',
    description: 'Export period close journal entries for GL integration',
    icon: '📊',
  },
  {
    type: 'audit_trail',
    title: 'Audit Trail',
    description: 'Export detailed calculation audit trail for accounts',
    icon: '🔍',
  },
  {
    type: 'methodology',
    title: 'ECL Methodology',
    description: 'Export ECL methodology documentation and parameters',
    icon: '📋',
  },
]

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: styles.statusPending },
  processing: { label: 'Processing', className: styles.statusProcessing },
  ready: { label: 'Ready', className: styles.statusReady },
  failed: { label: 'Failed', className: styles.statusFailed },
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Export Center View - Create and manage data exports.
 */
export const ExportCenterView: React.FC<ExportCenterViewProps> = ({ userId = 'unknown' }) => {
  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState<WizardStep>('type')
  const [wizardState, setWizardState] = useState<ExportWizardState>({
    type: null,
    format: 'csv',
    periodDate: '',
    accountIds: '',
    includeCalculationBreakdown: true,
  })

  // Check if there are pending jobs
  const hasPendingJobs = (jobs: ExportJob[]) =>
    jobs.some((j) => j.status === 'pending' || j.status === 'processing')

  // Hooks
  const { data: jobsData, isLoading: isLoadingJobs } = useExportJobs({
    userId,
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? []
      return hasPendingJobs(jobs) ? 5000 : false
    },
  })
  const { data: periodsData } = useClosedPeriods()
  const { createExportJob, isPending: isCreating } = useCreateExportJob()
  const { retryExport, isPending: isRetrying } = useRetryExport()

  // Handlers
  const openWizard = useCallback((type: ExportJobType) => {
    setWizardState({
      type,
      format: 'csv',
      periodDate: '',
      accountIds: '',
      includeCalculationBreakdown: true,
    })
    setWizardStep('options')
    setWizardOpen(true)
  }, [])

  const closeWizard = useCallback(() => {
    setWizardOpen(false)
    setWizardStep('type')
    setCreateError(null)
    setWizardState({
      type: null,
      format: 'csv',
      periodDate: '',
      accountIds: '',
      includeCalculationBreakdown: true,
    })
  }, [])

  const [createError, setCreateError] = useState<string | null>(null)

  const handleCreateExport = useCallback(async () => {
    if (!wizardState.type) return

    setCreateError(null)
    try {
      await createExportJob({
        type: wizardState.type,
        format: wizardState.format,
        createdBy: userId,
        options: {
          periodDate: wizardState.periodDate || undefined,
          accountIds: wizardState.accountIds
            ? wizardState.accountIds.split(/[\n,]/).map((id) => id.trim()).filter(Boolean)
            : undefined,
          includeCalculationBreakdown: wizardState.includeCalculationBreakdown,
        },
      })
      closeWizard()
    } catch (err) {
      setCreateError((err as Error).message || 'Failed to create export')
    }
  }, [wizardState, userId, createExportJob, closeWizard])

  const handleDownload = useCallback((job: ExportJob) => {
    if (job.downloadUrl) {
      window.open(job.downloadUrl, '_blank')
    }
  }, [])

  const handleRetry = useCallback(
    async (jobId: string) => {
      try {
        await retryExport(jobId)
      } catch {
        // Error handled by mutation
      }
    },
    [retryExport]
  )

  const renderWizardContent = () => {
    if (wizardStep === 'options') {
      if (wizardState.type === 'journal_entries') {
        return (
          <>
            <h3 className={styles.wizardSubtitle}>Export Journal Entries</h3>
            <div className={styles.fieldGroup}>
              <label htmlFor="period-date" className={styles.fieldLabel}>
                Period Date
              </label>
              <select
                id="period-date"
                className={styles.select}
                value={wizardState.periodDate}
                onChange={(e) =>
                  setWizardState((s) => ({ ...s, periodDate: e.target.value }))
                }
              >
                <option value="">Select a closed period...</option>
                {periodsData?.periods?.map((p) => (
                  <option key={p.periodDate} value={p.periodDate}>
                    {new Date(p.periodDate).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                    })}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.fieldGroup}>
              <label htmlFor="format" className={styles.fieldLabel}>
                Format
              </label>
              <div className={styles.radioGroup}>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="format"
                    value="csv"
                    checked={wizardState.format === 'csv'}
                    onChange={() => setWizardState((s) => ({ ...s, format: 'csv' }))}
                  />
                  CSV
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="format"
                    value="json"
                    checked={wizardState.format === 'json'}
                    onChange={() => setWizardState((s) => ({ ...s, format: 'json' }))}
                  />
                  JSON
                </label>
              </div>
            </div>
          </>
        )
      }

      if (wizardState.type === 'audit_trail') {
        return (
          <>
            <h3 className={styles.wizardSubtitle}>Export Audit Trail</h3>
            <div className={styles.fieldGroup}>
              <label htmlFor="account-ids" className={styles.fieldLabel}>
                Account IDs (one per line or comma-separated)
              </label>
              <textarea
                id="account-ids"
                className={styles.textarea}
                value={wizardState.accountIds}
                onChange={(e) =>
                  setWizardState((s) => ({ ...s, accountIds: e.target.value }))
                }
                rows={5}
                placeholder="ACC001&#10;ACC002&#10;ACC003"
              />
              <p className={styles.fieldHint}>
                {wizardState.accountIds
                  ? `${wizardState.accountIds.split(/[\n,]/).filter((s) => s.trim()).length} account(s)`
                  : 'Enter account IDs to export'}
              </p>
            </div>
            <div className={styles.fieldGroup}>
              <label htmlFor="format" className={styles.fieldLabel}>
                Format
              </label>
              <div className={styles.radioGroup}>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="format"
                    value="csv"
                    checked={wizardState.format === 'csv'}
                    onChange={() => setWizardState((s) => ({ ...s, format: 'csv' }))}
                  />
                  CSV
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="format"
                    value="json"
                    checked={wizardState.format === 'json'}
                    onChange={() => setWizardState((s) => ({ ...s, format: 'json' }))}
                  />
                  JSON
                </label>
              </div>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={wizardState.includeCalculationBreakdown}
                  onChange={(e) =>
                    setWizardState((s) => ({
                      ...s,
                      includeCalculationBreakdown: e.target.checked,
                    }))
                  }
                />
                Include calculation breakdown
              </label>
            </div>
          </>
        )
      }

      if (wizardState.type === 'methodology') {
        return (
          <>
            <h3 className={styles.wizardSubtitle}>Export ECL Methodology</h3>
            <p className={styles.wizardDescription}>
              Export comprehensive ECL methodology documentation including:
            </p>
            <ul className={styles.methodologyList}>
              <li>PD rate tables by aging bucket</li>
              <li>LGD assumptions</li>
              <li>Overlay multiplier history</li>
              <li>Calculation formulas</li>
            </ul>
            <div className={styles.fieldGroup}>
              <label htmlFor="format" className={styles.fieldLabel}>
                Format
              </label>
              <div className={styles.radioGroup}>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="format"
                    value="json"
                    checked={wizardState.format === 'json'}
                    onChange={() => setWizardState((s) => ({ ...s, format: 'json' }))}
                  />
                  JSON
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="format"
                    value="csv"
                    checked={wizardState.format === 'csv'}
                    onChange={() => setWizardState((s) => ({ ...s, format: 'csv' }))}
                  />
                  CSV
                </label>
              </div>
            </div>
          </>
        )
      }
    }

    if (wizardStep === 'confirm') {
      const typeName =
        EXPORT_TYPES.find((t) => t.type === wizardState.type)?.title || wizardState.type
      return (
        <>
          <h3 className={styles.wizardSubtitle}>Confirm Export</h3>
          <div className={styles.confirmSummary}>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Type:</span>
              <span className={styles.summaryValue}>{typeName}</span>
            </div>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Format:</span>
              <span className={styles.summaryValue}>{wizardState.format.toUpperCase()}</span>
            </div>
            {wizardState.periodDate && (
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Period:</span>
                <span className={styles.summaryValue}>
                  {new Date(wizardState.periodDate).toLocaleDateString()}
                </span>
              </div>
            )}
            {wizardState.accountIds && (
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Accounts:</span>
                <span className={styles.summaryValue}>
                  {wizardState.accountIds.split(/[\n,]/).filter((s) => s.trim()).length} account(s)
                </span>
              </div>
            )}
          </div>
          <p className={styles.confirmNote}>
            The export job will be queued and you can download the file when ready.
          </p>
          {createError && (
            <p className={styles.confirmNote} style={{ color: '#ef4444', marginTop: '8px' }}>
              {createError}
            </p>
          )}
        </>
      )
    }

    return null
  }

  const canProceed = () => {
    if (wizardStep === 'options') {
      if (wizardState.type === 'journal_entries') {
        return !!wizardState.periodDate
      }
      if (wizardState.type === 'audit_trail') {
        return !!wizardState.accountIds.trim()
      }
      return true // methodology doesn't require options
    }
    return true
  }

  return (
    <div className={styles.container} data-testid="export-center-view">
      <Breadcrumb items={[{ label: 'Finance', href: '/admin' }, { label: 'Export Center' }]} />

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Export Center</h1>
          <p className={styles.subtitle}>Create and manage data exports</p>
        </div>
      </div>

      {/* Export Type Cards */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Create New Export</h2>
        <div className={styles.cardGrid}>
          {EXPORT_TYPES.map((exportType) => (
            <button
              key={exportType.type}
              type="button"
              className={styles.exportCard}
              onClick={() => openWizard(exportType.type)}
              data-testid={`export-card-${exportType.type}`}
            >
              <span className={styles.cardIcon}>{exportType.icon}</span>
              <h3 className={styles.cardTitle}>{exportType.title}</h3>
              <p className={styles.cardDescription}>{exportType.description}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Recent Exports */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent Exports</h2>
        {isLoadingJobs ? (
          <p>Loading...</p>
        ) : !jobsData?.jobs?.length ? (
          <div className={styles.emptyState}>
            <p>No exports yet. Create one above to get started.</p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Created</th>
                <th>Status</th>
                <th className={styles.numericCol}>Size</th>
                <th className={styles.actionCol}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobsData.jobs.map((job) => {
                const statusInfo = STATUS_LABELS[job.status] || {
                  label: job.status,
                  className: '',
                }
                const typeName =
                  EXPORT_TYPES.find((t) => t.type === job.type)?.title || job.type
                return (
                  <tr key={job.id}>
                    <td>
                      <span className={styles.typeBadge}>
                        {typeName}
                      </span>
                    </td>
                    <td>{new Date(job.createdAt).toLocaleString()}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className={styles.numericCol}>{formatFileSize(job.sizeBytes)}</td>
                    <td className={styles.actionCol}>
                      {job.status === 'ready' && (
                        <button
                          type="button"
                          className={styles.downloadBtn}
                          onClick={() => handleDownload(job)}
                        >
                          Download
                        </button>
                      )}
                      {job.status === 'failed' && (
                        <button
                          type="button"
                          className={styles.retryBtn}
                          onClick={() => handleRetry(job.id)}
                          disabled={isRetrying}
                        >
                          Retry
                        </button>
                      )}
                      {(job.status === 'pending' || job.status === 'processing') && (
                        <span className={styles.spinner} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Export Wizard Modal */}
      {wizardOpen && (
        <>
          <div className={styles.modalOverlay} onClick={closeWizard} />
          <div className={styles.modal} role="dialog" aria-modal="true" data-testid="export-wizard">
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Create Export</h2>
              <button type="button" className={styles.closeBtn} onClick={closeWizard}>
                ×
              </button>
            </div>
            <div className={styles.modalBody}>{renderWizardContent()}</div>
            <div className={styles.modalFooter}>
              {wizardStep === 'options' && (
                <>
                  <button type="button" className={styles.cancelBtn} onClick={closeWizard}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.nextBtn}
                    onClick={() => setWizardStep('confirm')}
                    disabled={!canProceed()}
                  >
                    Next
                  </button>
                </>
              )}
              {wizardStep === 'confirm' && (
                <>
                  <button
                    type="button"
                    className={styles.backBtn}
                    onClick={() => setWizardStep('options')}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className={styles.createBtn}
                    onClick={handleCreateExport}
                    disabled={isCreating}
                    data-testid="create-export-btn"
                  >
                    {isCreating ? 'Creating...' : 'Create Export'}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default ExportCenterView
