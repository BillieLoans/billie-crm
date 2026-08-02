'use client'

import { useQuery } from '@tanstack/react-query'

export interface GateStatus {
  mode: 'open' | 'gated'
  setBy: string | null
  changedAt: string | null
}

export const gateStatusQueryKey = ['marketing-releases', 'gate-status'] as const

export function useGateStatus() {
  return useQuery({
    queryKey: gateStatusQueryKey,
    queryFn: async (): Promise<GateStatus> => {
      const res = await fetch('/api/marketing/releases/gate-status', { credentials: 'include' })
      if (!res.ok) throw new Error(`Gate status fetch failed: ${res.status}`)
      return res.json()
    },
    refetchInterval: 30_000,
  })
}
