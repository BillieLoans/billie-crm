/**
 * Reject Write-Off Mutation Hook (Event-Sourced)
 *
 * Rejects a write-off request via the command API, which publishes
 * an event to Redis. Then polls for the status change.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MIN_APPROVAL_COMMENT_LENGTH } from '@/lib/constants'
import { showErrorToast } from '@/lib/utils/error-toast'
import { pollForWriteOffUpdate, PollTimeoutError } from '@/lib/events/poll'
import type { WriteOffRejectCommand } from '@/lib/events/schemas'
import type { PublishEventResponse } from '@/lib/events/types'

// =============================================================================
// Types
// =============================================================================

export interface RejectWriteOffParams {
  /** Write-off request ID (requestId field from the projection) */
  requestId: string
  /** Human-readable request number (e.g., WO-20241211...) */
  requestNumber: string
  /** Mandatory rejection reason (min 10 chars) */
  reason: string
}

export interface RejectWriteOffResult {
  id: string
  requestNumber: string
  requestId: string
  status: 'rejected'
  approvalDetails: {
    rejectedBy: string
    rejectedByName: string
    rejectedAt: string
    reason: string
  }
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Publish reject command via the command API.
 */
async function publishRejectCommand(params: RejectWriteOffParams): Promise<PublishEventResponse> {
  const command: WriteOffRejectCommand = {
    requestId: params.requestId,
    requestNumber: params.requestNumber,
    reason: params.reason.trim(),
  }

  const res = await fetch('/api/commands/writeoff/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: 'Failed to reject request' } }))
    throw new Error(error.error?.message || 'Failed to reject write-off request')
  }

  return res.json()
}

/**
 * Reject write-off request and poll for the status change.
 */
async function rejectWriteOff(params: RejectWriteOffParams): Promise<RejectWriteOffResult> {
  // Validate reason length
  if (!params.reason || params.reason.trim().length < MIN_APPROVAL_COMMENT_LENGTH) {
    throw new Error(`Rejection reason must be at least ${MIN_APPROVAL_COMMENT_LENGTH} characters`)
  }

  // 1. Publish the command event
  await publishRejectCommand(params)

  // 2. Poll for the status to change to 'rejected'
  const projection = await pollForWriteOffUpdate<RejectWriteOffResult>(
    params.requestId,
    'rejected',
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
 * Mutation hook for rejecting a write-off request.
 *
 * Uses event sourcing: publishes command → polls for status change.
 */
export function useRejectWriteOff() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: rejectWriteOff,
    retry: 0, // Don't retry on failure - let user retry manually

    onSuccess: (data) => {
      toast.success(`Write-off ${data.requestNumber} rejected`, {
        description: 'The request has been rejected.',
      })
      // Invalidate approvals queries to refresh the list
      queryClient.invalidateQueries({ queryKey: ['write-off-requests'] })
    },

    onError: (error) => {
      // Handle polling timeout specifically
      if (error instanceof PollTimeoutError) {
        toast.warning('Rejection submitted but confirmation delayed', {
          description:
            'Your rejection was accepted but is taking longer than expected. Please refresh to see the status.',
        })
        queryClient.invalidateQueries({ queryKey: ['write-off-requests'] })
        return
      }

      showErrorToast(error, {
        title: 'Failed to reject request',
        action: 'reject-write-off',
      })
    },
  })

  return {
    rejectRequest: mutation.mutate,
    rejectRequestAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  }
}
