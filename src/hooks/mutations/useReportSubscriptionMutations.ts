'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SubscriptionRequest } from '@/lib/reports/subscriptions'
import {
  SUBSCRIPTIONS_KEY,
  sendSubscriptionRequest,
  type SubscriptionView,
} from '@/hooks/queries/useReportSubscriptions'

/** Start a report email or alert for the signed-in user. */
export function useCreateSubscription() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: SubscriptionRequest) =>
      sendSubscriptionRequest<{ subscription: SubscriptionView }>(
        '/api/reports/subscriptions',
        'POST',
        request,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY }),
  })
}

/** Pause or resume one of the signed-in user's report emails or alerts. */
export function usePauseSubscription() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, paused }: { id: string; paused: boolean }) =>
      sendSubscriptionRequest<{ ok: true }>(
        `/api/reports/subscriptions/${encodeURIComponent(id)}`,
        'PATCH',
        {
          paused,
        },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY }),
  })
}

/** Remove one of the signed-in user's report emails or alerts. */
export function useDeleteSubscription() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      sendSubscriptionRequest<{ ok: true }>(
        `/api/reports/subscriptions/${encodeURIComponent(id)}`,
        'DELETE',
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY }),
  })
}
