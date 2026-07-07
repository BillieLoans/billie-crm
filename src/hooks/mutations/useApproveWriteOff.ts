/**
 * Approve Write-Off Mutation Hook (Event-Sourced)
 *
 * Approves a write-off request via the command API, which publishes
 * an event to Redis. Then polls for the status change.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MIN_APPROVAL_COMMENT_LENGTH } from '@/lib/constants'
import { showErrorToast } from '@/lib/utils/error-toast'
import { pollForWriteOffUpdate, PollTimeoutError } from '@/lib/events/poll'
import type { WriteOffApproveCommand } from '@/lib/events/schemas'
import type { PublishEventResponse } from '@/lib/events/types'

// =============================================================================
// Types
// =============================================================================

export interface ApproveWriteOffParams {
  /** Write-off request ID (requestId field from the projection) */
  requestId: string
  /** Human-readable request number (e.g., WO-20241211...) */
  requestNumber: string
  /** Mandatory approval comment (min 10 chars) */
  comment: string
}

export interface ApproveWriteOffResult {
  id: string
  requestNumber: string
  requestId: string
  status: 'approved'
  approvalDetails: {
    approvedBy: string
    approvedByName: string
    approvedAt: string
    comment: string
  }
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Publish approve command via the command API.
 */
async function publishApproveCommand(params: ApproveWriteOffParams): Promise<PublishEventResponse> {
  const command: WriteOffApproveCommand = {
    requestId: params.requestId,
    requestNumber: params.requestNumber,
    comment: params.comment.trim(),
  }

  const res = await fetch('/api/commands/writeoff/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })

  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ error: { message: 'Failed to approve request' } }))
    throw new Error(error.error?.message || 'Failed to approve write-off request')
  }

  return res.json()
}

/**
 * Approve write-off request and poll for the status change.
 */
async function approveWriteOff(params: ApproveWriteOffParams): Promise<ApproveWriteOffResult> {
  // Validate comment length
  if (!params.comment || params.comment.trim().length < MIN_APPROVAL_COMMENT_LENGTH) {
    throw new Error(`Approval comment must be at least ${MIN_APPROVAL_COMMENT_LENGTH} characters`)
  }

  // 1. Publish the command event
  await publishApproveCommand(params)

  // 2. Poll for the status to change to 'approved'
  const projection = await pollForWriteOffUpdate<ApproveWriteOffResult>(
    params.requestId,
    'approved',
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
 * Mutation hook for approving a write-off request.
 *
 * Uses event sourcing: publishes command → polls for status change.
 */
export function useApproveWriteOff() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: approveWriteOff,
    retry: 0, // Don't retry on failure - let user retry manually

    onSuccess: (data) => {
      toast.success(`Write-off ${data.requestNumber} approved`, {
        description: 'The request has been approved and processed.',
      })
      // Invalidate approvals queries to refresh the list
      queryClient.invalidateQueries({ queryKey: ['write-off-requests'] })
    },

    onError: (error) => {
      // Handle polling timeout specifically
      if (error instanceof PollTimeoutError) {
        toast.warning('Approval submitted but confirmation delayed', {
          description:
            'Your approval was accepted but is taking longer than expected. Please refresh to see the status.',
        })
        queryClient.invalidateQueries({ queryKey: ['write-off-requests'] })
        return
      }

      showErrorToast(error, {
        title: 'Failed to approve request',
        action: 'approve-write-off',
      })
    },
  })

  return {
    approveRequest: mutation.mutate,
    approveRequestAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  }
}
