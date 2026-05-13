import type { FiltersInput } from './account-filters'

/**
 * A curated, code-defined view over the account browser. Each Smart View is a
 * set of default filters and a sort, applied when the user clicks the view in
 * the left rail. Explicit URL params always override view defaults so
 * operators can refine without losing the view's context.
 *
 * Smart Views are team-shared and versioned in code; per-user "Saved Views"
 * are phase 3.
 */
export interface SmartView {
  /** Stable URL slug. Lives in `?view=<id>`. */
  id: string
  /** Sidebar / chip label. */
  label: string
  /** Emoji or short prefix shown in the rail. */
  icon: string
  /** Tooltip / one-liner description. */
  description: string
  /**
   * Resolve the view's default filters. Accepts `now` so time-relative
   * presets ("disbursed today", "last 30 days") stay deterministic and
   * testable.
   */
  resolve: (now: Date) => Partial<FiltersInput>
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (now: Date, n: number) => {
  const d = new Date(now)
  d.setDate(d.getDate() - n)
  return isoDay(d)
}

export const SMART_VIEWS: SmartView[] = [
  {
    id: 'all',
    label: 'All accounts',
    icon: '📥',
    description: 'Every account, newest first',
    resolve: () => ({ sort: '-createdAt' }),
  },
  {
    id: 'arrears',
    label: 'Arrears',
    icon: '📈',
    description: 'In-arrears accounts (per aging service), highest DPD first',
    resolve: () => ({ isInArrears: true, sort: '-aging.currentDPD' }),
  },
  {
    id: 'high-value-at-risk',
    label: 'High value at risk',
    icon: '💰',
    description: 'In arrears with balance over $500',
    resolve: () => ({
      isInArrears: true,
      minBalance: 500,
      sort: '-balances.totalOutstanding',
    }),
  },
  {
    id: 'disbursed-today',
    label: 'Disbursed today',
    icon: '📅',
    description: 'Active accounts disbursed today — sanity-check the run',
    resolve: (now) => ({
      status: ['active'],
      openedFrom: isoDay(now),
      openedTo: isoDay(now),
      sort: '-loanTerms.openedDate',
    }),
  },
  {
    id: 'pending-disbursement',
    label: 'Pending disbursement',
    icon: '✎',
    description: 'Accounts awaiting disbursement',
    resolve: () => ({ status: ['pending_disbursement'], sort: '-createdAt' }),
  },
  {
    id: 'recent-payoff',
    label: 'Recently paid off',
    icon: '✅',
    description: 'Paid off in the last 30 days',
    resolve: (now) => ({
      status: ['paid_off'],
      closedFrom: daysAgo(now, 30),
      sort: '-closure.closedDate',
    }),
  },
  {
    id: 'written-off-30d',
    label: 'Written off — last 30d',
    icon: '⚠',
    description: 'Written off in the last 30 days',
    resolve: (now) => ({
      closureReason: 'WRITTEN_OFF',
      closedFrom: daysAgo(now, 30),
      sort: '-closure.closedDate',
    }),
  },
  {
    id: 'deceased',
    label: 'Deceased customer',
    icon: '⚰️',
    description: 'Accounts whose customer is marked DECEASED — suppress comms',
    resolve: () => ({ customerStatus: 'DECEASED', sort: '-updatedAt' }),
  },
]

export const SMART_VIEW_IDS: readonly string[] = SMART_VIEWS.map((v) => v.id)

export function getSmartView(id: string | undefined | null): SmartView | undefined {
  if (!id) return undefined
  return SMART_VIEWS.find((v) => v.id === id)
}

/**
 * Merge a Smart View's defaults into a filter input. Explicit values win:
 * a user-supplied `minBalance` overrides the view's default but inherits the
 * view's `status` and `sort` when the user didn't set them.
 *
 * Returns `filters` unchanged if no `view` is specified or the id is unknown.
 */
export function applySmartViewDefaults(
  filters: FiltersInput,
  now: Date = new Date(),
): FiltersInput {
  const view = getSmartView(filters.view)
  if (!view) return filters
  const d = view.resolve(now)

  return {
    ...filters,
    status: filters.status?.length ? filters.status : d.status,
    minBalance: filters.minBalance ?? d.minBalance,
    maxBalance: filters.maxBalance ?? d.maxBalance,
    openedFrom: filters.openedFrom ?? d.openedFrom,
    openedTo: filters.openedTo ?? d.openedTo,
    closedFrom: filters.closedFrom ?? d.closedFrom,
    closedTo: filters.closedTo ?? d.closedTo,
    lastPmtBefore: filters.lastPmtBefore ?? d.lastPmtBefore,
    closureReason: filters.closureReason ?? d.closureReason,
    customerStatus: filters.customerStatus ?? d.customerStatus,
    paymentFrequency: filters.paymentFrequency ?? d.paymentFrequency,
    isInArrears: filters.isInArrears ?? d.isInArrears,
    agingBucket: filters.agingBucket?.length ? filters.agingBucket : d.agingBucket,
    minDpd: filters.minDpd ?? d.minDpd,
    sort: filters.sort ?? d.sort,
  }
}
