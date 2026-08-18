'use client'

import { useQuery } from '@tanstack/react-query'
import type { IssueDiagnostics } from '@/lib/schemas/issues'

// =============================================================================
// Types
// =============================================================================

/**
 * Shape of an `issues` document as served by Payload REST at depth=1.
 *
 * Deliberately declared locally rather than imported from `@/payload-types` —
 * the generated types are regenerated out-of-band and would not yet know about
 * this collection.
 */
export interface IssueReport {
  id: string
  title: string
  description: string
  status: 'open' | 'resolved'
  triggerReason?: string | null
  reportedBy: { id: string; email?: string | null } | string | null
  screenshotUri?: string | null
  diagnostics: IssueDiagnostics
  resolutionNote?: string | null
  resolvedAt?: string | null
  resolvedBy?: { id: string; email?: string | null } | string | null
  createdAt: string
  updatedAt: string
}

export interface IssueReportsResponse {
  docs: IssueReport[]
  totalDocs: number
}

// =============================================================================
// Query keys
// =============================================================================

/**
 * Query key factory for issue reports. Mutations invalidate `all` so both the
 * list and the open-count badge refresh together.
 */
export const issueReportsKeys = {
  all: ['issue-reports'] as const,
  list: (status?: string) => ['issue-reports', 'list', status ?? 'all'] as const,
  detail: (id: string) => ['issue-reports', 'detail', id] as const,
  openCount: ['issue-reports', 'open-count'] as const,
}

// =============================================================================
// API
// =============================================================================

async function fetchIssueReports(status?: string): Promise<IssueReportsResponse> {
  const where = status ? `where[status][equals]=${encodeURIComponent(status)}&` : ''
  const res = await fetch(`/api/issues?${where}sort=-createdAt&depth=1&limit=50`, {
    credentials: 'include',
  })

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.errors?.[0]?.message ?? `Issue reports fetch failed: ${res.status}`)
  }

  return res.json()
}

async function fetchOpenIssueCount(): Promise<number> {
  // limit=0 returns metadata only — we just want totalDocs for the nav badge.
  const res = await fetch('/api/issues?where[status][equals]=open&limit=0', {
    credentials: 'include',
  })

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.errors?.[0]?.message ?? `Open issue count fetch failed: ${res.status}`)
  }

  const data = await res.json()
  return data.totalDocs ?? 0
}

async function fetchIssueReport(id: string): Promise<IssueReport> {
  const res = await fetch(`/api/issues/${encodeURIComponent(id)}?depth=1`, {
    credentials: 'include',
  })

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.errors?.[0]?.message ?? `Issue report fetch failed: ${res.status}`)
  }

  return res.json()
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * React Query hook for the issue reports list (admin view).
 * Polls every 30 seconds. Omit `status` to list every report.
 */
export function useIssueReports({ status }: { status?: string } = {}) {
  return useQuery({
    queryKey: issueReportsKeys.list(status),
    queryFn: () => fetchIssueReports(status),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  })
}

/**
 * React Query hook for the count of open issue reports, used by the sidebar
 * badge. Pass `enabled: false` for users who cannot see the admin view.
 */
export function useOpenIssueCount(enabled: boolean) {
  return useQuery({
    queryKey: issueReportsKeys.openCount,
    queryFn: fetchOpenIssueCount,
    enabled,
    refetchInterval: 30_000,
  })
}

/** React Query hook for a single issue report detail. */
export function useIssueReport(id: string | undefined) {
  return useQuery({
    queryKey: issueReportsKeys.detail(id as string),
    queryFn: () => fetchIssueReport(id as string),
    enabled: !!id,
  })
}
