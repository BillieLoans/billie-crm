'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useDashboard } from '@/hooks/queries/useDashboard'
import { formatCurrency } from '@/lib/formatters'
import type { UpcomingPayment } from '@/lib/schemas/dashboard'
import { SectionCard } from './primitives/SectionCard'
import styles from './UpcomingPaymentsGrouped.module.css'

type Variant = 'overdue' | 'today' | 'tomorrow' | 'upcoming'

function variantFor(daysUntilDue: number): Variant {
  if (daysUntilDue < 0) return 'overdue'
  if (daysUntilDue === 0) return 'today'
  if (daysUntilDue === 1) return 'tomorrow'
  return 'upcoming'
}

function formatDateHeading(dueDate: string, daysUntilDue: number): string {
  if (daysUntilDue === 0) return 'Today'
  if (daysUntilDue === 1) return 'Tomorrow'
  if (daysUntilDue === -1) return 'Yesterday'
  const date = new Date(dueDate)
  const formatted = date.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  if (daysUntilDue < 0) return `${formatted} · ${-daysUntilDue}d overdue`
  return formatted
}

interface PaymentGroup {
  dueDate: string
  daysUntilDue: number
  variant: Variant
  payments: UpcomingPayment[]
  total: number
}

export function UpcomingPaymentsGrouped() {
  const { data, isLoading } = useDashboard()
  const payments = data?.upcomingPayments ?? []

  const { groups, totalAmount, concentrationNote } = useMemo(() => {
    const map = new Map<string, PaymentGroup>()
    const customerSums = new Map<string, { name: string; count: number }>()
    let runningTotal = 0

    for (const p of payments) {
      const key = p.dueDate
      let g = map.get(key)
      if (!g) {
        g = {
          dueDate: p.dueDate,
          daysUntilDue: p.daysUntilDue,
          variant: variantFor(p.daysUntilDue),
          payments: [],
          total: 0,
        }
        map.set(key, g)
      }
      g.payments.push(p)
      g.total += p.amount
      runningTotal += p.amount

      const existing = customerSums.get(p.customerId) ?? { name: p.customerName, count: 0 }
      existing.count += 1
      existing.name = p.customerName || existing.name
      customerSums.set(p.customerId, existing)
    }

    const sortedGroups = Array.from(map.values()).sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
    )

    let note: string | null = null
    const concentrated = Array.from(customerSums.values())
      .filter((c) => c.count > 1)
      .sort((a, b) => b.count - a.count)[0]
    if (concentrated) {
      note = `${concentrated.count} payments belong to ${concentrated.name}`
    }

    return { groups: sortedGroups, totalAmount: runningTotal, concentrationNote: note }
  }, [payments])

  const summary =
    payments.length === 0
      ? 'No upcoming payments'
      : `${formatCurrency(totalAmount)} across ${payments.length} payment${payments.length === 1 ? '' : 's'}`

  return (
    <SectionCard
      title="Upcoming Payments"
      action={<Link href="/admin/accounts">View all →</Link>}
      testId="upcoming-payments-grouped"
    >
      <div className={styles.summary}>
        <span>{summary}</span>
        {concentrationNote && <span className={styles.note}>· {concentrationNote}</span>}
      </div>
      {isLoading && <div className={styles.loading}>Loading…</div>}
      {!isLoading && groups.length === 0 && (
        <div className={styles.empty}>Nothing scheduled in the next 14 days.</div>
      )}
      {groups.map((g) => (
        <div key={g.dueDate} className={styles.group} data-variant={g.variant}>
          <div className={styles.groupHeader}>
            <span className={styles.groupDate}>
              {formatDateHeading(g.dueDate, g.daysUntilDue)}
            </span>
            <span className={styles.groupTotal}>{formatCurrency(g.total)}</span>
          </div>
          <ul className={styles.groupList}>
            {g.payments.map((p) => (
              <li key={`${p.loanAccountId}-${p.dueDate}`} className={styles.paymentRow}>
                <Link
                  href={`/admin/servicing/${p.customerId}?accountId=${encodeURIComponent(p.loanAccountId)}`}
                  className={styles.paymentLink}
                >
                  <span className={styles.customer}>{p.customerName}</span>
                  <span className={styles.accountNumber}>{p.accountNumber}</span>
                  <span className={styles.amount}>{p.amountFormatted}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </SectionCard>
  )
}
