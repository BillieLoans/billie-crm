// src/lib/accountTriage.ts
import type { CustomerData, LoanAccountData } from '@/hooks/queries/useCustomer'
import { formatBlockReason, formatBlockedUntil, isBlockActive } from '@/lib/reapplicationBlock'
import type { CollectionsCaseRow } from '@/types/collections'

export type AccountTier = 'overdue' | 'pending' | 'active' | 'closed'

export interface AccountSignal {
  tier: AccountTier
  isOverdue: boolean
  daysOverdue: number
  nextDueDate: string | null
  nextDueAmount: number | null
}

export interface AttentionItem {
  kind:
    | 'vulnerable'
    | 'overdue'
    | 'pending_disbursement'
    | 'writeoff_pending'
    | 'reapplication_blocked'
    | 'collections'
    | 'hardship'
    | 'stop_contact'
  label: string
  accountId: string | null
  severity: 'high' | 'medium'
}

const MS_PER_DAY = 86_400_000
const TIER_RANK: Record<AccountTier, number> = { overdue: 0, pending: 1, active: 2, closed: 3 }

const startOfDay = (d: Date): number => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

const outstanding = (a: LoanAccountData): number =>
  a.liveBalance?.totalOutstanding ?? a.balances?.totalOutstanding ?? 0

export function getAccountSignal(account: LoanAccountData, today: Date = new Date()): AccountSignal {
  const status = account.accountStatus
  if (status === 'paid_off' || status === 'written_off') {
    return { tier: 'closed', isOverdue: false, daysOverdue: 0, nextDueDate: null, nextDueAmount: null }
  }
  if (status === 'pending_disbursement') {
    return { tier: 'pending', isOverdue: false, daysOverdue: 0, nextDueDate: null, nextDueAmount: null }
  }

  const unpaid = (account.repaymentSchedule?.payments ?? [])
    .filter((p) => p.status !== 'paid' && p.dueDate)
    .sort((a, b) => +new Date(a.dueDate as string) - +new Date(b.dueDate as string))

  const nextDueDate = unpaid[0]?.dueDate ?? null
  const nextDueAmount = unpaid[0]?.amount ?? null
  const todayMs = startOfDay(today)
  const pastDue = unpaid.filter((p) => startOfDay(new Date(p.dueDate as string)) < todayMs)
  const isOverdue = status === 'in_arrears' || pastDue.length > 0
  const daysOverdue =
    pastDue.length > 0
      ? Math.floor((todayMs - startOfDay(new Date(pastDue[0].dueDate as string))) / MS_PER_DAY)
      : 0

  return { tier: isOverdue ? 'overdue' : 'active', isOverdue, daysOverdue, nextDueDate, nextDueAmount }
}

export function sortAccountsForRail(
  accounts: LoanAccountData[],
  today: Date = new Date(),
): { active: LoanAccountData[]; closed: LoanAccountData[] } {
  const withSig = accounts.map((a) => ({ a, s: getAccountSignal(a, today) }))

  const active = withSig
    .filter((x) => x.s.tier !== 'closed')
    .sort((x, y) => {
      if (TIER_RANK[x.s.tier] !== TIER_RANK[y.s.tier]) return TIER_RANK[x.s.tier] - TIER_RANK[y.s.tier]
      if (x.s.tier === 'overdue' && x.s.daysOverdue !== y.s.daysOverdue) return y.s.daysOverdue - x.s.daysOverdue
      return outstanding(y.a) - outstanding(x.a)
    })
    .map((x) => x.a)

  const closed = withSig
    .filter((x) => x.s.tier === 'closed')
    .sort((x, y) => +new Date(y.a.updatedAt ?? 0) - +new Date(x.a.updatedAt ?? 0))
    .map((x) => x.a)

  return { active, closed }
}

export function getAttentionItems(opts: {
  vulnerable: boolean
  accounts: LoanAccountData[]
  pendingWriteOffAccountIds?: string[]
  reapplicationBlock?: CustomerData['reapplicationBlock']
  collectionsCases?: CollectionsCaseRow[]
  today?: Date
}): AttentionItem[] {
  const {
    vulnerable,
    accounts,
    pendingWriteOffAccountIds = [],
    reapplicationBlock = null,
    collectionsCases = [],
    today = new Date(),
  } = opts
  const items: AttentionItem[] = []

  if (vulnerable) {
    items.push({ kind: 'vulnerable', label: 'Vulnerable customer', accountId: null, severity: 'high' })
  }

  // Re-application block (BTB-135) — customer-level, mirrored from the blocking
  // application. Hidden once the exclusion window has lapsed.
  if (isBlockActive(reapplicationBlock, today)) {
    items.push({
      kind: 'reapplication_blocked',
      label: `Re-application blocked — ${formatBlockReason(reapplicationBlock?.reason)} (${formatBlockedUntil(reapplicationBlock ?? {})})`,
      accountId: null,
      severity: 'high',
    })
  }

  const sigs = accounts.map((a) => ({ a, s: getAccountSignal(a, today) }))

  const overdue = sigs.filter((x) => x.s.tier === 'overdue').sort((x, y) => y.s.daysOverdue - x.s.daysOverdue)
  if (overdue.length) {
    items.push({
      kind: 'overdue',
      label: overdue.length === 1 ? '1 account overdue' : `${overdue.length} accounts overdue`,
      accountId: overdue[0].a.loanAccountId,
      severity: 'high',
    })
  }

  const pending = sigs.filter((x) => x.s.tier === 'pending')
  if (pending.length) {
    items.push({
      kind: 'pending_disbursement',
      label: pending.length === 1 ? '1 pending disbursement' : `${pending.length} pending disbursement`,
      accountId: pending[0].a.loanAccountId,
      severity: 'medium',
    })
  }

  const wo = accounts.filter((a) => pendingWriteOffAccountIds.includes(a.loanAccountId))
  if (wo.length) {
    items.push({
      kind: 'writeoff_pending',
      label: wo.length === 1 ? '1 write-off pending' : `${wo.length} write-offs pending`,
      accountId: wo[0].loanAccountId,
      severity: 'medium',
    })
  }

  // Collections (BTB-197 WS4) — a case + hardship pause are PER-ACCOUNT signals
  // (accountId set, one chip per open/awaiting_human case). Contact suppression
  // is a CUSTOMER-LEVEL signal — a single chip with accountId null, since it
  // applies across the whole customer relationship rather than one loan.
  // Cured cases carry no per-account attention signal.
  //
  // stop_contact is durable across cure (final-review Fix 4): a stop-contact
  // instruction (dispute/deceased/legal) is a standing suppression on the
  // customer relationship, not tied to any one case's lifecycle — a case
  // curing must not silently drop the contact ban. So this is computed over
  // ALL collectionsCases, not just activeCases.
  const activeCases = collectionsCases.filter((c) => c.state !== 'cured')
  const anyStoppedContact = collectionsCases.some((c) => c.stoppedContact)
  for (const c of activeCases) {
    items.push({
      kind: 'collections',
      label: c.state === 'awaiting_human' ? 'Awaiting human' : 'In collections',
      accountId: c.accountId,
      severity: 'high',
    })
    if (c.hardshipPaused) {
      items.push({
        kind: 'hardship',
        label: 'Hardship paused',
        accountId: c.accountId,
        severity: 'medium',
      })
    }
  }
  if (anyStoppedContact) {
    items.push({
      kind: 'stop_contact',
      label: 'Contact stopped',
      accountId: null,
      severity: 'high',
    })
  }

  return items
}
