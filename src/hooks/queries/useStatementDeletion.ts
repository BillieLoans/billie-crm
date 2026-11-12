'use client'

import { useQuery } from '@tanstack/react-query'
import type { ApplicationPreview, DeletionScope, LatestDeletion } from '@/server/statement-deletion'

/**
 * The message an API route sent, in whichever shape it used. The statement
 * deletion routes send `{ error: { code, message } }`.
 */
export async function statementDeletionError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  const error = body?.error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return new Error(message)
  }
  if (typeof body?.message === 'string' && body.message) return new Error(body.message)
  if (typeof error === 'string' && error) return new Error(error)
  return new Error(`${fallback} (${res.status})`)
}

async function fetchLatestDeletion(conversationId: string): Promise<LatestDeletion | null> {
  const res = await fetch(
    `/api/statements/deletion?conversationId=${encodeURIComponent(conversationId)}`,
    { cache: 'no-store', credentials: 'include' },
  )
  if (!res.ok) throw await statementDeletionError(res, 'Could not load the latest deletion')
  const body = (await res.json()) as { deletion: LatestDeletion | null }
  return body.deletion ?? null
}

/** The latest deletion of an application's statement files, or null if none. */
export function useStatementDeletion(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['statement-deletion', conversationId],
    queryFn: () => fetchLatestDeletion(conversationId!),
    enabled: !!conversationId,
  })
}

async function fetchDeletionPreview(scope: DeletionScope): Promise<ApplicationPreview[]> {
  const res = await fetch('/api/statements/deletion/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(scope),
  })
  if (!res.ok) throw await statementDeletionError(res, 'Could not check for statement files')
  const body = (await res.json()) as { applications: ApplicationPreview[] }
  return body.applications ?? []
}

/**
 * What a deletion would remove right now: one row per application in scope.
 * Never cached, so the review always shows what is in the bucket. The delete
 * route lists the bucket again itself; this is for the operator to read.
 */
export function useStatementDeletionPreview(scope: DeletionScope | null) {
  return useQuery({
    queryKey: ['statement-deletion-preview', scope],
    queryFn: () => fetchDeletionPreview(scope!),
    enabled: !!scope,
    staleTime: 0,
    retry: false,
  })
}
