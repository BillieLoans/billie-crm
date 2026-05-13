import { z } from 'zod'
import type { Where } from 'payload'

/** Enum values exposed in the LoanAccounts collection. */
export const ACCOUNT_STATUSES = [
  'pending_disbursement',
  'active',
  'in_arrears',
  'paid_off',
  'written_off',
] as const

export const CLOSURE_REASONS = ['PAID_OFF', 'WRITTEN_OFF', 'ADMIN_CLOSED'] as const

export const PAYMENT_FREQUENCIES = ['weekly', 'fortnightly', 'monthly'] as const

/** Mirrors the Customers collection's individualStatus enum. */
export const CUSTOMER_STATUSES = ['LIVING', 'DECEASED', 'MISSING'] as const

/** Aging buckets emitted by the platform's aging service (aging-v1.1.0+). */
export const AGING_BUCKETS = ['current', 'early_arrears', 'late_arrears', 'default', 'closed'] as const

/**
 * Whitelisted sort keys. Arbitrary deep paths are rejected to keep the URL
 * surface honest and to avoid surprises if collection shape drifts.
 *
 * Direction is encoded by a leading `-` (Payload's native convention).
 */
export const SORT_KEYS = [
  'createdAt',
  'updatedAt',
  'accountNumber',
  'accountStatus',
  'balances.totalOutstanding',
  'lastPayment.date',
  'loanTerms.openedDate',
  'loanTerms.disbursedDate',
  'closure.closedDate',
  'aging.currentDPD',
  'aging.lastUpdated',
] as const

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]
export type ClosureReason = (typeof CLOSURE_REASONS)[number]
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number]
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number]
export type AgingBucket = (typeof AGING_BUCKETS)[number]
export type SortKey = (typeof SORT_KEYS)[number]

const accountStatusEnum = z.enum(ACCOUNT_STATUSES)
const closureReasonEnum = z.enum(CLOSURE_REASONS)
const paymentFrequencyEnum = z.enum(PAYMENT_FREQUENCIES)
const customerStatusEnum = z.enum(CUSTOMER_STATUSES)
const agingBucketEnum = z.enum(AGING_BUCKETS)
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'expected ISO date (YYYY-MM-DD)')

/**
 * Sort token: optional leading `-` then a whitelisted sort key. Kept as a
 * signed string (Payload's native sort format) so we can pass it straight
 * through to `payload.find({ sort })`.
 */
const sortToken = z.string().refine((s) => {
  const key = s.startsWith('-') ? s.slice(1) : s
  return (SORT_KEYS as readonly string[]).includes(key)
}, 'unsupported sort key')

/**
 * The canonical filter state. Used by the API route, the hook, and the rail.
 * Field names mirror the URL params (snake_case → camelCase) the page accepts.
 */
export const filtersSchema = z.object({
  view: z.string().optional(),
  status: z.array(accountStatusEnum).optional(),
  minBalance: z.number().nonnegative().optional(),
  maxBalance: z.number().nonnegative().optional(),
  openedFrom: isoDate.optional(),
  openedTo: isoDate.optional(),
  disbursedFrom: isoDate.optional(),
  disbursedTo: isoDate.optional(),
  closedFrom: isoDate.optional(),
  closedTo: isoDate.optional(),
  lastPmtBefore: isoDate.optional(),
  closureReason: closureReasonEnum.optional(),
  customerStatus: customerStatusEnum.optional(),
  paymentFrequency: paymentFrequencyEnum.optional(),
  /** From aging-v1.1.0 — authoritative arrears flag (projected to LoanAccount.aging.isInArrears). */
  isInArrears: z.boolean().optional(),
  /** From aging-v1.1.0 — aging buckets, multi-select. */
  agingBucket: z.array(agingBucketEnum).optional(),
  /** Minimum DPD (inclusive). Filters on LoanAccount.aging.currentDPD. */
  minDpd: z.number().int().nonnegative().optional(),
  q: z.string().min(3).optional(),
  sort: sortToken.optional(),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(200).optional().default(50),
})

export type FiltersState = z.infer<typeof filtersSchema>

/**
 * Same shape as FiltersState but with all fields optional and no defaults
 * applied — used for Smart View definitions and incremental updates from the
 * client before re-validation.
 */
export type FiltersInput = Partial<FiltersState>

const numberFromString = (raw: string | null): number | undefined => {
  if (raw == null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Parse a URLSearchParams (or query string) into a `FiltersState`.
 *
 * Throws if values are malformed (the schema rejects them). Callers that
 * receive untrusted input should wrap this in a try/catch.
 */
export function queryStringToFilters(input: URLSearchParams | string): FiltersState {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input

  const statusRaw = params.get('status')
  const status = statusRaw
    ? statusRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined

  const agingBucketRaw = params.get('aging_bucket')
  const agingBucket = agingBucketRaw
    ? agingBucketRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined

  // `is_in_arrears=true` / `=false` — anything else collapses to undefined.
  const inArrearsRaw = params.get('is_in_arrears')
  const isInArrears =
    inArrearsRaw === 'true' ? true : inArrearsRaw === 'false' ? false : undefined

  const raw = {
    view: params.get('view') || undefined,
    status,
    minBalance: numberFromString(params.get('min_balance')),
    maxBalance: numberFromString(params.get('max_balance')),
    openedFrom: params.get('opened_from') || undefined,
    openedTo: params.get('opened_to') || undefined,
    disbursedFrom: params.get('disbursed_from') || undefined,
    disbursedTo: params.get('disbursed_to') || undefined,
    closedFrom: params.get('closed_from') || undefined,
    closedTo: params.get('closed_to') || undefined,
    lastPmtBefore: params.get('last_pmt_before') || undefined,
    closureReason: params.get('closure_reason') || undefined,
    customerStatus: params.get('customer_status') || undefined,
    paymentFrequency: params.get('payment_frequency') || undefined,
    isInArrears,
    agingBucket,
    minDpd: numberFromString(params.get('min_dpd')),
    q: params.get('q') || undefined,
    sort: params.get('sort') || undefined,
    page: numberFromString(params.get('page')),
    limit: numberFromString(params.get('limit')),
  }

  return filtersSchema.parse(raw)
}

/** Inverse of `queryStringToFilters`. Omits defaults so URLs stay short. */
export function filtersToQueryString(filters: FiltersInput): string {
  const params = new URLSearchParams()

  if (filters.view) params.set('view', filters.view)
  if (filters.status?.length) params.set('status', filters.status.join(','))
  if (filters.minBalance != null) params.set('min_balance', String(filters.minBalance))
  if (filters.maxBalance != null) params.set('max_balance', String(filters.maxBalance))
  if (filters.openedFrom) params.set('opened_from', filters.openedFrom)
  if (filters.openedTo) params.set('opened_to', filters.openedTo)
  if (filters.disbursedFrom) params.set('disbursed_from', filters.disbursedFrom)
  if (filters.disbursedTo) params.set('disbursed_to', filters.disbursedTo)
  if (filters.closedFrom) params.set('closed_from', filters.closedFrom)
  if (filters.closedTo) params.set('closed_to', filters.closedTo)
  if (filters.lastPmtBefore) params.set('last_pmt_before', filters.lastPmtBefore)
  if (filters.closureReason) params.set('closure_reason', filters.closureReason)
  if (filters.customerStatus) params.set('customer_status', filters.customerStatus)
  if (filters.paymentFrequency) params.set('payment_frequency', filters.paymentFrequency)
  if (filters.isInArrears != null) params.set('is_in_arrears', String(filters.isInArrears))
  if (filters.agingBucket?.length) params.set('aging_bucket', filters.agingBucket.join(','))
  if (filters.minDpd != null) params.set('min_dpd', String(filters.minDpd))
  if (filters.q) params.set('q', filters.q)
  if (filters.sort) params.set('sort', filters.sort)
  if (filters.page && filters.page > 1) params.set('page', String(filters.page))
  if (filters.limit && filters.limit !== 50) params.set('limit', String(filters.limit))

  return params.toString()
}

/**
 * Date fields on `LoanAccounts` are stored as full ISO timestamps. A naive
 * `<= '2026-05-13'` would only match documents whose value is exactly that
 * day's midnight, missing everything stored as `2026-05-13T14:30:00Z`.
 *
 * We treat YYYY-MM-DD inputs as **full days in UTC**:
 *  - `dayStart` returns the day's 00:00:00Z
 *  - `nextDayStart` returns the following day's 00:00:00Z (exclusive upper bound)
 *
 * This keeps "Disbursed today", "Closed in last 30d" etc. matching the entire
 * calendar day, not just its first second.
 */
function dayStart(iso: string): string {
  // Strip any time component if the caller passed a full ISO.
  return `${iso.slice(0, 10)}T00:00:00.000Z`
}

function nextDayStart(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

/**
 * Compose a Payload `where` clause from a parsed FiltersState.
 *
 * The `customerIdIn` argument is the result of the customer-status pre-fetch
 * the API route performs. Pass `null` if no customer-status filter is active.
 * Pass an empty array if a customer-status filter is active but matched no
 * customers — the caller should short-circuit with an empty result rather than
 * issuing a query.
 */
export function buildPayloadWhere(
  filters: FiltersState,
  customerIdIn: string[] | null,
): Where {
  const and: Where[] = []

  if (filters.status?.length) {
    and.push({ accountStatus: { in: filters.status } })
  }
  if (filters.minBalance != null) {
    and.push({ 'balances.totalOutstanding': { greater_than_equal: filters.minBalance } })
  }
  if (filters.maxBalance != null) {
    and.push({ 'balances.totalOutstanding': { less_than_equal: filters.maxBalance } })
  }
  if (filters.openedFrom) {
    and.push({ 'loanTerms.openedDate': { greater_than_equal: dayStart(filters.openedFrom) } })
  }
  if (filters.openedTo) {
    and.push({ 'loanTerms.openedDate': { less_than: nextDayStart(filters.openedTo) } })
  }
  if (filters.disbursedFrom) {
    and.push({
      'loanTerms.disbursedDate': { greater_than_equal: dayStart(filters.disbursedFrom) },
    })
  }
  if (filters.disbursedTo) {
    and.push({ 'loanTerms.disbursedDate': { less_than: nextDayStart(filters.disbursedTo) } })
  }
  if (filters.closedFrom) {
    and.push({ 'closure.closedDate': { greater_than_equal: dayStart(filters.closedFrom) } })
  }
  if (filters.closedTo) {
    and.push({ 'closure.closedDate': { less_than: nextDayStart(filters.closedTo) } })
  }
  if (filters.lastPmtBefore) {
    and.push({ 'lastPayment.date': { less_than: dayStart(filters.lastPmtBefore) } })
  }
  if (filters.closureReason) {
    and.push({ 'closure.reason': { equals: filters.closureReason } })
  }
  if (filters.paymentFrequency) {
    and.push({ 'repaymentSchedule.paymentFrequency': { equals: filters.paymentFrequency } })
  }
  if (filters.isInArrears != null) {
    and.push({ 'aging.isInArrears': { equals: filters.isInArrears } })
  }
  if (filters.agingBucket?.length) {
    and.push({ 'aging.bucket': { in: filters.agingBucket } })
  }
  if (filters.minDpd != null) {
    and.push({ 'aging.currentDPD': { greater_than_equal: filters.minDpd } })
  }
  if (filters.q && filters.q.length >= 3) {
    and.push({
      or: [
        { accountNumber: { contains: filters.q } },
        { loanAccountId: { contains: filters.q } },
        { customerName: { contains: filters.q } },
      ],
    })
  }
  if (customerIdIn && customerIdIn.length > 0) {
    and.push({ customerIdString: { in: customerIdIn } })
  }

  if (and.length === 0) return {}
  if (and.length === 1) return and[0]
  return { and }
}

/** Default sort if none specified: newest accounts first. */
export const DEFAULT_SORT = '-createdAt'
