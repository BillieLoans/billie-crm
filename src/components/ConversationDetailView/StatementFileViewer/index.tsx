'use client'

import React, { useState } from 'react'
import { ContextDrawer } from '@/components/ui/ContextDrawer'
import {
  useStatementFile,
  rawStatementFileUrl,
  type StatementSlot,
  type StatementFileContent,
  type CsvData,
} from '@/hooks'
import { formatCurrency } from '@/lib/formatters'
import { METRIC_CATALOG, METRIC_CATEGORY_ORDER, type MetricKind } from './metricCatalog'
import styles from './styles.module.css'

interface StatementFileViewerProps {
  conversationId: string
  slot: StatementSlot | null
  onClose: () => void
}

const SLOT_LABELS: Record<StatementSlot, string> = {
  statementData: 'Bank statement data',
  categorizedTransactions: 'Categorised transactions',
  affordabilityReport: 'Affordability report',
  accounts: 'Accounts summary',
}

export function StatementFileViewer({ conversationId, slot, onClose }: StatementFileViewerProps) {
  const { data, isLoading, error } = useStatementFile(conversationId, slot ?? undefined)
  const title = slot ? SLOT_LABELS[slot] : ''
  const rawUrl = slot ? rawStatementFileUrl(conversationId, slot) : '#'

  return (
    <ContextDrawer isOpen={slot !== null} onClose={onClose} title={title} maxWidth="820px">
      {slot && (
        <div className={styles.viewer}>
          <div className={styles.toolbar}>
            <div className={styles.filename}>{data?.filename ?? '—'}</div>
            <a
              href={rawUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.downloadButton}
              download
            >
              ⤓ Download raw
            </a>
          </div>

          {isLoading && (
            <div className={styles.skeletonWrap}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={styles.skeleton} aria-hidden="true" />
              ))}
            </div>
          )}

          {!isLoading && (error || data === null) && (
            <div className={styles.notAvailable}>
              <p>{error instanceof Error ? error.message : 'File not available.'}</p>
            </div>
          )}

          {!isLoading && data && <FileContent slot={slot} content={data} />}
        </div>
      )}
    </ContextDrawer>
  )
}

function FileContent({ slot, content }: { slot: StatementSlot; content: StatementFileContent }) {
  if (content.kind === 'csv') return <CsvTable csv={content.data} />
  if (content.kind === 'text') return <pre className={styles.textBlock}>{content.data}</pre>

  // content.kind === 'json'
  if (slot === 'affordabilityReport' && isAffordabilityShape(content.data)) {
    return <AffordabilityReport data={content.data} />
  }
  if (slot === 'accounts' && isAccountsSummaryShape(content.data)) {
    return <AccountsSummary data={content.data} />
  }
  if (slot === 'statementData' && isBankStatementDataShape(content.data)) {
    return <BankStatementData data={content.data} />
  }
  return <GenericJson data={content.data} />
}

// ══════════════════════════════════════════════════════════════════════════════
// Affordability report — { data: { metrics: [{id, result:{value}}], groups: [...] } }
// ══════════════════════════════════════════════════════════════════════════════

interface AffordabilityMetric {
  id?: string
  result?: { value?: unknown }
}

interface AffordabilityGroup {
  id?: string
  analysis?: {
    summary?: { transactionCount?: number; overallPercentage?: { credit?: number; debit?: number } }
    amount?: { total?: string | number; average?: { transaction?: string | number } }
    range?: { startDate?: string; endDate?: string }
  }
}

interface AffordabilityShape {
  data: {
    metrics?: AffordabilityMetric[]
    groups?: AffordabilityGroup[]
  }
}

function isAffordabilityShape(v: unknown): v is AffordabilityShape {
  if (typeof v !== 'object' || v === null) return false
  const data = (v as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return false
  return 'metrics' in data || 'groups' in data
}

function AffordabilityReport({ data }: { data: AffordabilityShape }) {
  const metrics = data.data.metrics ?? []
  const groups = data.data.groups ?? []

  const byCategory = new Map<string, AffordabilityMetric[]>()
  const uncategorized: AffordabilityMetric[] = []
  for (const m of metrics) {
    const meta = m.id ? METRIC_CATALOG[m.id] : undefined
    if (meta) {
      const arr = byCategory.get(meta.category) ?? []
      arr.push(m)
      byCategory.set(meta.category, arr)
    } else {
      uncategorized.push(m)
    }
  }

  return (
    <div className={styles.content}>
      {METRIC_CATEGORY_ORDER.map((cat) => {
        const items = byCategory.get(cat)
        if (!items || items.length === 0) return null
        return (
          <section key={cat} className={styles.section}>
            <h3 className={styles.sectionTitle}>
              {cat}
              <span className={styles.count}>{items.length}</span>
            </h3>
            <table className={styles.table}>
              <tbody>
                {items.map((m) => {
                  const meta = METRIC_CATALOG[m.id!]
                  return (
                    <tr key={m.id}>
                      <td className={styles.metricLabel}>
                        {meta.label}
                        <span className={styles.metricId}>{m.id}</span>
                      </td>
                      <td className={styles.numberCol}>
                        {formatTypedValue(m.result?.value, meta.kind)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )
      })}

      {uncategorized.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            Other metrics
            <span className={styles.count}>{uncategorized.length}</span>
          </h3>
          <table className={styles.table}>
            <tbody>
              {uncategorized.map((m, i) => (
                <tr key={m.id ?? i}>
                  <td className={styles.metricLabel}>
                    <span className={styles.metricId}>{m.id ?? `metric-${i + 1}`}</span>
                  </td>
                  <td className={styles.numberCol}>{formatMetricValue(m.result?.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {groups.length > 0 && <CategoryGroups groups={groups} />}

      <RawJsonToggle data={data} />
    </div>
  )
}

function CategoryGroups({ groups }: { groups: AffordabilityGroup[] }) {
  const [open, setOpen] = useState(false)
  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.collapsibleHeader}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <h3 className={styles.sectionTitle}>
          Category breakdown
          <span className={styles.count}>{groups.length}</span>
        </h3>
        <span className={`${styles.rawChevron} ${open ? styles.rawChevronOpen : ''}`} aria-hidden="true">▶</span>
      </button>
      {open && (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Category</th>
                <th className={styles.numberCol}>Transactions</th>
                <th className={styles.numberCol}>Total</th>
                <th className={styles.numberCol}>Avg / txn</th>
                <th>Range</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => {
                const a = g.analysis
                const total = a?.amount?.total
                const avg = a?.amount?.average?.transaction
                const totalNum = typeof total === 'string' ? parseFloat(total) : total
                const avgNum = typeof avg === 'string' ? parseFloat(avg) : avg
                return (
                  <tr key={g.id ?? i}>
                    <td className={styles.metricId}>{g.id ?? '—'}</td>
                    <td className={styles.numberCol}>{a?.summary?.transactionCount ?? '—'}</td>
                    <td className={styles.numberCol}>{formatTypedValue(totalNum, 'money')}</td>
                    <td className={styles.numberCol}>{formatTypedValue(avgNum, 'money')}</td>
                    <td>
                      {a?.range?.startDate && a?.range?.endDate
                        ? `${a.range.startDate} → ${a.range.endDate}`
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function formatTypedValue(v: unknown, kind: MetricKind): string {
  if (v === undefined || v === null) return '—'
  if (kind === 'boolean') {
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    return String(v)
  }
  if (kind === 'integer') {
    if (typeof v === 'number') return Math.round(v).toLocaleString('en-AU')
    return String(v)
  }
  if (kind === 'percent') {
    if (typeof v === 'number') return `${v.toFixed(2)}%`
    return String(v)
  }
  // money
  if (typeof v === 'number') {
    if (v === 0) return formatCurrency(0)
    try {
      return formatCurrency(v)
    } catch {
      return v.toFixed(2)
    }
  }
  return String(v)
}

function formatMetricValue(v: unknown): string {
  if (v === undefined || v === null) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) < 1000) return String(v)
    try {
      return formatCurrency(v)
    } catch {
      return v.toFixed(2)
    }
  }
  return String(v)
}

// ══════════════════════════════════════════════════════════════════════════════
// Accounts summary — { data: [{id, accountHolder, accountNo, name, bsb, class, source}] }
// ══════════════════════════════════════════════════════════════════════════════

interface AccountSummaryRow {
  id?: string
  accountHolder?: string
  accountNo?: string
  unmaskedAccNum?: string
  name?: string
  bsb?: string
  class?: { type?: string }
  source?: string
}

interface AccountsSummaryShape {
  data: AccountSummaryRow[]
}

function isAccountsSummaryShape(v: unknown): v is AccountsSummaryShape {
  if (typeof v !== 'object' || v === null) return false
  const data = (v as { data?: unknown }).data
  return Array.isArray(data)
}

function AccountsSummary({ data }: { data: AccountsSummaryShape }) {
  const accounts = data.data
  if (accounts.length === 0) {
    return <p className={styles.emptyHint}>No accounts in this file.</p>
  }
  return (
    <div className={styles.content}>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          Accounts
          <span className={styles.count}>{accounts.length}</span>
        </h3>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Account holder</th>
                <th>Name</th>
                <th>BSB</th>
                <th>Account #</th>
                <th>Type</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a, i) => (
                <tr key={a.id ?? i}>
                  <td>{a.accountHolder ?? '—'}</td>
                  <td>{a.name ?? '—'}</td>
                  <td className={styles.metricId}>{a.bsb ?? '—'}</td>
                  <td className={styles.metricId}>{a.accountNo ?? '—'}</td>
                  <td>{a.class?.type ?? '—'}</td>
                  <td>{a.source ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <RawJsonToggle data={data} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Bank statement data — { accounts: { bank_of_statements: { accounts: [...] } } }
// ══════════════════════════════════════════════════════════════════════════════

interface StatementTxn {
  date?: string
  text?: string
  notes?: string | null
  amount?: number
  type?: string
  balance?: string | number
}

interface StatementAccount {
  accountHolder?: string
  name?: string
  accountNumber?: string
  bsb?: string
  balance?: string | number
  available?: string | number
  accountType?: string
  accountHolderType?: string
  institution?: string
  openDate?: string
  interestRate?: string | number
  statementData?: { details?: StatementTxn[] }
}

interface BankStatementDataShape {
  accounts: { bank_of_statements?: { accounts?: StatementAccount[] } }
}

function isBankStatementDataShape(v: unknown): v is BankStatementDataShape {
  if (typeof v !== 'object' || v === null) return false
  const accounts = (v as { accounts?: unknown }).accounts
  if (typeof accounts !== 'object' || accounts === null) return false
  return 'bank_of_statements' in accounts
}

const TXN_DISPLAY_LIMIT = 500

function BankStatementData({ data }: { data: BankStatementDataShape }) {
  const accounts = data.accounts.bank_of_statements?.accounts ?? []
  return (
    <div className={styles.content}>
      {accounts.length === 0 && <p className={styles.emptyHint}>No accounts found.</p>}
      {accounts.map((account, i) => (
        <StatementAccountSection key={i} account={account} />
      ))}
      <RawJsonToggle data={data} />
    </div>
  )
}

function StatementAccountSection({ account }: { account: StatementAccount }) {
  const [open, setOpen] = useState(true)
  const txns = account.statementData?.details ?? []
  const visibleTxns = txns.slice(0, TXN_DISPLAY_LIMIT)
  const truncated = txns.length > TXN_DISPLAY_LIMIT

  return (
    <section className={styles.section}>
      <div className={styles.accountCard}>
        <div className={styles.accountHeader}>
          <div>
            <div className={styles.accountName}>{account.name ?? 'Account'}</div>
            <div className={styles.accountHolder}>{account.accountHolder ?? '—'}</div>
          </div>
          <div className={styles.accountBalance}>
            <div className={styles.metaLabel}>Balance</div>
            <div className={styles.balanceValue}>{formatTypedValue(toNumber(account.balance), 'money')}</div>
            {account.available != null && account.available !== account.balance && (
              <div className={styles.availableValue}>
                {formatTypedValue(toNumber(account.available), 'money')} available
              </div>
            )}
          </div>
        </div>
        <dl className={styles.accountMeta}>
          {account.institution && (<><dt>Institution</dt><dd>{account.institution}</dd></>)}
          {account.bsb && (<><dt>BSB</dt><dd className={styles.metricId}>{account.bsb}</dd></>)}
          {account.accountNumber && (<><dt>Account</dt><dd className={styles.metricId}>{account.accountNumber}</dd></>)}
          {account.accountType && (<><dt>Type</dt><dd>{account.accountType}</dd></>)}
          {account.openDate && (<><dt>Open date</dt><dd>{account.openDate}</dd></>)}
        </dl>
      </div>

      <button
        type="button"
        className={styles.collapsibleHeader}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <h4 className={styles.subSectionTitle}>
          Transactions
          <span className={styles.count}>
            {truncated ? `${visibleTxns.length} of ${txns.length}` : txns.length}
          </span>
        </h4>
        <span className={`${styles.rawChevron} ${open ? styles.rawChevronOpen : ''}`} aria-hidden="true">▶</span>
      </button>

      {open && txns.length > 0 && (
        <>
          {truncated && (
            <p className={styles.truncationNotice}>
              Showing the first {visibleTxns.length.toLocaleString()} of {txns.length.toLocaleString()} transactions. Download the raw file for the full list.
            </p>
          )}
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th className={styles.numberCol}>Amount</th>
                  <th className={styles.numberCol}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {visibleTxns.map((t, i) => {
                  const isDebit = (t.type ?? '').toLowerCase() === 'debit'
                  const signedAmount = typeof t.amount === 'number' && isDebit ? -t.amount : t.amount
                  return (
                    <tr key={i}>
                      <td className={styles.dateCell}>{t.date ?? '—'}</td>
                      <td className={styles.txnText}>{t.text ?? '—'}</td>
                      <td>{t.type ?? '—'}</td>
                      <td className={`${styles.numberCol} ${isDebit ? styles.negative : styles.positive}`}>
                        {formatTypedValue(signedAmount, 'money')}
                      </td>
                      <td className={styles.numberCol}>{formatTypedValue(toNumber(t.balance), 'money')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isNaN(n) ? undefined : n
  }
  return undefined
}

// ══════════════════════════════════════════════════════════════════════════════
// CSV renderer (categorised transactions)
// ══════════════════════════════════════════════════════════════════════════════

function CsvTable({ csv }: { csv: CsvData }) {
  return (
    <div className={styles.content}>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          Rows
          <span className={styles.count}>
            {csv.truncated ? `${csv.rows.length} of ${csv.totalRows}` : csv.totalRows}
          </span>
        </h3>
        {csv.truncated && (
          <p className={styles.truncationNotice}>
            Showing the first {csv.rows.length.toLocaleString()} rows. Use “Download raw” for the full file.
          </p>
        )}
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {csv.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {csv.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Generic JSON fallback
// ══════════════════════════════════════════════════════════════════════════════

function GenericJson({ data }: { data: unknown }) {
  if (Array.isArray(data)) {
    return (
      <div className={styles.content}>
        <ArrayRenderer items={data} />
        <RawJsonToggle data={data} />
      </div>
    )
  }
  if (typeof data === 'object' && data !== null) {
    return (
      <div className={styles.content}>
        <ObjectRenderer obj={data as Record<string, unknown>} />
        <RawJsonToggle data={data} />
      </div>
    )
  }
  return (
    <div className={styles.content}>
      <pre className={styles.textBlock}>{String(data)}</pre>
    </div>
  )
}

function ArrayRenderer({ items }: { items: unknown[] }) {
  if (items.length === 0) return <p className={styles.emptyHint}>Empty list.</p>
  const allObjects = items.every(
    (item) => typeof item === 'object' && item !== null && !Array.isArray(item),
  )
  if (allObjects) {
    const objects = items as Record<string, unknown>[]
    const columns = collectColumns(objects)
    return (
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          Records
          <span className={styles.count}>{items.length}</span>
        </h3>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{formatHeader(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {objects.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c}>{formatCell(row[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )
  }
  return (
    <ul className={styles.list}>
      {items.map((item, i) => (
        <li key={i}>{formatCell(item)}</li>
      ))}
    </ul>
  )
}

function ObjectRenderer({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj)
  return (
    <dl className={styles.metaGrid}>
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{formatHeader(k)}</dt>
          <dd>
            {Array.isArray(v) ? (
              <ArrayRenderer items={v} />
            ) : typeof v === 'object' && v !== null ? (
              <ObjectRenderer obj={v as Record<string, unknown>} />
            ) : (
              formatCell(v)
            )}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>()
  const cols: string[] = []
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k)
        cols.push(k)
      }
    }
  }
  return cols.slice(0, 12)
}

function formatHeader(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatCell(v: unknown): React.ReactNode {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) < 10000) return String(v)
    try {
      return formatCurrency(v)
    } catch {
      return v.toFixed(2)
    }
  }
  if (typeof v === 'string') return v
  return <code className={styles.inlineCode}>{JSON.stringify(v)}</code>
}

// ══════════════════════════════════════════════════════════════════════════════
// Raw toggle
// ══════════════════════════════════════════════════════════════════════════════

function RawJsonToggle({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.rawSection}>
      <button
        type="button"
        className={styles.rawToggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        Raw JSON
        <span className={`${styles.rawChevron} ${open ? styles.rawChevronOpen : ''}`} aria-hidden="true">
          ▶
        </span>
      </button>
      {open && <pre className={styles.rawJson}>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  )
}
