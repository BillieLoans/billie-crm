import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { IssueDiagnostics } from '@/lib/schemas/issues'
import { issueReportsKeys } from '../queries/useIssueReports'

// =============================================================================
// Types
// =============================================================================

export interface ReportIssueParams {
  description: string
  diagnostics: IssueDiagnostics
  screenshotBlob?: Blob | null
  screenshotContentType?: 'image/jpeg' | 'image/png'
  triggerReason?: string | null
}

export interface ReportIssueResult {
  doc: { id: string }
}

// =============================================================================
// API
// =============================================================================

/**
 * Presigns and uploads the screenshot, returning its `s3://` URI.
 * Throws on failure — the caller decides whether that aborts the report.
 */
async function uploadScreenshot(blob: Blob, contentType: 'image/jpeg' | 'image/png') {
  const presignRes = await fetch('/api/issues/screenshot-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ contentType }),
  })

  if (!presignRes.ok) {
    const body = await presignRes.json().catch(() => null)
    throw new Error(body?.error?.message ?? `Screenshot presign failed: ${presignRes.status}`)
  }

  const { uploadUrl, s3Uri } = await presignRes.json()

  // Presigned S3 PUT — no cookies, and the Content-Type must match the one
  // that was signed.
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  })

  if (!putRes.ok) throw new Error(`Screenshot upload failed: ${putRes.status}`)

  return s3Uri as string
}

async function reportIssue(params: ReportIssueParams): Promise<ReportIssueResult> {
  const { description, diagnostics, screenshotBlob, screenshotContentType, triggerReason } = params

  let screenshotUri: string | null = null

  if (screenshotBlob) {
    try {
      screenshotUri = await uploadScreenshot(screenshotBlob, screenshotContentType ?? 'image/jpeg')
    } catch (error) {
      // A screenshot is a nice-to-have — never let it block the report itself.
      console.error('Issue screenshot upload failed, reporting without it', error)
    }
  }

  const res = await fetch('/api/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      description,
      diagnostics,
      screenshotUri,
      triggerReason: triggerReason ?? null,
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const message =
      // Payload wraps validation errors in errors array
      body?.errors?.[0]?.message || body?.message || 'Failed to submit problem report'
    throw new Error(message)
  }

  return res.json()
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Mutation hook for submitting an in-app problem report.
 *
 * On success: shows "Problem report submitted" toast and invalidates issue
 *             report queries.
 * On error:   shows error toast with message.
 */
export function useReportIssue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: reportIssue,

    onSuccess: () => {
      toast.success('Problem report submitted')
      queryClient.invalidateQueries({ queryKey: issueReportsKeys.all })
    },

    onError: (error) => {
      toast.error('Failed to submit problem report', {
        description: error instanceof Error ? error.message : 'Please try again',
      })
    },
  })
}
