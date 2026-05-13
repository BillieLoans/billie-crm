'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  DEFAULT_SORT,
  filtersSchema,
  filtersToQueryString,
  queryStringToFilters,
  type FiltersInput,
  type FiltersState,
} from '@/lib/account-filters'
import { applySmartViewDefaults, getSmartView, type SmartView } from '@/lib/smart-views'
import { useAccountsBrowser } from '@/hooks/queries/useAccountsBrowser'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { formatCurrency } from '@/lib/formatters'
import type { LoanAccount } from '@/payload-types'
import { SmartViewRail } from './SmartViewRail'
import { FilterBar } from './FilterBar'
import { AccountsTable } from './AccountsTable'
import { AccountPeekDrawer } from './AccountPeekDrawer'
import { ShortcutsCheatsheet } from './ShortcutsCheatsheet'
import styles from './styles.module.css'

const PAGE_PATH = '/admin/accounts'

/** Parse the URL into a validated filter state, falling back to defaults. */
function readFiltersFromUrl(searchParams: URLSearchParams): FiltersState {
  try {
    return queryStringToFilters(searchParams)
  } catch {
    // Bad URL → reset to defaults rather than crash the page.
    return filtersSchema.parse({})
  }
}

/**
 * Browse Accounts — main view. Top-level composition of the rail, filter bar,
 * table, and peek drawer. The URL is the single source of truth for filter
 * state; every interaction patches the URL via `router.replace`.
 */
export const AccountsBrowserView: React.FC = () => {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Always re-parse on each render so URL changes flow into the hook key.
  const urlParams = useMemo(
    () => new URLSearchParams(searchParams?.toString() ?? ''),
    [searchParams],
  )
  const urlFilters = useMemo(() => readFiltersFromUrl(urlParams), [urlParams])

  // What we send to the server includes Smart View defaults so client-side
  // counts match the data the server returns. Re-parsing through the schema
  // restores the FiltersState shape (page/limit are inherited from urlFilters
  // since views never override them).
  const effectiveFilters = useMemo(
    () => filtersSchema.parse(applySmartViewDefaults(urlFilters)),
    [urlFilters],
  )

  const { accounts, totalDocs, page, totalPages, hasNextPage, hasPrevPage, isLoading, isFetching } =
    useAccountsBrowser({ filters: effectiveFilters })

  // === Peek drawer state ===
  const [peekAccount, setPeekAccount] = useState<LoanAccount | null>(null)
  const [peekOpen, setPeekOpen] = useState(false)
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false)

  // === URL writers ===
  const writeFilters = useCallback(
    (patch: FiltersInput) => {
      // Strip transient page if any filter changed (so users always land on p1).
      const next = { ...urlFilters, ...patch }
      const qs = filtersToQueryString(next)
      router.replace(qs ? `${PAGE_PATH}?${qs}` : PAGE_PATH, { scroll: false })
    },
    [router, urlFilters],
  )

  const handleSelectView = useCallback(
    (view: SmartView) => {
      // Clicking a view resets to that view's URL (no other params).
      router.replace(`${PAGE_PATH}?view=${view.id}`, { scroll: false })
    },
    [router],
  )

  const handleSortChange = useCallback(
    (sort: string) => writeFilters({ sort, page: 1 }),
    [writeFilters],
  )

  const handlePageChange = useCallback(
    (nextPage: number) => writeFilters({ page: nextPage }),
    [writeFilters],
  )

  // === Row handlers ===
  const openServicing = useCallback(
    (account: LoanAccount) => {
      if (account.customerIdString) {
        router.push(
          `/admin/servicing/${account.customerIdString}?accountId=${encodeURIComponent(account.loanAccountId)}`,
        )
      } else {
        console.warn('[accounts-browser] missing customerIdString for', account.loanAccountId)
      }
    },
    [router],
  )

  // === Keyboard navigation ===
  const handlePeek = useCallback(
    (idx: number) => {
      const account = accounts[idx]
      if (!account) return
      setPeekAccount(account)
      setPeekOpen(true)
    },
    [accounts],
  )

  const handleOpenFromKeyboard = useCallback(
    (idx: number) => {
      const account = accounts[idx]
      if (account) openServicing(account)
    },
    [accounts, openServicing],
  )

  const handleCopyFromKeyboard = useCallback(
    (idx: number) => {
      const account = accounts[idx]
      if (!account?.accountNumber) return
      void navigator.clipboard.writeText(account.accountNumber).catch(() => {
        /* clipboard unavailable — ignore */
      })
    },
    [accounts],
  )

  const { index: focusedIndex, setIndex: setFocusedIndex } = useListKeyboardNav({
    count: accounts.length,
    onPeek: handlePeek,
    onOpen: handleOpenFromKeyboard,
    onCopy: handleCopyFromKeyboard,
    // Keep keyboard nav listening even when the drawer is open, so the user
    // can press `c` after clicking a row to copy without dismissing the peek.
    // We only disable when the cheatsheet modal is open to avoid double-binding.
    enabled: !cheatsheetOpen,
  })

  // Click handler — sync the keyboard cursor so subsequent `c`, `Space`,
  // `Enter` target the clicked row.
  const handleRowClick = useCallback(
    (account: LoanAccount, idx: number) => {
      setPeekAccount(account)
      setPeekOpen(true)
      setFocusedIndex(idx)
    },
    [setFocusedIndex],
  )

  // When the keyboard cursor moves and the drawer is open, swap the previewed
  // account to match — the inbox/Superhuman feel where j/k flips through
  // rows without dismissing the preview.
  useEffect(() => {
    if (!peekOpen) return
    const next = focusedIndex >= 0 ? accounts[focusedIndex] : null
    if (next) setPeekAccount(next)
  }, [focusedIndex, peekOpen, accounts])

  // === CSV export (client-side, current page) ===
  const exportCsv = useCallback(() => {
    if (accounts.length === 0) return
    const headers = [
      'Account number',
      'Customer',
      'Status',
      'Outstanding',
      'Total paid',
      'Last payment date',
      'Last payment amount',
      'Opened date',
      'Payment frequency',
      'Closure reason',
      'Closed date',
    ]
    const csvEscape = (v: unknown): string => {
      if (v == null) return ''
      const s = String(v)
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }
    const rows = accounts.map((a) => [
      a.accountNumber,
      a.customerName ?? '',
      a.accountStatus,
      a.balances?.totalOutstanding != null ? formatCurrency(a.balances.totalOutstanding) : '',
      a.balances?.totalPaid != null ? formatCurrency(a.balances.totalPaid) : '',
      a.lastPayment?.date ?? '',
      a.lastPayment?.amount != null ? formatCurrency(a.lastPayment.amount) : '',
      a.loanTerms?.openedDate ?? '',
      a.repaymentSchedule?.paymentFrequency ?? '',
      a.closure?.reason ?? '',
      a.closure?.closedDate ?? '',
    ])
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const stamp = new Date().toISOString().slice(0, 10)
    const viewSlug = urlFilters.view ?? 'all'
    link.download = `accounts-${viewSlug}-${stamp}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }, [accounts, urlFilters.view])

  // === Global hotkeys for `?` (cheatsheet) and `⌘E` (export) ===
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inInput =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        exportCsv()
        return
      }

      if (inInput) return
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setCheatsheetOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [exportCsv])

  const activeView = getSmartView(urlFilters.view)
  const headerTitle = activeView ? activeView.label : 'All accounts'
  const headerDescription = activeView?.description

  return (
    <div className={styles.container} data-testid="accounts-browser-view">
      <SmartViewRail activeViewId={urlFilters.view} onSelect={handleSelectView} />

      <main className={styles.main}>
        <div className={styles.mainHeader}>
          <div>
            <h1 className={styles.mainTitle}>{headerTitle}</h1>
            {headerDescription && (
              <div className={styles.mainDescription}>{headerDescription}</div>
            )}
          </div>
        </div>

        <FilterBar
          filters={effectiveFilters}
          onChange={writeFilters}
          totalDocs={totalDocs}
          isFetching={isFetching}
          onExport={exportCsv}
          onShowShortcuts={() => setCheatsheetOpen(true)}
        />

        <div className={styles.tableWrapper}>
          <AccountsTable
            accounts={accounts}
            isLoading={isLoading}
            sort={effectiveFilters.sort ?? DEFAULT_SORT}
            focusedIndex={focusedIndex}
            onRowClick={handleRowClick}
            onRowDoubleClick={openServicing}
            onSortChange={handleSortChange}
          />

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => handlePageChange(page - 1)}
                disabled={!hasPrevPage}
              >
                ← Previous
              </button>
              <span className={styles.pageInfo}>
                Page {page} of {totalPages} · {totalDocs.toLocaleString('en-AU')} total
              </span>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => handlePageChange(page + 1)}
                disabled={!hasNextPage}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </main>

      <AccountPeekDrawer
        account={peekAccount}
        isOpen={peekOpen}
        onClose={() => setPeekOpen(false)}
        onOpenServicing={(account) => {
          setPeekOpen(false)
          openServicing(account)
        }}
      />

      <ShortcutsCheatsheet
        isOpen={cheatsheetOpen}
        onClose={() => setCheatsheetOpen(false)}
      />
    </div>
  )
}
