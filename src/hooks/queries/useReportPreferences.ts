'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const KEY = ['reports', 'preferences'] as const

async function fetchPins(): Promise<string[]> {
  const res = await fetch('/api/reports/preferences', { credentials: 'include' })
  if (!res.ok) throw new Error('Your pinned reports could not be loaded.')
  return ((await res.json()) as { pinned: string[] }).pinned
}

/**
 * The signed-in user's pinned reports, and a toggle. Saves run one at a
 * time (one mutation scope for every pin button), and each works out the
 * new list from the latest saved one when it runs, so quick clicks on two
 * reports both stick.
 */
export function useReportPins() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: fetchPins, staleTime: 5 * 60_000 })
  const save = useMutation({
    scope: { id: 'report-pins' },
    mutationFn: async (slug: string) => {
      const current = client.getQueryData<string[]>(KEY) ?? []
      const pinned = current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug]
      const res = await fetch('/api/reports/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pinned }),
      })
      const body = (await res.json().catch(() => null)) as {
        pinned?: string[]
        error?: { message?: string }
      } | null
      if (!res.ok || !body?.pinned) {
        throw new Error(body?.error?.message ?? 'Your pins could not be saved. Try again.')
      }
      return body.pinned
    },
    onSuccess: (pinned) => client.setQueryData(KEY, pinned),
    onError: (error) => toast.error((error as Error).message),
  })
  const pinned = query.data ?? []
  return {
    pinned,
    isPinned: (slug: string) => pinned.includes(slug),
    toggle: (slug: string) => save.mutate(slug),
    isSaving: save.isPending,
  }
}
