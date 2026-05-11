import { useQuery } from '@tanstack/react-query'
import type { SuppressionMode } from '@/lib/notifications/suppression'

export interface SuppressionData {
  customerId: string
  mode: SuppressionMode | null
  reason: string
  setBy: string
  setAt: string | null
  expiresAt: string | null
  sourceEventId: string
  activeNow: boolean
}

interface SuppressionResponse {
  suppression: SuppressionData | null
}

async function fetchSuppression(customerId: string): Promise<SuppressionData | null> {
  const res = await fetch(`/api/notifications/suppression?customerId=${encodeURIComponent(customerId)}`)
  if (!res.ok) {
    throw new Error('Failed to fetch notification suppression state')
  }
  const data: SuppressionResponse = await res.json()
  return data.suppression
}

export const suppressionQueryKey = (customerId: string) =>
  ['notification-suppression', customerId] as const

export interface UseNotificationSuppressionResult {
  suppression: SuppressionData | null
  isLoading: boolean
  isError: boolean
  error: Error | null
  /** True when a suppression is set AND has not expired. */
  isActive: boolean
  /** True when a suppression exists but its expires_at is in the past. */
  isExpired: boolean
}

export function useNotificationSuppression(
  customerId: string,
): UseNotificationSuppressionResult {
  const query = useQuery({
    queryKey: suppressionQueryKey(customerId),
    queryFn: () => fetchSuppression(customerId),
    enabled: !!customerId,
    staleTime: 30_000,
  })

  const suppression = query.data ?? null
  const isActive = suppression != null && suppression.activeNow === true
  const isExpired = suppression != null && suppression.activeNow === false

  return {
    suppression,
    isLoading: query.isLoading,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
    isActive,
    isExpired,
  }
}
