'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ACCOUNT_STATUSES,
  AGING_BUCKETS,
  CLOSURE_REASONS,
  CUSTOMER_STATUSES,
  PAYMENT_FREQUENCIES,
  type AccountStatus,
  type AgingBucket,
  type ClosureReason,
  type CustomerStatus,
  type FiltersInput,
  type FiltersState,
  type PaymentFrequency,
} from '@/lib/account-filters'
import { formatCurrency } from '@/lib/formatters'
import styles from './styles.module.css'

const STATUS_LABEL: Record<AccountStatus, string> = {
  pending_disbursement: 'Pending',
  active: 'Active',
  in_arrears: 'Arrears',
  paid_off: 'Paid off',
  written_off: 'Written off',
}

export interface FilterBarProps {
  filters: FiltersState
  /** Patch the filter state (partial); caller writes to the URL. */
  onChange: (patch: FiltersInput) => void
  /** Result metadata for the meta row. */
  totalDocs: number
  isFetching: boolean
  onExport: () => void
  onShowShortcuts: () => void
}

interface Chip {
  id: string
  label: string
  onClear: () => void
}

function buildChips(filters: FiltersState, onChange: FilterBarProps['onChange']): Chip[] {
  const chips: Chip[] = []
  if (filters.status?.length) {
    chips.push({
      id: 'status',
      label: `Status: ${filters.status.map((s) => STATUS_LABEL[s]).join(', ')}`,
      onClear: () => onChange({ ...filters, status: undefined }),
    })
  }
  if (filters.minBalance != null) {
    chips.push({
      id: 'minBalance',
      label: `Balance ≥ ${formatCurrency(filters.minBalance)}`,
      onClear: () => onChange({ ...filters, minBalance: undefined }),
    })
  }
  if (filters.maxBalance != null) {
    chips.push({
      id: 'maxBalance',
      label: `Balance ≤ ${formatCurrency(filters.maxBalance)}`,
      onClear: () => onChange({ ...filters, maxBalance: undefined }),
    })
  }
  if (filters.openedFrom || filters.openedTo) {
    chips.push({
      id: 'opened',
      label: `Opened ${filters.openedFrom ?? '…'} → ${filters.openedTo ?? '…'}`,
      onClear: () => onChange({ ...filters, openedFrom: undefined, openedTo: undefined }),
    })
  }
  if (filters.closedFrom || filters.closedTo) {
    chips.push({
      id: 'closed',
      label: `Closed ${filters.closedFrom ?? '…'} → ${filters.closedTo ?? '…'}`,
      onClear: () => onChange({ ...filters, closedFrom: undefined, closedTo: undefined }),
    })
  }
  if (filters.lastPmtBefore) {
    chips.push({
      id: 'lastPmt',
      label: `Last payment before ${filters.lastPmtBefore}`,
      onClear: () => onChange({ ...filters, lastPmtBefore: undefined }),
    })
  }
  if (filters.closureReason) {
    chips.push({
      id: 'closureReason',
      label: `Closure: ${filters.closureReason}`,
      onClear: () => onChange({ ...filters, closureReason: undefined }),
    })
  }
  if (filters.customerStatus) {
    chips.push({
      id: 'customerStatus',
      label: `Customer: ${filters.customerStatus}`,
      onClear: () => onChange({ ...filters, customerStatus: undefined }),
    })
  }
  if (filters.paymentFrequency) {
    chips.push({
      id: 'paymentFrequency',
      label: `Frequency: ${filters.paymentFrequency}`,
      onClear: () => onChange({ ...filters, paymentFrequency: undefined }),
    })
  }
  if (filters.isInArrears != null) {
    chips.push({
      id: 'isInArrears',
      label: filters.isInArrears ? 'In arrears' : 'Not in arrears',
      onClear: () => onChange({ ...filters, isInArrears: undefined }),
    })
  }
  if (filters.agingBucket?.length) {
    chips.push({
      id: 'agingBucket',
      label: `Bucket: ${filters.agingBucket.join(', ')}`,
      onClear: () => onChange({ ...filters, agingBucket: undefined }),
    })
  }
  if (filters.minDpd != null) {
    chips.push({
      id: 'minDpd',
      label: `DPD ≥ ${filters.minDpd}`,
      onClear: () => onChange({ ...filters, minDpd: undefined }),
    })
  }
  return chips
}

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onChange,
  totalDocs,
  isFetching,
  onExport,
  onShowShortcuts,
}) => {
  const [modalOpen, setModalOpen] = useState(false)
  const [searchDraft, setSearchDraft] = useState(filters.q ?? '')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Keep the draft in sync if the URL is changed externally (e.g. Smart View click).
  useEffect(() => {
    setSearchDraft(filters.q ?? '')
  }, [filters.q])

  // `/` focuses the search input (matches the cheatsheet promise).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inInput =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (inInput) return
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Debounced auto-apply on the search input.
  //  - Empty → clear immediately so the full list returns without an Enter press.
  //  - Non-empty < 3 chars → wait (the search endpoint requires 3+).
  //  - Otherwise → apply after 350ms idle.
  //
  // `filters` and `onChange` change identity each render; that's fine — the
  // setTimeout is cleared and re-scheduled, which is the debounce.
  useEffect(() => {
    const trimmed = searchDraft.trim()
    const currentQ = filters.q ?? ''
    if (trimmed === currentQ) return

    if (trimmed === '') {
      onChange({ ...filters, q: undefined, page: 1 })
      return
    }
    if (trimmed.length < 3) return

    const t = setTimeout(() => {
      onChange({ ...filters, q: trimmed, page: 1 })
    }, 350)
    return () => clearTimeout(t)
  }, [searchDraft, filters, onChange])

  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      // Pressing Enter applies immediately, skipping the debounce.
      e.preventDefault()
      const trimmed = searchDraft.trim()
      onChange({ ...filters, q: trimmed.length >= 3 ? trimmed : undefined, page: 1 })
    },
    [filters, onChange, searchDraft],
  )

  const chips = buildChips(filters, onChange)

  return (
    <div className={styles.filterBar} data-testid="accounts-filter-bar">
      <div className={styles.chipStrip}>
        {chips.map((chip) => (
          <span key={chip.id} className={styles.chip} data-testid={`chip-${chip.id}`}>
            <span className={styles.chipLabel}>{chip.label}</span>
            <button
              type="button"
              className={styles.chipRemove}
              onClick={chip.onClear}
              aria-label={`Remove ${chip.label}`}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          className={styles.addFilter}
          onClick={() => setModalOpen(true)}
          data-testid="add-filter"
        >
          + Add filter
        </button>
      </div>

      <form onSubmit={handleSearchSubmit}>
        <input
          ref={searchInputRef}
          type="search"
          className={styles.searchInput}
          placeholder="Search accounts… (3+ chars)"
          title="Search by account number, loan account ID, or customer name. Press / to focus."
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          data-testid="accounts-search-input"
        />
      </form>

      <div className={styles.filterMeta}>
        <span className={styles.resultCount}>
          <span className={styles.resultCountNumber}>{totalDocs.toLocaleString('en-AU')}</span>{' '}
          {totalDocs === 1 ? 'account' : 'accounts'}
          {isFetching && <span style={{ marginLeft: 8, opacity: 0.6 }}>refreshing…</span>}
        </span>
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={onShowShortcuts}
            title="Show keyboard shortcuts (?)"
          >
            <span className={styles.kbd}>?</span> Shortcuts
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={onExport}
            disabled={totalDocs === 0}
            title="Export current page to CSV (⌘E)"
            data-testid="export-csv"
          >
            ↓ Export CSV
          </button>
        </div>
      </div>

      {modalOpen && (
        <FilterModal
          initial={filters}
          onApply={(next) => {
            onChange({ ...next, page: 1 })
            setModalOpen(false)
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}

/* === Filter modal === */

interface FilterModalProps {
  initial: FiltersState
  onApply: (filters: FiltersInput) => void
  onClose: () => void
}

const FilterModal: React.FC<FilterModalProps> = ({ initial, onApply, onClose }) => {
  const [status, setStatus] = useState<AccountStatus[]>(initial.status ?? [])
  const [minBalance, setMinBalance] = useState<string>(
    initial.minBalance != null ? String(initial.minBalance) : '',
  )
  const [maxBalance, setMaxBalance] = useState<string>(
    initial.maxBalance != null ? String(initial.maxBalance) : '',
  )
  const [openedFrom, setOpenedFrom] = useState(initial.openedFrom ?? '')
  const [openedTo, setOpenedTo] = useState(initial.openedTo ?? '')
  const [closedFrom, setClosedFrom] = useState(initial.closedFrom ?? '')
  const [closedTo, setClosedTo] = useState(initial.closedTo ?? '')
  const [lastPmtBefore, setLastPmtBefore] = useState(initial.lastPmtBefore ?? '')
  const [closureReason, setClosureReason] = useState<ClosureReason | ''>(
    initial.closureReason ?? '',
  )
  const [customerStatus, setCustomerStatus] = useState<CustomerStatus | ''>(
    initial.customerStatus ?? '',
  )
  const [paymentFrequency, setPaymentFrequency] = useState<PaymentFrequency | ''>(
    initial.paymentFrequency ?? '',
  )
  // Aging filters (aging-v1.1.0+)
  const [inArrearsChoice, setInArrearsChoice] = useState<'any' | 'true' | 'false'>(
    initial.isInArrears === true ? 'true' : initial.isInArrears === false ? 'false' : 'any',
  )
  const [agingBucket, setAgingBucket] = useState<AgingBucket[]>(initial.agingBucket ?? [])
  const [minDpd, setMinDpd] = useState<string>(
    initial.minDpd != null ? String(initial.minDpd) : '',
  )

  // Esc closes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const toggleStatus = (s: AccountStatus) => {
    setStatus((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  const handleApply = () => {
    const parseNum = (s: string) => {
      if (!s) return undefined
      const n = Number(s)
      return Number.isFinite(n) && n >= 0 ? n : undefined
    }
    onApply({
      ...initial,
      status: status.length ? status : undefined,
      minBalance: parseNum(minBalance),
      maxBalance: parseNum(maxBalance),
      openedFrom: openedFrom || undefined,
      openedTo: openedTo || undefined,
      closedFrom: closedFrom || undefined,
      closedTo: closedTo || undefined,
      lastPmtBefore: lastPmtBefore || undefined,
      closureReason: closureReason || undefined,
      customerStatus: customerStatus || undefined,
      paymentFrequency: paymentFrequency || undefined,
      isInArrears:
        inArrearsChoice === 'true' ? true : inArrearsChoice === 'false' ? false : undefined,
      agingBucket: agingBucket.length ? agingBucket : undefined,
      minDpd: parseNum(minDpd),
    })
  }

  const handleClear = () => {
    setStatus([])
    setMinBalance('')
    setMaxBalance('')
    setOpenedFrom('')
    setOpenedTo('')
    setClosedFrom('')
    setClosedTo('')
    setLastPmtBefore('')
    setClosureReason('')
    setCustomerStatus('')
    setPaymentFrequency('')
    setInArrearsChoice('any')
    setAgingBucket([])
    setMinDpd('')
  }

  const toggleBucket = (b: AgingBucket) => {
    setAgingBucket((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]))
  }

  return (
    <div
      className={styles.modalOverlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Filters"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Filters</h2>
          <button
            type="button"
            className={styles.modalClose}
            onClick={onClose}
            aria-label="Close filters"
          >
            ×
          </button>
        </div>

        <div className={styles.modalGroup}>
          <label className={styles.modalLabel}>Status</label>
          <div className={styles.statusChoices}>
            {ACCOUNT_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`${styles.statusChoice} ${status.includes(s) ? styles.selected : ''}`}
                onClick={() => toggleStatus(s)}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.modalGroup}>
          <label className={styles.modalLabel}>Arrears state (from aging service)</label>
          <div className={styles.statusChoices}>
            {(['any', 'true', 'false'] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                className={`${styles.statusChoice} ${inArrearsChoice === choice ? styles.selected : ''}`}
                onClick={() => setInArrearsChoice(choice)}
              >
                {choice === 'any' ? 'Any' : choice === 'true' ? 'In arrears' : 'Not in arrears'}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.modalGroup}>
          <label className={styles.modalLabel}>Aging bucket</label>
          <div className={styles.statusChoices}>
            {AGING_BUCKETS.map((b) => (
              <button
                key={b}
                type="button"
                className={`${styles.statusChoice} ${agingBucket.includes(b) ? styles.selected : ''}`}
                onClick={() => toggleBucket(b)}
              >
                {b.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.modalGroup}>
          <label className={styles.modalLabel}>Minimum DPD</label>
          <input
            className={styles.modalInput}
            type="number"
            inputMode="numeric"
            min="0"
            placeholder="e.g. 15"
            value={minDpd}
            onChange={(e) => setMinDpd(e.target.value)}
          />
        </div>

        <div className={styles.modalGroup}>
          <label className={styles.modalLabel}>Outstanding balance</label>
          <div className={styles.modalInputs}>
            <input
              className={styles.modalInput}
              type="number"
              inputMode="numeric"
              min="0"
              step="0.01"
              placeholder="Min $"
              value={minBalance}
              onChange={(e) => setMinBalance(e.target.value)}
            />
            <input
              className={styles.modalInput}
              type="number"
              inputMode="numeric"
              min="0"
              step="0.01"
              placeholder="Max $"
              value={maxBalance}
              onChange={(e) => setMaxBalance(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.modalGroup}>
          <label className={styles.modalLabel}>Opened date range</label>
          <div className={styles.modalInputs}>
            <input
              className={styles.modalInput}
              type="date"
              value={openedFrom}
              onChange={(e) => setOpenedFrom(e.target.value)}
            />
            <input
              className={styles.modalInput}
              type="date"
              value={openedTo}
              onChange={(e) => setOpenedTo(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.modalGroup}>
          <label className={styles.modalLabel}>Closed date range</label>
          <div className={styles.modalInputs}>
            <input
              className={styles.modalInput}
              type="date"
              value={closedFrom}
              onChange={(e) => setClosedFrom(e.target.value)}
            />
            <input
              className={styles.modalInput}
              type="date"
              value={closedTo}
              onChange={(e) => setClosedTo(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.modalGroup}>
          <label className={styles.modalLabel}>Last payment before</label>
          <input
            className={styles.modalInput}
            type="date"
            value={lastPmtBefore}
            onChange={(e) => setLastPmtBefore(e.target.value)}
          />
        </div>

        <div className={styles.modalGroup}>
          <label className={styles.modalLabel}>Closure reason</label>
          <select
            className={styles.modalInput}
            value={closureReason}
            onChange={(e) => setClosureReason((e.target.value || '') as ClosureReason | '')}
          >
            <option value="">Any</option>
            {CLOSURE_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.modalGroup}>
          <label className={styles.modalLabel}>Customer status</label>
          <select
            className={styles.modalInput}
            value={customerStatus}
            onChange={(e) =>
              setCustomerStatus((e.target.value || '') as CustomerStatus | '')
            }
          >
            <option value="">Any</option>
            {CUSTOMER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.modalGroup}>
          <label className={styles.modalLabel}>Payment frequency</label>
          <select
            className={styles.modalInput}
            value={paymentFrequency}
            onChange={(e) =>
              setPaymentFrequency((e.target.value || '') as PaymentFrequency | '')
            }
          >
            <option value="">Any</option>
            {PAYMENT_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.modalActions}>
          <button type="button" className={styles.modalSecondary} onClick={handleClear}>
            Clear all
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={styles.modalSecondary} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.modalPrimary}
              onClick={handleApply}
              data-testid="filters-apply"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
