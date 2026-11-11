/**
 * "Clear: different person" Mutation Hook (BTB-569)
 *
 * Clears a verified-contact stop when the new applicant is a different person
 * who shares the email or mobile with the earlier customer. Publishes
 * `reapplication_block.clear_authorized.v1` (reasons `["DIFFERENT_PERSON"]`)
 * via `POST /api/commands/reapp-block-clear/different-person` and returns the
 * request id after the 202.
 *
 * It does not wait for the outcome: billieChat's answer reaches the
 * conversation record later (cleared / clear_rejected), and the caller watches
 * the record for this request id.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { showErrorToast } from '@/lib/utils/error-toast'
import type { DifferentPersonClearCommand } from '@/lib/events/schemas'

export interface ClearDifferentPersonResult {
  requestId: string
  eventId: string
}

async function publishClearCommand(
  command: DifferentPersonClearCommand,
): Promise<ClearDifferentPersonResult> {
  const res = await fetch('/api/commands/reapp-block-clear/different-person', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: 'Failed to submit clear' } }))
    throw new Error(error.error?.message || 'Failed to submit the different-person clear')
  }

  return res.json()
}

/**
 * Mutation hook for the "Clear: different person" action. Returns immediately
 * after the 202; it does NOT poll.
 */
export function useClearDifferentPerson() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: publishClearCommand,
    retry: 0, // Don't retry on failure - let user retry manually

    onSuccess: () => {
      toast.success('Different-person clear submitted', {
        description: 'The outcome will show on this application.',
      })
      queryClient.invalidateQueries({ queryKey: ['conversation'] })
    },

    onError: (error) => {
      showErrorToast(error, {
        title: 'Failed to submit clear',
        action: 'clear-different-person',
      })
    },
  })

  return {
    clear: mutation.mutate,
    clearAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  }
}
