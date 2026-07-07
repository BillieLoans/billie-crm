import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useCallback } from 'react'
import { stringify } from 'qs-esm'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/formatters'

/** Notification item representing a pending write-off request */
export interface ApprovalNotification {
  id: string
  requestNumber: string
  amount: number
  customerName: string
  reason: string
  requestedByName: string
  createdAt: string
  requiresSeniorApproval: boolean
}

/** Response from the pending approvals API */
interface PendingApprovalsResponse {
  docs: ApprovalNotification[]
  totalDocs: number
  page: number
  totalPages: number
}

/** LocalStorage key for tracking seen notifications */
const SEEN_NOTIFICATIONS_KEY = 'billie-crm-seen-notifications'

/** Maximum notification IDs to store in localStorage */
const MAX_STORED_NOTIFICATION_IDS = 100

/** Polling interval in milliseconds (30 seconds) */
const POLLING_INTERVAL = 30_000

/** Maximum notifications to show in panel */
const MAX_NOTIFICATIONS = 10

/**
 * Fetch pending approval notifications from the Payload API.
 */
async function fetchApprovalNotifications(): Promise<PendingApprovalsResponse> {
  const query = stringify({
    where: {
      status: { equals: 'pending' },
    },
    limit: MAX_NOTIFICATIONS,
    sort: '-createdAt',
  })

  const res = await fetch(`/api/write-off-requests?${query}`)

  if (!res.ok) {
    throw new Error('Failed to fetch approval notifications')
  }

  return res.json()
}

/**
 * Get the set of notification IDs that have been seen.
 */
function getSeenNotifications(): Set<string> {
  if (typeof window === 'undefined') return new Set()

  try {
    const stored = localStorage.getItem(SEEN_NOTIFICATIONS_KEY)
    if (stored) {
      return new Set(JSON.parse(stored))
    }
  } catch {
    // Ignore localStorage errors
  }
  return new Set()
}

/**
 * Mark notification IDs as seen.
 */
function markNotificationsAsSeen(ids: string[]): void {
  if (typeof window === 'undefined') return

  try {
    const seen = getSeenNotifications()
    ids.forEach((id) => seen.add(id))
    // Keep only last N IDs to prevent unlimited growth
    const arr = Array.from(seen).slice(-MAX_STORED_NOTIFICATION_IDS)
    localStorage.setItem(SEEN_NOTIFICATIONS_KEY, JSON.stringify(arr))
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Query key for approval notifications.
 * Uses shared 'write-off-requests' prefix to ensure cache invalidation
 * from approval/reject actions also refreshes notifications.
 */
export const approvalNotificationsQueryKey = ['write-off-requests', 'notifications'] as const

/**
 * Hook for fetching and managing approval notifications.
 *
 * Features:
 * - Polls every 30 seconds for new pending approvals
 * - Detects new notifications and shows toast
 * - Tracks seen notifications in localStorage
 * - Returns unread count and notification list
 *
 * @param options.enabled - Whether to enable polling (default: true)
 * @param options.showToasts - Whether to show toast for new items (default: true)
 */
export function useApprovalNotifications(options?: { enabled?: boolean; showToasts?: boolean }) {
  const { enabled = true, showToasts = true } = options ?? {}
  const queryClient = useQueryClient()
  const previousIdsRef = useRef<Set<string>>(new Set())
  const isFirstFetchRef = useRef(true)

  const query = useQuery({
    queryKey: approvalNotificationsQueryKey,
    queryFn: fetchApprovalNotifications,
    staleTime: POLLING_INTERVAL / 2,
    refetchInterval: enabled ? POLLING_INTERVAL : false,
    enabled,
  })

  // Detect new notifications and show toast
  useEffect(() => {
    if (!query.data || !showToasts) return

    const currentIds = new Set(query.data.docs.map((n) => n.id))
    const seenIds = getSeenNotifications()

    // On first fetch, just populate the ref without showing toasts
    if (isFirstFetchRef.current) {
      isFirstFetchRef.current = false
      previousIdsRef.current = currentIds
      return
    }

    // Find new notifications that weren't in the previous set and haven't been seen
    const newNotifications = query.data.docs.filter(
      (n) => !previousIdsRef.current.has(n.id) && !seenIds.has(n.id),
    )

    if (newNotifications.length > 0) {
      // Show toast for new notifications
      // Note: Using window.location.href for navigation as hooks cannot use Next.js router.
      // This causes a full page reload, which is acceptable for this notification use case.
      if (newNotifications.length === 1) {
        const n = newNotifications[0]
        toast.info(`New write-off request: ${n.requestNumber}`, {
          description: `${n.customerName} - ${formatCurrency(n.amount)}`,
          action: {
            label: 'View',
            onClick: () => {
              window.location.href = '/admin/approvals'
            },
          },
        })
      } else {
        toast.info(`${newNotifications.length} new write-off requests`, {
          description: 'Click to view pending approvals',
          action: {
            label: 'View All',
            onClick: () => {
              window.location.href = '/admin/approvals'
            },
          },
        })
      }
    }

    previousIdsRef.current = currentIds
  }, [query.data, showToasts])

  // Calculate unread count (notifications not yet seen)
  const seenIds = getSeenNotifications()
  const unreadCount = query.data?.docs.filter((n) => !seenIds.has(n.id)).length ?? 0
  const totalPending = query.data?.totalDocs ?? 0

  // Mark all as read
  const markAllAsRead = useCallback(() => {
    if (!query.data) return
    const ids = query.data.docs.map((n) => n.id)
    markNotificationsAsSeen(ids)
    // Force re-render by invalidating
    queryClient.invalidateQueries({ queryKey: approvalNotificationsQueryKey })
  }, [query.data, queryClient])

  // Mark single notification as read
  const markAsRead = useCallback(
    (id: string) => {
      markNotificationsAsSeen([id])
      queryClient.invalidateQueries({ queryKey: approvalNotificationsQueryKey })
    },
    [queryClient],
  )

  return {
    notifications: query.data?.docs ?? [],
    totalPending,
    unreadCount,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    markAllAsRead,
    markAsRead,
  }
}
