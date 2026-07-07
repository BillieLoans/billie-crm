import { useInfiniteQuery } from '@tanstack/react-query'
import { stringify } from 'qs-esm'

export type NotificationStatus = 'sent' | 'failed' | 'blocked' | 'statement' | 'suppression_change'

export interface NotificationData {
  id: string
  notificationId: string
  idempotencyKey?: string | null
  requestId?: string | null
  customerId?: string | null
  status: NotificationStatus
  channel?: 'email' | 'sms' | null
  templateName?: string | null
  templateContentHash?: string | null
  templateGitSha?: string | null
  provider?: string | null
  providerMessageId?: string | null
  recipientHash?: string | null
  correlationId?: string | null
  eventAt: string
  sentAt?: string | null
  tags?: {
    category?: string | null
    reason?: string | null
    step?: number | null
  } | null
  failure?: {
    failedAt?: string | null
    errorType?:
      | 'transient'
      | 'permanent'
      | 'auth'
      | 'template'
      | 'contact_missing'
      | 'opt_out'
      | 'suppressed'
      | null
    errorMessage?: string | null
    attempt?: number | null
    fallbackSuggested?: string | null
  } | null
  statement?: {
    accountId?: string | null
    periodStart?: string | null
    periodEnd?: string | null
    dispatchedAt?: string | null
  } | null
  suppression?: {
    mode?: 'all' | 'non_essential' | 'marketing_only' | 'off' | null
    reason?: string | null
    setBy?: string | null
    setAt?: string | null
    expiresAt?: string | null
  } | null
  createdAt: string
  updatedAt: string
}

export interface NotificationsFilters {
  /** Filter to a single status. Omit for all statuses. */
  status?: NotificationStatus
}

interface NotificationsResponse {
  docs: NotificationData[]
  totalDocs: number
  hasNextPage: boolean
  hasPrevPage: boolean
  page: number
}

interface NotificationsResult {
  notifications: NotificationData[]
  totalDocs: number
  hasNextPage: boolean
  currentPage: number
}

const PAGE_SIZE = 20

async function fetchNotifications(
  customerId: string,
  filters: NotificationsFilters,
  page: number,
): Promise<NotificationsResult> {
  const andClauses: Record<string, unknown>[] = [{ customerId: { equals: customerId } }]

  if (filters.status) {
    andClauses.push({ status: { equals: filters.status } })
  }

  const queryString = stringify(
    {
      where: { and: andClauses },
      sort: '-eventAt',
      limit: PAGE_SIZE,
      page,
    },
    { addQueryPrefix: true },
  )

  const res = await fetch(`/api/notifications${queryString}`)
  if (!res.ok) {
    throw new Error('Failed to fetch notifications')
  }
  const data: NotificationsResponse = await res.json()
  return {
    notifications: data.docs,
    totalDocs: data.totalDocs,
    hasNextPage: data.hasNextPage,
    currentPage: data.page,
  }
}

export const notificationsQueryKey = (customerId: string, filters: NotificationsFilters) =>
  ['notifications', customerId, filters] as const

export interface UseNotificationsResult {
  notifications: NotificationData[]
  totalDocs: number
  hasNextPage: boolean
  isLoading: boolean
  isSuccess: boolean
  isError: boolean
  error: Error | null
  isFetchingNextPage: boolean
  fetchNextPage: () => Promise<unknown>
}

export function useNotifications(
  customerId: string,
  filters: NotificationsFilters = {},
): UseNotificationsResult {
  const query = useInfiniteQuery({
    queryKey: notificationsQueryKey(customerId, filters),
    queryFn: ({ pageParam }) => fetchNotifications(customerId, filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasNextPage ? lastPage.currentPage + 1 : undefined),
    enabled: !!customerId,
    staleTime: 10_000,
  })

  const pages = query.data?.pages ?? []

  return {
    notifications: pages.flatMap((page) => page.notifications),
    totalDocs: pages[0]?.totalDocs ?? 0,
    hasNextPage: query.hasNextPage ?? false,
    isLoading: query.isLoading,
    isSuccess: query.isSuccess,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  }
}
