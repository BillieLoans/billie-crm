'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReleaseBatch, ReleaseGrant } from '@/payload-types'

export type ReleaseWithDerived = ReleaseBatch & { derivedStatus?: string | null }

export interface ReleasesResponse {
  docs: ReleaseWithDerived[]
  totalDocs: number
  totalPages: number
  page: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export const releasesQueryKey = (filters: { page?: number } = {}) =>
  ['marketing-releases', 'list', filters] as const

async function fetchReleases(filters: { page?: number }): Promise<ReleasesResponse> {
  const qs = filters.page ? `?page=${filters.page}` : ''
  const res = await fetch(`/api/marketing/releases${qs}`, { credentials: 'include' })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Releases fetch failed: ${res.status}`)
  }
  return res.json()
}

export function useReleases(filters: { page?: number } = {}) {
  return useQuery({
    queryKey: releasesQueryKey(filters),
    queryFn: () => fetchReleases(filters),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  })
}

export interface ReleaseDetailResponse {
  release: ReleaseWithDerived | null
  grants: { docs: ReleaseGrant[]; totalDocs: number; totalPages: number; page: number }
}

export const releaseDetailQueryKey = (releaseId: string, page: number) =>
  ['marketing-releases', 'detail', releaseId, page] as const

/** Polls fast until the just-created projection lands (campaign-detail pattern). */
export function useRelease(releaseId: string, page = 1) {
  return useQuery({
    queryKey: releaseDetailQueryKey(releaseId, page),
    queryFn: async (): Promise<ReleaseDetailResponse> => {
      const res = await fetch(
        `/api/marketing/releases/${encodeURIComponent(releaseId)}?page=${page}`,
        {
          credentials: 'include',
        },
      )
      if (!res.ok) throw new Error(`Release fetch failed: ${res.status}`)
      return res.json()
    },
    enabled: !!releaseId,
    refetchInterval: (query) => (query.state.data?.release ? 30_000 : 3_000),
  })
}
