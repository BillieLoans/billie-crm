/**
 * "Undo: same person after all" Mutation Hook (BTB-569)
 *
 * Undoes the "different person" clear of a verified-contact stop when the
 * applicant turns out to be the earlier customer, so the contact stops
 * applications again. Publishes
 * `reapplication_block.clear_revoke_authorized.v1` via
 * `POST /api/commands/reapp-block-clear/different-person/undo` and returns the
 * request id after the 202.
 *
 * Like useClearDifferentPerson it does not wait for the outcome: billieChat's
 * answer reaches the conversation record later (clear_revoked /
 * clear_revoke_rejected), and the caller watches the record for this request
 * id.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { showErrorToast } from '@/lib/utils/error-toast'
import type { DifferentPersonClearCommand } from '@/lib/events/schemas'
import type { ClearDifferentPersonResult } from './useClearDifferentPerson'

async function publishUndoCommand(
  command: DifferentPersonClearCommand,
): Promise<ClearDifferentPersonResult> {
  const res = await fetch('/api/commands/reapp-block-clear/different-person/undo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: 'Failed to submit undo' } }))
    throw new Error(error.error?.message || 'Failed to submit the undo of the clear')
  }

  return res.json()
}

/**
 * Mutation hook for the "Undo: same person after all" action. Returns
 * immediately after the 202; it does NOT poll.
 */
export function useUndoDifferentPersonClear() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: publishUndoCommand,
    retry: 0, // Don't retry on failure - let user retry manually

    onSuccess: () => {
      toast.success('Undo of the clear submitted', {
        description: 'The outcome will show on this application.',
      })
      queryClient.invalidateQueries({ queryKey: ['conversation'] })
    },

    onError: (error) => {
      showErrorToast(error, {
        title: 'Failed to submit undo',
        action: 'undo-different-person-clear',
      })
    },
  })

  return {
    undo: mutation.mutate,
    undoAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  }
}
