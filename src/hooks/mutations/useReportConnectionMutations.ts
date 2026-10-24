'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CONNECTIONS_KEY } from '@/hooks/queries/useReportConnections'
import { sendSubscriptionRequest } from '@/hooks/queries/useReportSubscriptions'

/** Cut one of the signed-in person's MCP connections. */
export function useDeleteConnection() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      sendSubscriptionRequest<{ ok: true }>(
        `/api/reports/connections/${encodeURIComponent(id)}`,
        'DELETE',
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  })
}
