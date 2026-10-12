'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { StatusBadge } from '../StatusBadge'
import { formatCurrency, formatDateOnly, formatRelativeTime } from '@/lib/formatters'
import type { ConversationSummary } from '@/lib/schemas/conversations'
import type { ConversationSortField } from '@/lib/conversation-sort'
import styles from './styles.module.css'

interface Column {
  key: string
  label: string
  /** Row-level column to sort by; absent for derived columns. */
  sortKey?: ConversationSortField
  /** Shown as a tooltip — for derived columns, why they don't sort. */
  title?: string
  numeric?: boolean
}

const COLUMNS: Column[] = [
  { key: 'customer', label: 'Customer', title: 'From the customers table — not sortable' },
  { key: 'customerId', label: 'Customer ID', sortKey: 'customerIdString' },
  { key: 'application', label: 'Application', sortKey: 'applicationNumber' },
  { key: 'status', label: 'Status', sortKey: 'status' },
  { key: 'decision', label: 'Decision', sortKey: 'decisionStatus' },
  {
    key: 'amount',
    label: 'Amount',
    numeric: true,
    title: 'From the application data — not sortable',
  },
  { key: 'purpose', label: 'Purpose', title: 'From the application data — not sortable' },
  { key: 'started', label: 'Started', sortKey: 'startedAt' },
  {
    key: 'messages',
    label: 'Messages',
    numeric: true,
    title: 'Counted from messages — not sortable',
  },
  { key: 'lastActivity', label: 'Last activity', sortKey: 'updatedAt' },
]

const DECISION_LABELS: Record<string, string> = {
  approved: 'Approved',
  declined: 'Declined',
  referred: 'Referred',
  no_decision: 'Pending',
}

const Blank = () => (
  <span className={styles.muted} aria-label="none">
    —
  </span>
)

interface ApplicationsTableProps {
  conversations: ConversationSummary[]
  /** Current sort: `field` asc or `-field` desc. */
  sort: string
  onSortChange: (sort: string) => void
}

/**
 * ApplicationsTable — the Applications list view.
 *
 * One row per conversation, every column in a fixed position (dash for blanks).
 * Sortable headers are buttons inside <th scope="col"> with aria-sort on the
 * active column; a new column sorts descending first, re-clicking flips it.
 * Rows carry data-conversation-card so the view's arrow-key navigation moves
 * between them; click or Enter opens the conversation. The customer ID links
 * to the servicing profile instead (its own Tab stop; the click stays on the
 * link and does not open the row).
 */
export function ApplicationsTable({ conversations, sort, onSortChange }: ApplicationsTableProps) {
  const router = useRouter()
  const sortDesc = sort.startsWith('-')
  const sortField = sortDesc ? sort.slice(1) : sort

  const handleHeaderClick = (col: Column) => {
    if (!col.sortKey) return
    const isCurrent = sortField === col.sortKey
    onSortChange(isCurrent ? (sortDesc ? col.sortKey : `-${col.sortKey}`) : `-${col.sortKey}`)
  }

  const open = (conversationId: string) => router.push(`/admin/applications/${conversationId}`)

  return (
    <div className={styles.wrapper}>
      <table className={styles.table} aria-label="Applications">
        <thead>
          <tr>
            {COLUMNS.map((col) => {
              const active = col.sortKey != null && sortField === col.sortKey
              const ariaSort = active ? (sortDesc ? 'descending' : 'ascending') : undefined
              const cls = col.numeric ? styles.numeric : undefined
              return (
                <th key={col.key} scope="col" className={cls} aria-sort={ariaSort}>
                  {col.sortKey ? (
                    <button
                      type="button"
                      className={`${styles.headerButton} ${active ? styles.headerActive : ''}`}
                      onClick={() => handleHeaderClick(col)}
                      title={`Sort by ${col.label.toLowerCase()}`}
                    >
                      <span>{col.label}</span>
                      <span className={styles.sortIndicator} aria-hidden="true">
                        {active ? (sortDesc ? '▼' : '▲') : ''}
                      </span>
                    </button>
                  ) : (
                    <span className={styles.headerLabel} title={col.title}>
                      {col.label}
                    </span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {conversations.map((conv) => {
            const heading = conv.customer?.fullName ?? 'Unknown customer'
            const amount =
              conv.application?.loanAmount != null
                ? formatCurrency(conv.application.loanAmount)
                : null
            const decision = conv.decisionStatus
              ? (DECISION_LABELS[conv.decisionStatus] ?? conv.decisionStatus)
              : DECISION_LABELS.no_decision
            const timeDisplay = conv.lastMessageAt ?? conv.updatedAt
            return (
              <tr
                key={conv.conversationId}
                className={styles.row}
                tabIndex={0}
                data-conversation-card="true"
                aria-label={`Conversation ${conv.applicationNumber ?? conv.conversationId}: ${heading}, status ${conv.status ?? 'unknown'}`}
                onClick={() => open(conv.conversationId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    open(conv.conversationId)
                  }
                }}
              >
                <td className={styles.customer}>{heading}</td>
                <td className={styles.mono}>
                  {conv.customer?.customerId ? (
                    <Link
                      href={`/admin/servicing/${conv.customer.customerId}`}
                      className={styles.customerLink}
                      onClick={(e) => e.stopPropagation()}
                      title="Open customer profile"
                    >
                      {conv.customer.customerId}
                    </Link>
                  ) : (
                    <Blank />
                  )}
                </td>
                <td className={styles.mono}>
                  {conv.applicationNumber ? (
                    <Link
                      href={`/admin/applications/${conv.conversationId}`}
                      className={styles.appLink}
                      onClick={(e) => e.stopPropagation()}
                      tabIndex={-1}
                    >
                      {conv.applicationNumber}
                    </Link>
                  ) : (
                    <Blank />
                  )}
                </td>
                <td>
                  <StatusBadge status={conv.status} />
                </td>
                <td>{decision}</td>
                <td className={`${styles.numeric} ${styles.amount}`}>{amount ?? <Blank />}</td>
                <td>
                  {conv.application?.purpose ? (
                    <span className={styles.purpose} title={conv.application.purpose}>
                      {conv.application.purpose}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </td>
                <td>{conv.startedAt ? formatDateOnly(conv.startedAt) : <Blank />}</td>
                <td className={styles.numeric}>{conv.messageCount}</td>
                <td>{timeDisplay ? formatRelativeTime(timeDisplay) : <Blank />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
