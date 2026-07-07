import { useQuery } from '@tanstack/react-query'

/**
 * Event from the event history
 */
export interface AccountEvent {
  id: string
  timestamp: string
  stream: string
  eventType: string
  version: number
  data: Record<string, unknown>
  triggered_by?: string
  triggeredByName?: string
}

export interface EventHistoryResponse {
  events: AccountEvent[]
  nextCursor?: string
  hasMore: boolean
}

export interface UseEventHistoryOptions {
  accountId: string
  cursor?: string
  limit?: number
  stream?: string
  eventType?: string
  enabled?: boolean
}

export const eventHistoryQueryKey = (
  accountId: string,
  options?: Partial<UseEventHistoryOptions>,
) => ['event-history', accountId, options] as const

/**
 * Hook to fetch event history for an account.
 *
 * @param options - Query options
 * @returns Query result with event history
 *
 * @example
 * ```tsx
 * const { data, isLoading, fetchNextPage } = useEventHistory({
 *   accountId: 'acc-123',
 *   limit: 50
 * })
 * // data?.events - array of events
 * ```
 */
export function useEventHistory(options: UseEventHistoryOptions) {
  const { accountId, cursor, limit = 50, stream, eventType, enabled = true } = options

  return useQuery<EventHistoryResponse>({
    queryKey: eventHistoryQueryKey(accountId, { cursor, limit, stream, eventType }),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      if (limit) params.set('limit', String(limit))
      if (stream) params.set('stream', stream)
      if (eventType) params.set('eventType', eventType)

      const res = await fetch(`/api/investigation/events/${accountId}?${params}`)
      if (!res.ok) {
        throw new Error('Failed to fetch event history')
      }
      return res.json()
    },
    enabled: enabled && !!accountId,
    staleTime: 30_000,
  })
}

export default useEventHistory
