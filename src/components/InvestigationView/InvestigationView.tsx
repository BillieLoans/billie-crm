'use client'

import React, { useState, useCallback } from 'react'
import { Breadcrumb } from '@/components/Breadcrumb'
import { useEventHistory } from '@/hooks/queries/useEventHistory'
import { useTraceECL } from '@/hooks/queries/useTraceECL'
import { useTraceAccrual } from '@/hooks/queries/useTraceAccrual'
import { useBatchQuery, type BatchQueryAccountResult } from '@/hooks/mutations/useBatchQuery'
import { useRandomSample } from '@/hooks/mutations/useRandomSample'
import styles from './styles.module.css'

export interface InvestigationViewProps {
  userId?: string
  /** Initial account ID to search (from URL query param) */
  initialAccountId?: string
  /** Initial tab to show (from URL query param) */
  initialTab?: Tab
  /** Initial stream filter for events tab (from URL query param) */
  initialStreamFilter?: string
}

type Tab = 'events' | 'ecl-trace' | 'accrual-trace'

/**
 * Investigation View - Event history and traceability tools.
 */
export const InvestigationView: React.FC<InvestigationViewProps> = ({ 
  userId: _userId,
  initialAccountId,
  initialTab,
  initialStreamFilter,
}) => {
  // Account lookup state
  const [accountId, setAccountId] = useState(initialAccountId || '')
  const [searchedAccountId, setSearchedAccountId] = useState(initialAccountId || '')
  const [activeTab, setActiveTab] = useState<Tab>(initialTab || 'events')

  // Batch query modal state
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [batchAccountIds, setBatchAccountIds] = useState('')
  const [batchIncludeBalance, setBatchIncludeBalance] = useState(true)
  const [batchIncludeECL, setBatchIncludeECL] = useState(true)
  const [batchIncludeAccrual, setBatchIncludeAccrual] = useState(false)
  const [batchResults, setBatchResults] = useState<BatchQueryAccountResult[] | null>(null)

  // Random sample modal state
  const [sampleModalOpen, setSampleModalOpen] = useState(false)
  const [sampleSize, setSampleSize] = useState('100')
  const [sampleBucket, setSampleBucket] = useState('')
  const [sampleMinECL, setSampleMinECL] = useState('')
  const [sampleMaxECL, setSampleMaxECL] = useState('')
  const [sampleSeed, setSampleSeed] = useState('')
  const [sampleResults, setSampleResults] = useState<string[] | null>(null)

  // Event filter state
  const [eventStreamFilter, setEventStreamFilter] = useState(initialStreamFilter || '')
  const [eventTypeFilter, setEventTypeFilter] = useState('')
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null)

  // Hooks - only query when there's a searched account
  const { data: eventsData, isLoading: isLoadingEvents } = useEventHistory({
    accountId: searchedAccountId,
    limit: 50,
    stream: eventStreamFilter || undefined,
    eventType: eventTypeFilter || undefined,
    enabled: !!searchedAccountId && activeTab === 'events',
  })

  const { data: eclTrace, isLoading: isLoadingECL } = useTraceECL(
    searchedAccountId,
    !!searchedAccountId && activeTab === 'ecl-trace'
  )

  const { data: accrualTrace, isLoading: isLoadingAccrual } = useTraceAccrual(
    searchedAccountId,
    !!searchedAccountId && activeTab === 'accrual-trace'
  )

  const { batchQuery, isPending: isBatchQuerying } = useBatchQuery()
  const { generateSample, isPending: isGeneratingSample } = useRandomSample()

  // Handlers
  const handleSearch = useCallback(() => {
    if (accountId.trim()) {
      setSearchedAccountId(accountId.trim())
      setActiveTab('events')
    }
  }, [accountId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSearch()
      }
    },
    [handleSearch]
  )

  const handleBatchQuery = useCallback(async () => {
    const ids = batchAccountIds
      .split(/[\n,]/)
      .map((id) => id.trim())
      .filter(Boolean)

    if (ids.length === 0) return

    try {
      const result = await batchQuery({
        accountIds: ids,
        includeBalance: batchIncludeBalance,
        includeECL: batchIncludeECL,
        includeAccrual: batchIncludeAccrual,
      })
      setBatchResults(result.results)
    } catch {
      // Error handled by mutation
    }
  }, [batchAccountIds, batchIncludeBalance, batchIncludeECL, batchIncludeAccrual, batchQuery])

  const handleGenerateSample = useCallback(async () => {
    try {
      const result = await generateSample({
        sampleSize: parseInt(sampleSize, 10) || 100,
        seed: sampleSeed ? parseInt(sampleSeed, 10) : undefined,
        filters: {
          bucket: sampleBucket || undefined,
          minECL: sampleMinECL ? parseFloat(sampleMinECL) : undefined,
          maxECL: sampleMaxECL ? parseFloat(sampleMaxECL) : undefined,
        },
      })
      setSampleResults(result.accountIds)
    } catch {
      // Error handled by mutation
    }
  }, [sampleSize, sampleSeed, sampleBucket, sampleMinECL, sampleMaxECL, generateSample])

  const exportBatchToCSV = useCallback(() => {
    if (!batchResults) return

    const headers = ['Account ID', 'Found', 'Balance', 'ECL', 'DPD', 'Bucket']
    const rows = batchResults.map((r) => [
      r.accountId,
      r.found ? 'Yes' : 'No',
      r.balance?.total?.toFixed(2) || '',
      r.ecl?.amount?.toFixed(2) || '',
      r.aging?.dpd?.toString() || '',
      r.aging?.bucket || '',
    ])

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `batch-query-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [batchResults])

  const exportSampleToCSV = useCallback(() => {
    if (!sampleResults) return

    const csv = ['Account ID', ...sampleResults].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `random-sample-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [sampleResults])

  const renderEventsTab = () => (
    <div className={styles.tabContent}>
      {/* Filters */}
      <div className={styles.eventFilters}>
        <select
          className={styles.filterSelect}
          value={eventStreamFilter}
          onChange={(e) => setEventStreamFilter(e.target.value)}
        >
          <option value="">All Streams</option>
          <option value="loan-account">Loan Account</option>
          <option value="ecl">ECL</option>
          <option value="accrual">Accrual</option>
          <option value="payment">Payment</option>
        </select>
        <select
          className={styles.filterSelect}
          value={eventTypeFilter}
          onChange={(e) => setEventTypeFilter(e.target.value)}
        >
          <option value="">All Event Types</option>
          <option value="disbursed">Disbursed</option>
          <option value="payment_received">Payment Received</option>
          <option value="ecl_recalculated">ECL Recalculated</option>
          <option value="accrual_posted">Accrual Posted</option>
        </select>
      </div>

      {/* Events Table */}
      {isLoadingEvents ? (
        <p>Loading events...</p>
      ) : !eventsData?.events?.length ? (
        <div className={styles.emptyState}>No events found</div>
      ) : (
        <div className={styles.eventsContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Stream</th>
                <th>Event Type</th>
                <th>Version</th>
                <th className={styles.actionCol}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {eventsData.events.map((event) => (
                <tr
                  key={event.id}
                  className={selectedEvent === event.id ? styles.selectedRow : ''}
                >
                  <td>{new Date(event.timestamp).toLocaleString()}</td>
                  <td>
                    <span className={styles.streamBadge}>{event.stream}</span>
                  </td>
                  <td>{event.eventType}</td>
                  <td>{event.version}</td>
                  <td className={styles.actionCol}>
                    <button
                      type="button"
                      className={styles.viewBtn}
                      onClick={() =>
                        setSelectedEvent(selectedEvent === event.id ? null : event.id)
                      }
                    >
                      {selectedEvent === event.id ? 'Hide' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {selectedEvent && (
            <div className={styles.eventDetail}>
              <h4>Event Data</h4>
              <pre className={styles.jsonViewer}>
                {JSON.stringify(
                  eventsData.events.find((e) => e.id === selectedEvent)?.data,
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )

  const renderECLTraceTab = () => (
    <div className={styles.tabContent}>
      {isLoadingECL ? (
        <p>Loading ECL trace...</p>
      ) : !eclTrace ? (
        <div className={styles.emptyState}>No ECL data found</div>
      ) : (
        <div className={styles.traceContainer}>
          {/* Current State */}
          <div className={styles.traceSection}>
            <h3 className={styles.traceSectionTitle}>Current ECL State</h3>
            <div className={styles.traceCards}>
              <div className={styles.traceCard}>
                <span className={styles.traceLabel}>ECL Amount</span>
                <span className={styles.traceValue}>${eclTrace.currentECL?.toFixed(2) ?? '—'}</span>
              </div>
              <div className={styles.traceCard}>
                <span className={styles.traceLabel}>Carrying Amount</span>
                <span className={styles.traceValue}>${eclTrace.carryingAmount?.toFixed(2) ?? '—'}</span>
              </div>
              <div className={styles.traceCard}>
                <span className={styles.traceLabel}>Calculation Date</span>
                <span className={styles.traceValue}>
                  {eclTrace.calculationDate ? new Date(eclTrace.calculationDate).toLocaleDateString() : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Trigger Info */}
          {eclTrace.triggerEvent && (
            <div className={styles.traceSection}>
              <h3 className={styles.traceSectionTitle}>Triggered By</h3>
              <div className={styles.triggerInfo}>
                <span className={styles.triggerEvent}>{eclTrace.triggerEvent.eventType ?? '—'}</span>
                <span className={styles.triggerTime}>
                  {eclTrace.triggerEvent.timestamp ? new Date(eclTrace.triggerEvent.timestamp).toLocaleString() : '—'}
                </span>
              </div>
            </div>
          )}

          {/* Calculation Inputs */}
          {eclTrace.inputs && (
            <div className={styles.traceSection}>
              <h3 className={styles.traceSectionTitle}>Calculation Inputs</h3>
              <table className={styles.inputsTable}>
                <thead>
                  <tr>
                    <th>Input</th>
                    <th>Value</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>PD Rate</td>
                    <td>{eclTrace.inputs.pdRate != null ? (eclTrace.inputs.pdRate * 100).toFixed(2) : '—'}%</td>
                    <td>{eclTrace.inputs.pdRateSource?.description ?? '—'}</td>
                  </tr>
                  <tr>
                    <td>LGD</td>
                    <td>{eclTrace.inputs.lgd != null ? (eclTrace.inputs.lgd * 100).toFixed(0) : '—'}%</td>
                    <td>{eclTrace.inputs.lgdSource?.description ?? '—'}</td>
                  </tr>
                  <tr>
                    <td>EAD</td>
                    <td>${eclTrace.inputs.ead?.toFixed(2) ?? '—'}</td>
                    <td>{eclTrace.inputs.eadSource?.description ?? '—'}</td>
                  </tr>
                  <tr>
                    <td>Overlay</td>
                    <td>{eclTrace.inputs.overlayMultiplier?.toFixed(2) ?? '—'}x</td>
                    <td>{eclTrace.inputs.overlaySource?.description ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Formula */}
          <div className={styles.traceSection}>
            <h3 className={styles.traceSectionTitle}>Calculation Formula</h3>
            <div className={styles.formula}>
              <code>{eclTrace.formula ?? 'N/A'}</code>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const renderAccrualTraceTab = () => (
    <div className={styles.tabContent}>
      {isLoadingAccrual ? (
        <p>Loading accrual trace...</p>
      ) : !accrualTrace ? (
        <div className={styles.emptyState}>No accrual data found</div>
      ) : (
        <div className={styles.traceContainer}>
          {/* Current State */}
          <div className={styles.traceSection}>
            <h3 className={styles.traceSectionTitle}>Current Accrual State</h3>
            <div className={styles.traceCards}>
              <div className={styles.traceCard}>
                <span className={styles.traceLabel}>Accrued Amount</span>
                <span className={styles.traceValue}>
                  ${accrualTrace.currentAccruedAmount?.toFixed(2) ?? '—'}
                </span>
              </div>
              <div className={styles.traceCard}>
                <span className={styles.traceLabel}>Days Accrued</span>
                <span className={styles.traceValue}>{accrualTrace.daysAccrued ?? '—'}</span>
              </div>
              <div className={styles.traceCard}>
                <span className={styles.traceLabel}>Remaining Days</span>
                <span className={styles.traceValue}>{accrualTrace.remainingDays ?? '—'}</span>
              </div>
            </div>
          </div>

          {/* Disbursement Source */}
          <div className={styles.traceSection}>
            <h3 className={styles.traceSectionTitle}>Source Disbursement</h3>
            <div className={styles.disbursementInfo}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Amount:</span>
                <span className={styles.infoValue}>
                  ${accrualTrace.disbursement?.amount?.toFixed(2) ?? '—'}
                </span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Fee Amount:</span>
                <span className={styles.infoValue}>
                  ${accrualTrace.disbursement?.feeAmount?.toFixed(2) ?? '—'}
                </span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Term:</span>
                <span className={styles.infoValue}>{accrualTrace.disbursement?.termDays ?? '—'} days</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Daily Rate:</span>
                <span className={styles.infoValue}>
                  ${accrualTrace.dailyRate?.value?.toFixed(4) ?? '—'}/day
                </span>
              </div>
            </div>
          </div>

          {/* Daily Rate Formula */}
          <div className={styles.traceSection}>
            <h3 className={styles.traceSectionTitle}>Daily Rate Calculation</h3>
            <div className={styles.formula}>
              <code>{accrualTrace.dailyRate?.formula ?? 'N/A'}</code>
            </div>
          </div>

          {/* Recent Accrual Events */}
          {accrualTrace.accrualEvents?.length > 0 && (
            <div className={styles.traceSection}>
              <h3 className={styles.traceSectionTitle}>
                Recent Accrual Events ({accrualTrace.totalEventCount} total)
              </h3>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Date</th>
                    <th className={styles.numericCol}>Daily</th>
                    <th className={styles.numericCol}>Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  {accrualTrace.accrualEvents.slice(0, 10).map((event) => (
                    <tr key={event.eventId}>
                      <td>{event.dayNumber ?? '—'}</td>
                      <td>{event.timestamp ? new Date(event.timestamp).toLocaleDateString() : '—'}</td>
                      <td className={styles.numericCol}>${event.dailyAmount?.toFixed(4) ?? '—'}</td>
                      <td className={styles.numericCol}>${event.cumulativeAmount?.toFixed(2) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className={styles.container} data-testid="investigation-view">
      <Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Investigation' }]} />

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Investigation</h1>
          <p className={styles.subtitle}>Event history and traceability tools</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => setBatchModalOpen(true)}
            data-testid="batch-query-btn"
          >
            📋 Batch Query
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => setSampleModalOpen(true)}
            data-testid="random-sample-btn"
          >
            🎲 Random Sample
          </button>
        </div>
      </div>

      {/* Account Lookup */}
      <section className={styles.lookupSection}>
        <div className={styles.searchBox}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Enter account ID to investigate..."
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            onKeyDown={handleKeyDown}
            data-testid="account-search-input"
          />
          <button
            type="button"
            className={styles.searchBtn}
            onClick={handleSearch}
            disabled={!accountId.trim()}
          >
            Search
          </button>
        </div>
      </section>

      {/* Account Investigation Tabs */}
      {searchedAccountId && (
        <section className={styles.investigationSection}>
          <div className={styles.accountHeader}>
            <h2 className={styles.accountId}>Account: {searchedAccountId}</h2>
          </div>

          {/* Tab Navigation */}
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'events' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('events')}
            >
              Event Timeline
            </button>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'ecl-trace' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('ecl-trace')}
            >
              ECL Trace
            </button>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'accrual-trace' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('accrual-trace')}
            >
              Accrual Trace
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'events' && renderEventsTab()}
          {activeTab === 'ecl-trace' && renderECLTraceTab()}
          {activeTab === 'accrual-trace' && renderAccrualTraceTab()}
        </section>
      )}

      {/* Batch Query Modal */}
      {batchModalOpen && (
        <>
          <div className={styles.modalOverlay} onClick={() => setBatchModalOpen(false)} />
          <div className={styles.modal} role="dialog" aria-modal="true" data-testid="batch-modal">
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Batch Account Query</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setBatchModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {!batchResults ? (
                <>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="batch-ids" className={styles.fieldLabel}>
                      Account IDs (one per line or comma-separated, max 100)
                    </label>
                    <textarea
                      id="batch-ids"
                      className={styles.textarea}
                      value={batchAccountIds}
                      onChange={(e) => setBatchAccountIds(e.target.value)}
                      rows={8}
                      placeholder="ACC001&#10;ACC002&#10;ACC003"
                    />
                    <p className={styles.fieldHint}>
                      {batchAccountIds
                        ? `${Math.min(batchAccountIds.split(/[\n,]/).filter((s) => s.trim()).length, 100)} account(s)`
                        : 'Enter account IDs'}
                    </p>
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Include Data</label>
                    <div className={styles.checkboxGroup}>
                      <label className={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={batchIncludeBalance}
                          onChange={(e) => setBatchIncludeBalance(e.target.checked)}
                        />
                        Balance
                      </label>
                      <label className={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={batchIncludeECL}
                          onChange={(e) => setBatchIncludeECL(e.target.checked)}
                        />
                        ECL
                      </label>
                      <label className={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={batchIncludeAccrual}
                          onChange={(e) => setBatchIncludeAccrual(e.target.checked)}
                        />
                        Accrual
                      </label>
                    </div>
                  </div>
                </>
              ) : (
                <div className={styles.batchResults}>
                  <p className={styles.resultsSummary}>
                    Found {batchResults.filter((r) => r.found).length} of {batchResults.length}{' '}
                    accounts
                  </p>
                  <div className={styles.resultsScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Account ID</th>
                          <th>Found</th>
                          <th className={styles.numericCol}>Balance</th>
                          <th className={styles.numericCol}>ECL</th>
                          <th>DPD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchResults.map((result) => (
                          <tr key={result.accountId}>
                            <td>{result.accountId}</td>
                            <td>
                              {result.found ? (
                                <span className={styles.found}>✓</span>
                              ) : (
                                <span className={styles.notFound}>✗</span>
                              )}
                            </td>
                            <td className={styles.numericCol}>
                              {result.balance ? `$${result.balance.total.toFixed(2)}` : '-'}
                            </td>
                            <td className={styles.numericCol}>
                              {result.ecl ? `$${result.ecl.amount.toFixed(2)}` : '-'}
                            </td>
                            <td>{result.aging?.dpd ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className={styles.modalFooter}>
              {!batchResults ? (
                <>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => setBatchModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={handleBatchQuery}
                    disabled={
                      isBatchQuerying ||
                      !batchAccountIds.trim() ||
                      batchAccountIds.split(/[\n,]/).filter((s) => s.trim()).length > 100
                    }
                  >
                    {isBatchQuerying ? 'Querying...' : 'Query Accounts'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => {
                      setBatchResults(null)
                      setBatchAccountIds('')
                    }}
                  >
                    New Query
                  </button>
                  <button type="button" className={styles.primaryBtn} onClick={exportBatchToCSV}>
                    Export CSV
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Random Sample Modal */}
      {sampleModalOpen && (
        <>
          <div className={styles.modalOverlay} onClick={() => setSampleModalOpen(false)} />
          <div className={styles.modal} role="dialog" aria-modal="true" data-testid="sample-modal">
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Random Sample Generator</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setSampleModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {!sampleResults ? (
                <>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="sample-size" className={styles.fieldLabel}>
                      Sample Size (max 500)
                    </label>
                    <input
                      id="sample-size"
                      type="number"
                      className={styles.input}
                      value={sampleSize}
                      onChange={(e) => setSampleSize(e.target.value)}
                      min="1"
                      max="500"
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="sample-bucket" className={styles.fieldLabel}>
                      Filter by Bucket (optional)
                    </label>
                    <select
                      id="sample-bucket"
                      className={styles.select}
                      value={sampleBucket}
                      onChange={(e) => setSampleBucket(e.target.value)}
                    >
                      <option value="">All Buckets</option>
                      <option value="CURRENT">Current (0 DPD)</option>
                      <option value="EARLY_ARREARS">Early Arrears (1-14 DPD)</option>
                      <option value="LATE_ARREARS">Late Arrears (15-61 DPD)</option>
                      <option value="DEFAULT">Default (62+ DPD)</option>
                    </select>
                  </div>
                  <div className={styles.fieldRow}>
                    <div className={styles.fieldGroup}>
                      <label htmlFor="min-ecl" className={styles.fieldLabel}>
                        Min ECL ($)
                      </label>
                      <input
                        id="min-ecl"
                        type="number"
                        className={styles.input}
                        value={sampleMinECL}
                        onChange={(e) => setSampleMinECL(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className={styles.fieldGroup}>
                      <label htmlFor="max-ecl" className={styles.fieldLabel}>
                        Max ECL ($)
                      </label>
                      <input
                        id="max-ecl"
                        type="number"
                        className={styles.input}
                        value={sampleMaxECL}
                        onChange={(e) => setSampleMaxECL(e.target.value)}
                        placeholder="No limit"
                      />
                    </div>
                  </div>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="sample-seed" className={styles.fieldLabel}>
                      Seed (optional, for reproducibility)
                    </label>
                    <input
                      id="sample-seed"
                      type="number"
                      className={styles.input}
                      value={sampleSeed}
                      onChange={(e) => setSampleSeed(e.target.value)}
                      placeholder="Random"
                    />
                  </div>
                </>
              ) : (
                <div className={styles.sampleResults}>
                  <p className={styles.resultsSummary}>
                    Generated {sampleResults.length} account IDs
                  </p>
                  <div className={styles.sampleList}>
                    {sampleResults.slice(0, 20).map((id) => (
                      <span key={id} className={styles.sampleId}>
                        {id}
                      </span>
                    ))}
                    {sampleResults.length > 20 && (
                      <span className={styles.sampleMore}>
                        +{sampleResults.length - 20} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className={styles.modalFooter}>
              {!sampleResults ? (
                <>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => setSampleModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={handleGenerateSample}
                    disabled={isGeneratingSample || !sampleSize || parseInt(sampleSize, 10) > 500}
                  >
                    {isGeneratingSample ? 'Generating...' : 'Generate Sample'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => {
                      setSampleResults(null)
                    }}
                  >
                    New Sample
                  </button>
                  <button type="button" className={styles.primaryBtn} onClick={exportSampleToCSV}>
                    Export CSV
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

export default InvestigationView
