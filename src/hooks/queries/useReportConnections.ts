'use client'

import { useQuery } from '@tanstack/react-query'
import type { ConnectionView } from '@/server/reporting/mcp-oauth'
import { sendSubscriptionRequest } from './useReportSubscriptions'

export type { ConnectionView }

export const CONNECTIONS_KEY = ['reports', 'connections'] as const

export interface ConnectionsResponse {
  connections: ConnectionView[]
}

/** The signed-in person's MCP connections (Claude apps they approved). */
export function useReportConnections(enabled = true) {
  return useQuery({
    queryKey: CONNECTIONS_KEY,
    queryFn: () => sendSubscriptionRequest<ConnectionsResponse>('/api/reports/connections', 'GET'),
    enabled,
    staleTime: 30_000,
  })
}
