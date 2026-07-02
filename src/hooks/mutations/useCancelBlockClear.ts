/**
 * Cancel Block-Clear Mutation Hook (Event-Sourced)
 *
 * Cancels a pending reapplication block-clear request via the command API,
 * which publishes an event to the CRM stream. Then polls for the status change.
 *
 * Typically used by the original requester to withdraw their request.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { showErrorToast } from '@/lib/utils/error-toast'
import { pollForBlockClearUpdate, PollTimeoutError } from '@/lib/events/poll'
import type { BlockClearCancelCommand } from '@/lib/events/schemas'
import type { PublishEventResponse } from '@/lib/events/types'

// =============================================================================
// Types
// =============================================================================

export interface CancelBlockClearParams {
  /** Block-clear request ID */
  requestId: string
  /** Human-readable request number (e.g., BC-20241211...) */
  requestNumber: string
}

export interface CancelBlockClearResult {
  id: string
  requestNumber: string
  requestId: string
  status: 'cancelled'
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Publish cancel command via the command API.
 */
async function publishCancelCommand(params: CancelBlockClearParams): Promise<PublishEventResponse> {
  const command: BlockClearCancelCommand = {
    requestId: params.requestId,
    requestNumber: params.requestNumber,
  }

  const res = await fetch('/api/commands/reapp-block-clear/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: 'Failed to cancel request' } }))
    throw new Error(error.error?.message || 'Failed to cancel block-clear request')
  }

  return res.json()
}

/**
 * Cancel block-clear request and poll for the status change.
 */
async function cancelBlockClear(params: CancelBlockClearParams): Promise<CancelBlockClearResult> {
  // 1. Publish the command event
  await publishCancelCommand(params)

  // 2. Poll for the status to change to 'cancelled'
  const projection = await pollForBlockClearUpdate<CancelBlockClearResult>(
    params.requestId,
    'cancelled',
    {
      maxAttempts: 10,
      intervalMs: 500,
      initialDelayMs: 100,
    },
  )

  return projection
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Mutation hook for cancelling a reapplication block-clear request.
 *
 * Uses event sourcing: publishes command → polls for status change.
 */
export function useCancelBlockClear() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: cancelBlockClear,
    retry: 0, // Don't retry on failure - let user retry manually

    onSuccess: (data) => {
      toast.success(`Block-clear request ${data.requestNumber} cancelled`, {
        description: 'The request has been withdrawn.',
      })
      queryClient.invalidateQueries({ queryKey: ['block-clear-requests'] })
      queryClient.invalidateQueries({ queryKey: ['pending-block-clears'] })
    },

    onError: (error) => {
      // Handle polling timeout specifically
      if (error instanceof PollTimeoutError) {
        toast.warning('Cancellation submitted but confirmation delayed', {
          description:
            'Your cancellation was accepted but is taking longer than expected. Please refresh to see the status.',
        })
        queryClient.invalidateQueries({ queryKey: ['block-clear-requests'] })
        queryClient.invalidateQueries({ queryKey: ['pending-block-clears'] })
        return
      }

      showErrorToast(error, {
        title: 'Failed to cancel request',
        action: 'cancel-block-clear',
      })
    },
  })

  return {
    cancel: mutation.mutate,
    cancelAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  }
}
