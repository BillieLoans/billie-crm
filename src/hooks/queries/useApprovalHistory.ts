import { useQuery } from '@tanstack/react-query'
import { stringify } from 'qs-esm'
import { DEFAULT_PAGE_SIZE } from '@/lib/constants'

/** Approval history item with decision details */
export interface ApprovalHistoryItem {
  id: string
  requestNumber: string
  loanAccountId: string
  customerId: string
  customerName?: string
  accountNumber?: string
  amount: number
  originalBalance: number
  reason: string
  notes?: string
  status: 'approved' | 'rejected'
  priority: 'normal' | 'urgent' | 'low'
  requiresSeniorApproval: boolean
  requestedAt: string
  requestedBy?: string
  requestedByName?: string
  approvalDetails?: {
    // Legacy fields (for backwards compatibility)
    decidedBy?: string
    decidedByName?: string
    decidedAt?: string
    comment?: string
    // Approval-specific fields (from event sourcing)
    approvedBy?: string
    approvedByName?: string
    approvedAt?: string
    // Rejection-specific fields (from event sourcing)
    rejectedBy?: string
    rejectedByName?: string
    rejectedAt?: string
    reason?: string
  }
  createdAt: string
  updatedAt: string
}

/** Response from the history API */
interface ApprovalHistoryResponse {
  docs: ApprovalHistoryItem[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

/** Filter options for approval history */
export interface ApprovalHistoryFilters {
  status?: 'approved' | 'rejected' | 'all'
  startDate?: string // ISO date string
  endDate?: string // ISO date string
  approver?: string // User ID of approver
}

/** Options for the history query */
export interface ApprovalHistoryOptions {
  page?: number
  limit?: number
  sort?: 'newest' | 'oldest' | 'amount-high' | 'amount-low'
  filters?: ApprovalHistoryFilters
}

/**
 * Fetch approval history from the Payload API.
 * Only returns approved and rejected requests (completed workflow).
 */
async function fetchApprovalHistory(
  options: ApprovalHistoryOptions = {},
): Promise<ApprovalHistoryResponse> {
  const { page = 1, limit = DEFAULT_PAGE_SIZE, sort = 'newest', filters = {} } = options

  // Build where clause for completed requests
  const where: Record<string, unknown> = {}

  // Status filter
  if (filters.status && filters.status !== 'all') {
    where.status = { equals: filters.status }
  } else {
    // Default: show both approved and rejected
    where.status = { in: ['approved', 'rejected'] }
  }

  // Date range filter - uses createdAt (request creation date)
  // Note: This filters by when the request was created, not when the decision was made.
  // This is intentional as auditors often need to trace requests back to their origin date.
  // To filter by decision date, use approvalDetails.decidedAt field (future enhancement).
  if (filters.startDate) {
    where.createdAt = {
      ...((where.createdAt as Record<string, unknown>) || {}),
      greater_than_equal: filters.startDate,
    }
  }
  if (filters.endDate) {
    where.createdAt = {
      ...((where.createdAt as Record<string, unknown>) || {}),
      less_than_equal: filters.endDate,
    }
  }

  // Approver filter
  if (filters.approver) {
    where['approvalDetails.decidedBy'] = { equals: filters.approver }
  }

  // Map sort options to Payload sort format
  const sortMap: Record<string, string> = {
    newest: '-updatedAt', // Most recently decided first
    oldest: 'updatedAt',
    'amount-high': '-amount',
    'amount-low': 'amount',
  }

  const queryString = stringify(
    {
      where,
      limit,
      page,
      sort: sortMap[sort] || '-updatedAt',
    },
    { addQueryPrefix: true },
  )

  const res = await fetch(`/api/write-off-requests${queryString}`)

  if (!res.ok) {
    throw new Error('Failed to fetch approval history')
  }

  return res.json()
}

/**
 * Query key for approval history
 */
export const approvalHistoryQueryKey = (options: ApprovalHistoryOptions = {}) =>
  ['write-off-requests', 'history', options] as const

/**
 * Hook to fetch approval history (approved and rejected requests).
 * Supports filtering by status, date range, and approver.
 */
export function useApprovalHistory(options: ApprovalHistoryOptions = {}) {
  return useQuery({
    queryKey: approvalHistoryQueryKey(options),
    queryFn: () => fetchApprovalHistory(options),
    staleTime: 60_000, // 1 minute - history doesn't change often
  })
}
