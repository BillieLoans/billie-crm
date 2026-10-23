'use client'

import { useQuery } from '@tanstack/react-query'
import type { HomeTile } from '@/server/reporting/home'

export type { HomeTile }

/** The Reports home's headline numbers. */
export function useReportsHome() {
  return useQuery({
    queryKey: ['reports', 'home'],
    queryFn: async (): Promise<HomeTile[]> => {
      const res = await fetch('/api/reports/home', { credentials: 'include' })
      if (!res.ok) throw new Error('The headline numbers could not be loaded.')
      return ((await res.json()) as { tiles: HomeTile[] }).tiles
    },
    staleTime: 60_000,
  })
}
