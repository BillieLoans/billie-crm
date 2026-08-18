import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { issueReportsKeys } from '../queries/useIssueReports'

// =============================================================================
// Types
// =============================================================================

export interface ResolveIssueParams {
  id: string
  status: 'open' | 'resolved'
  resolutionNote?: string
}

export interface ResolveIssueResult {
  doc: { id: string }
}

// =============================================================================
// API
// =============================================================================

async function resolveIssue(params: ResolveIssueParams): Promise<ResolveIssueResult> {
  const { id, status, resolutionNote } = params

  const res = await fetch(`/api/issues/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status, resolutionNote }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const message =
      // Payload wraps validation errors in errors array
      body?.errors?.[0]?.message || body?.message || 'Failed to update problem report'
    throw new Error(message)
  }

  return res.json()
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Mutation hook for resolving (or reopening) an issue report.
 *
 * On success: shows a status-appropriate toast and invalidates issue report
 *             queries.
 * On error:   shows error toast with message.
 */
export function useResolveIssue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: resolveIssue,

    onSuccess: (_data, variables) => {
      toast.success(variables.status === 'resolved' ? 'Report resolved' : 'Report reopened')
      queryClient.invalidateQueries({ queryKey: issueReportsKeys.all })
    },

    onError: (error) => {
      toast.error('Failed to update problem report', {
        description: error instanceof Error ? error.message : 'Please try again',
      })
    },
  })
}
