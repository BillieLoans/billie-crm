import { useQuery } from '@tanstack/react-query'

export interface NotificationBodyData {
  notificationId: string
  idempotencyKey: string
  channel: string
  templateName: string
  templateContentHash: string
  templateGitSha: string
  subject: string
  body: string
  isHtml: boolean
  provider: string
  providerMessageId: string
  recipientHash: string
  customerId: string
  correlationId: string
  sentAt: string | null
  failedAt: string | null
  success: boolean
  errorType: string
  errorMessage: string
  tags: Record<string, string>
}

export class NotificationBodyNotFoundError extends Error {
  constructor() {
    super('Notification body unavailable')
    this.name = 'NotificationBodyNotFoundError'
  }
}

async function fetchNotificationBody(notificationId: string): Promise<NotificationBodyData> {
  const res = await fetch(`/api/notifications/${encodeURIComponent(notificationId)}/body`)
  if (res.status === 404) {
    throw new NotificationBodyNotFoundError()
  }
  if (!res.ok) {
    throw new Error('Failed to fetch notification body')
  }
  return res.json()
}

export const notificationBodyQueryKey = (notificationId: string) =>
  ['notification-body', notificationId] as const

export interface UseNotificationBodyOptions {
  enabled?: boolean
}

export function useNotificationBody(
  notificationId: string,
  options: UseNotificationBodyOptions = {},
) {
  const query = useQuery({
    queryKey: notificationBodyQueryKey(notificationId),
    queryFn: () => fetchNotificationBody(notificationId),
    enabled: !!notificationId && (options.enabled ?? true),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof NotificationBodyNotFoundError) return false
      return failureCount < 2
    },
  })

  return {
    body: query.data,
    isLoading: query.isLoading,
    isSuccess: query.isSuccess,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
    isNotFound: query.error instanceof NotificationBodyNotFoundError,
    refetch: query.refetch,
  }
}
