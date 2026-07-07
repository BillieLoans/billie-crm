/**
 * Cancel Write-Off Mutation Hook (Event-Sourced)
 *
 * Cancels a pending write-off request via the command API, which publishes
 * an event to Redis. Then polls for the status change.
 *
 * Typically used by the original requester to withdraw their request.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { showErrorToast } from '@/lib/utils/error-toast'
import { pollForWriteOffUpdate, PollTimeoutError } from '@/lib/events/poll'
import type { WriteOffCancelCommand } from '@/lib/events/schemas'
import type { PublishEventResponse } from '@/lib/events/types'

// =============================================================================
// Types
// =============================================================================

export interface CancelWriteOffParams {
  /** Write-off request ID (requestId field from the projection) */
  requestId: string
  /** Human-readable request number (e.g., WO-20241211...) */
  requestNumber: string
}

export interface CancelWriteOffResult {
  id: string
  requestNumber: string
  requestId: string
  status: 'cancelled'
  cancellationDetails: {
    cancelledBy: string
    cancelledByName: string
    cancelledAt: string
  }
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Publish cancel command via the command API.
 */
async function publishCancelCommand(params: CancelWriteOffParams): Promise<PublishEventResponse> {
  const command: WriteOffCancelCommand = {
    requestId: params.requestId,
    requestNumber: params.requestNumber,
  }

  const res = await fetch('/api/commands/writeoff/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: 'Failed to cancel request' } }))
    throw new Error(error.error?.message || 'Failed to cancel write-off request')
  }

  return res.json()
}

/**
 * Cancel write-off request and poll for the status change.
 */
async function cancelWriteOff(params: CancelWriteOffParams): Promise<CancelWriteOffResult> {
  // 1. Publish the command event
  await publishCancelCommand(params)

  // 2. Poll for the status to change to 'cancelled'
  const projection = await pollForWriteOffUpdate<CancelWriteOffResult>(
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
 * Mutation hook for cancelling a write-off request.
 *
 * Uses event sourcing: publishes command → polls for status change.
 */
export function useCancelWriteOff() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: cancelWriteOff,
    retry: 0, // Don't retry on failure - let user retry manually

    onSuccess: (data) => {
      toast.success(`Write-off ${data.requestNumber} cancelled`, {
        description: 'The request has been withdrawn.',
      })
      // Invalidate queries to refresh the list
      queryClient.invalidateQueries({ queryKey: ['write-off-requests'] })
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] })
    },

    onError: (error) => {
      // Handle polling timeout specifically
      if (error instanceof PollTimeoutError) {
        toast.warning('Cancellation submitted but confirmation delayed', {
          description:
            'Your cancellation was accepted but is taking longer than expected. Please refresh to see the status.',
        })
        queryClient.invalidateQueries({ queryKey: ['write-off-requests'] })
        queryClient.invalidateQueries({ queryKey: ['pending-approvals'] })
        return
      }

      showErrorToast(error, {
        title: 'Failed to cancel request',
        action: 'cancel-write-off',
      })
    },
  })

  return {
    cancelRequest: mutation.mutate,
    cancelRequestAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  }
}
