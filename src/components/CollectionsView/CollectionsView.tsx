'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useCollectionsCases, type CollectionsCasesFilters } from '@/hooks/queries/useCollectionsCases'
import type { CollectionsCaseRow } from '@/types/collections'
import styles from './styles.module.css'

/**
 * Bucket display configuration
 */
const BUCKET_CONFIG: Record<string, { label: string; className: string }> = {
  current: { label: 'Current', className: styles.bucketCurrent },
  early_arrears: { label: 'Early Arrears', className: styles.bucketEarlyArrears },
  late_arrears: { label: 'Late Arrears', className: styles.bucketLateArrears },
  default: { label: 'Default', className: styles.bucketDefault },
}

/**
 * Case-state badge display configuration
 */
const STATE_CONFIG: Record<CollectionsCaseRow['state'], { label: string; className: string }> = {
  open: { label: 'Open', className: styles.stateBadgeOpen },
  awaiting_human: { label: 'Awaiting human', className: styles.stateBadgeAwaitingHuman },
  cured: { label: 'Cured', className: styles.stateBadgeCured },
}

type SortMode = 'updated' | 'enr'

/**
 * Minimal shape of the batch economics response consumed for the
 * client-side "Expected net recovery" sort. Redeclared here rather than
 * imported from `@/server/collections-service-client` because that module
 * pulls in node-only `@grpc/grpc-js` / `path` imports unsafe for the client
 * bundle — mirrors the pattern already used in `src/types/collections.ts`
 * for `CollectionsActionResult`.
 */
type GateStatus = 'GATE_UNSPECIFIED' | 'PASS' | 'FAIL' | 'NOT_APPLICABLE'

interface EconomicsSortItem {
  accountId: string
  expectedNetRecovery: string
  gateResult: { status: GateStatus; reason: string }
}

interface EconomicsSortResponse {
  items: EconomicsSortItem[]
  unavailable?: boolean
}

/**
 * Fetches batch cost-of-recovery economics for the given accountIds — used
 * only to compute the client-side "Expected net recovery" sort option.
 * Kept local to the component per the WS3 brief; server-side ENR sort is
 * deliberately out of scope (compute-on-read decision).
 *
 * Until the cost-of-recovery engine (BTB-194) is deployed, the batch route
 * degrades gracefully: `unavailable: true`, or every item's
 * `gateResult.status === 'NOT_APPLICABLE'`. Both cases fall back to
 * Updated-order in the component below.
 */
function useEconomicsSort(accountIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: ['collections-economics-sort', accountIds],
    queryFn: async (): Promise<EconomicsSortResponse> => {
      const res = await fetch('/api/collections/economics', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error?.message ?? `Collections economics fetch failed: ${res.status}`)
      }
      return res.json()
    },
    enabled: enabled && accountIds.length > 0,
    staleTime: 30_000,
  })
}

/**
 * Format currency for display
 */
function formatCurrency(amount: string): string {
  const num = parseFloat(amount)
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(num)
}

/**
 * Get DPD badge class based on days past due
 */
function getDpdClass(dpd: number): string {
  if (dpd >= 60) return styles.dpdHigh
  if (dpd >= 30) return styles.dpdMedium
  return styles.dpdLow
}

/**
 * Format an ISO timestamp for the "Updated" column.
 */
function formatUpdated(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'short', timeStyle: 'short' }).format(d)
}

/**
 * Collections Queue View
 *
 * Displays a filterable, infinite-scrolling worklist of collections cases
 * sourced from the event-sourced read model (headless collectionsService),
 * with navigation to individual case views.
 *
 * Story E1-S1: Collections Queue View Shell
 * BTB-196 WS3: re-platformed onto `useCollectionsCases` (event-sourced worklist)
 */
export function CollectionsView() {
  const router = useRouter()

  // Filter state
  const [state, setState] = useState<CollectionsCasesFilters['state']>(undefined)
  const [rung, setRung] = useState<number | undefined>(undefined)
  const [hardship, setHardship] = useState(false)
  const [stopContact, setStopContact] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('updated')

  // Build filters object
  const filters = useMemo<CollectionsCasesFilters>(
    () => ({
      state,
      rung,
      hardshipPaused: hardship || undefined,
      stoppedContact: stopContact || undefined,
    }),
    [state, rung, hardship, stopContact],
  )

  // Fetch collections cases (event-sourced worklist)
  const { cases, totalDocs, agingUnavailable, fetchNextPage, hasNextPage, isLoading, isFetching } =
    useCollectionsCases(filters)

  // Expected-net-recovery sort: batch economics lookup over the loaded rows
  const accountIds = useMemo(() => cases.map((c) => c.accountId), [cases])
  const economicsQuery = useEconomicsSort(accountIds, sortMode === 'enr')

  const enrData = economicsQuery.data
  const enrUnavailable =
    !!enrData && (enrData.unavailable === true || enrData.items.every((item) => item.gateResult.status === 'NOT_APPLICABLE'))
  const enrPending = sortMode === 'enr' && !!enrData && (enrUnavailable || economicsQuery.isError)

  const displayedCases = useMemo(() => {
    if (sortMode !== 'enr' || !enrData || economicsQuery.isError || enrUnavailable) {
      return cases
    }
    const enrByAccountId = new Map(enrData.items.map((item) => [item.accountId, Number(item.expectedNetRecovery)]))
    return [...cases].sort((a, b) => {
      const aVal = enrByAccountId.get(a.accountId) ?? -Infinity
      const bVal = enrByAccountId.get(b.accountId) ?? -Infinity
      return bVal - aVal
    })
  }, [cases, sortMode, enrData, enrUnavailable, economicsQuery.isError])

  // Calculate total overdue amount across loaded (aging-available) rows
  const totalAmount = useMemo(() => {
    return cases.reduce((sum, row) => sum + (row.aging ? parseFloat(row.aging.totalOverdue) : 0), 0)
  }, [cases])

  const hasActiveFilters = Boolean(state || rung !== undefined || hardship || stopContact)

  // Clear all filters
  const clearFilters = useCallback(() => {
    setState(undefined)
    setRung(undefined)
    setHardship(false)
    setStopContact(false)
  }, [])

  // Navigate to the case view
  const handleRowClick = useCallback(
    (row: CollectionsCaseRow) => {
      router.push(`/admin/collections-queue/${row.accountId}`)
    },
    [router],
  )

  // Export to CSV
  const handleExport = useCallback(() => {
    const headers = ['Account', 'Customer', 'Rung', 'State', 'Flags', 'DPD', 'Bucket', 'Amount', 'Updated']
    const rows = displayedCases.map((row) => {
      const flags = [row.hardshipPaused && 'Hardship', row.stoppedContact && 'Stop contact']
        .filter(Boolean)
        .join('; ')

      return [
        row.accountNumber || row.accountId,
        row.customerName || '—',
        row.rung != null ? `Step ${row.rung}/5` : '—',
        row.state,
        flags || '—',
        row.aging ? String(row.aging.dpd) : '—',
        row.aging ? row.aging.bucket : '—',
        row.aging ? row.aging.totalOverdue : '—',
        row.updatedAt,
      ]
    })

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `collections-queue-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [displayedCases])

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>Collections Queue</h1>
        <div className={styles.headerActions}>
          <div className={styles.sortGroup}>
            <label className={styles.filterLabel} htmlFor="collections-sort">
              Sort
            </label>
            <select
              id="collections-sort"
              className={styles.filterSelect}
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
            >
              <option value="updated">Updated (default)</option>
              <option value="enr">Expected net recovery</option>
            </select>
            {enrPending && (
              <span className={styles.pendingNote}>
                Net-recovery sort pending platform deploy (BTB-194)
              </span>
            )}
          </div>
          <button
            className={styles.exportButton}
            onClick={handleExport}
            disabled={displayedCases.length === 0}
          >
            <span>📤</span>
            Export
          </button>
        </div>
      </div>

      {/* Fallback Banner */}
      {agingUnavailable && (
        <div className={styles.fallbackBanner}>
          <span className={styles.fallbackIcon}>⚠️</span>
          <span className={styles.fallbackText}>
            Ledger aging temporarily unavailable — DPD/Bucket/Amount columns degraded.
          </span>
        </div>
      )}

      {/* Filters */}
      <div className={styles.filters}>
        <div className={styles.filterRow}>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel} htmlFor="collections-state-filter">
              State
            </label>
            <select
              id="collections-state-filter"
              className={styles.filterSelect}
              value={state ?? ''}
              onChange={(e) =>
                setState((e.target.value || undefined) as CollectionsCasesFilters['state'])
              }
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="awaiting_human">Awaiting human</option>
              <option value="cured">Cured</option>
            </select>
          </div>

          <button
            type="button"
            className={`${styles.quickChip} ${state === 'awaiting_human' ? styles.quickChipActive : ''}`}
            onClick={() => setState((prev) => (prev === 'awaiting_human' ? undefined : 'awaiting_human'))}
            aria-pressed={state === 'awaiting_human'}
          >
            Awaiting human
          </button>

          <div className={styles.filterGroup}>
            <label className={styles.filterLabel} htmlFor="collections-rung-filter">
              Rung
            </label>
            <select
              id="collections-rung-filter"
              className={styles.filterSelect}
              value={rung ?? ''}
              onChange={(e) => setRung(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">All</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>
          </div>

          <label className={styles.checkboxGroup}>
            <input type="checkbox" checked={hardship} onChange={(e) => setHardship(e.target.checked)} />
            Hardship
          </label>

          <label className={styles.checkboxGroup}>
            <input
              type="checkbox"
              checked={stopContact}
              onChange={(e) => setStopContact(e.target.checked)}
            />
            Stop contact
          </label>

          <button className={styles.clearFilters} onClick={clearFilters} disabled={!hasActiveFilters}>
            Clear Filters
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className={styles.summary}>
        <span className={styles.summaryText}>
          <span className={styles.summaryCount}>{totalDocs}</span> Collections Cases
        </span>
        <span className={styles.summaryText}>
          Total: <span className={styles.summaryAmount}>{formatCurrency(totalAmount.toString())}</span>
        </span>
      </div>

      {/* Table */}
      <div className={styles.tableWrapper}>
        {isLoading ? (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span className={styles.loadingText}>Loading cases...</span>
          </div>
        ) : displayedCases.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>✅</span>
            <h3 className={styles.emptyTitle}>No Collections Cases</h3>
            <p className={styles.emptyText}>
              {hasActiveFilters ? 'No cases match the current filters.' : 'All accounts are current. Great work!'}
            </p>
          </div>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Customer</th>
                  <th>Rung</th>
                  <th>State</th>
                  <th>Flags</th>
                  <th>DPD</th>
                  <th>Bucket</th>
                  <th>Amount</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {displayedCases.map((row) => {
                  const bucketInfo = row.aging
                    ? BUCKET_CONFIG[row.aging.bucket] || { label: row.aging.bucket, className: '' }
                    : null
                  const stateInfo = STATE_CONFIG[row.state]
                  const displayAccountId = row.accountNumber || row.accountId
                  const customerName = row.customerName || '—'

                  return (
                    <tr key={row.accountId} onClick={() => handleRowClick(row)}>
                      <td>
                        <span className={styles.accountLink}>{displayAccountId}</span>
                      </td>
                      <td>{customerName}</td>
                      <td>{row.rung != null ? `Step ${row.rung}/5` : '—'}</td>
                      <td>
                        <span className={`${styles.stateBadge} ${stateInfo.className}`}>{stateInfo.label}</span>
                      </td>
                      <td>
                        <div className={styles.flagsCell}>
                          {row.hardshipPaused && <span className={styles.flagChip}>Hardship</span>}
                          {row.stoppedContact && <span className={styles.flagChip}>Stop contact</span>}
                          {!row.hardshipPaused && !row.stoppedContact && '—'}
                        </div>
                      </td>
                      <td>
                        {row.aging ? (
                          <span className={`${styles.dpdBadge} ${getDpdClass(row.aging.dpd)}`}>
                            {row.aging.dpd}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {bucketInfo ? (
                          <span className={`${styles.bucketBadge} ${bucketInfo.className}`}>
                            {bucketInfo.label}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <span className={styles.amount}>
                          {row.aging ? formatCurrency(row.aging.totalOverdue) : '—'}
                        </span>
                      </td>
                      <td>{formatUpdated(row.updatedAt)}</td>
                      <td>
                        <button
                          className={styles.arrowButton}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRowClick(row)
                          }}
                          title="View case"
                        >
                          →
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Pagination — infinite-query "Load more" */}
            {hasNextPage && (
              <div className={styles.pagination}>
                <button
                  className={styles.pageButton}
                  onClick={() => void fetchNextPage()}
                  disabled={isFetching}
                >
                  {isFetching ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
