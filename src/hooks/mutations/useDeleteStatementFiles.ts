'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { statementDeletionError } from '@/hooks/queries/useStatementDeletion'
import type { ApplicationResult, DeletionScope } from '@/server/statement-deletion'

export type DeleteStatementFilesParams = DeletionScope & { reason: string }

/**
 * Permanently delete the statement files in a scope (admin/supervisor only).
 * The body is the scope and a reason, never file keys: the route resolves the
 * scope and lists the bucket itself.
 *
 * Whatever the outcome, the latest-deletion line, any preview and any open
 * statement file are re-read, since some files may have gone even on an error.
 */
export function useDeleteStatementFiles() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: DeleteStatementFilesParams): Promise<ApplicationResult[]> => {
      const res = await fetch('/api/statements/deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(params),
      })
      if (!res.ok) throw await statementDeletionError(res, 'The statement files were not deleted')
      const body = (await res.json()) as { results: ApplicationResult[] }
      return body.results ?? []
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['statement-deletion'] })
      queryClient.invalidateQueries({ queryKey: ['statement-deletion-preview'] })
      queryClient.invalidateQueries({ queryKey: ['statement-file'] })
    },
  })
}
