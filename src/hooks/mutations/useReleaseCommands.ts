'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { CreateReleaseCommand } from '@/lib/schemas/releases'
import type { ReleaseBucket } from '@/lib/releases'
import { recordMarketingFailure } from '@/hooks/mutations/useMarketingCommands'
import { invalidateWithLag, postCommand } from '@/hooks/mutations/useMarketingCommands'

export interface ReleasePreflightResult {
  counts: Record<ReleaseBucket, number>
  total: number
  truncated?: boolean
}

/** Fresh partition each time the confirm step opens — the numbers ARE the decision. */
export function useReleasePreflight() {
  return useMutation({
    mutationFn: (command: CreateReleaseCommand) =>
      postCommand<ReleasePreflightResult>('/api/marketing/releases/preflight', command),
  })
}

export function useCreateRelease() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (command: CreateReleaseCommand) =>
      postCommand<{ releaseId: string; eventId: string }>('/api/marketing/releases', command),
    onSuccess: () => {
      toast.success('Release published')
      invalidateWithLag(qc, [['marketing-releases']])
    },
    onError: (e: Error, command) => {
      toast.error('Failed to publish release', { description: e.message })
      recordMarketingFailure(
        `Release "${command.name}"`,
        command.releaseId,
        '/api/marketing/releases',
        command,
        e,
      )
    },
  })
}

export function useRevokeRelease() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { releaseId: string; reason?: string }) => {
      const url = `/api/marketing/releases/${encodeURIComponent(vars.releaseId)}/revoke`
      return postCommand<{ releaseId: string; eventId: string }>(url, { reason: vars.reason })
    },
    onSuccess: () => {
      toast.success('Release revoked — remaining grants cancelled')
      invalidateWithLag(qc, [['marketing-releases']])
    },
    onError: (e: Error, vars) => {
      const url = `/api/marketing/releases/${encodeURIComponent(vars.releaseId)}/revoke`
      toast.error('Failed to revoke release', { description: e.message })
      recordMarketingFailure(`Revoke release ${vars.releaseId}`, vars.releaseId, url, vars, e)
    },
  })
}

export interface SetGateModeVars {
  mode: 'open' | 'gated' | 'closed'
  reason?: string
}

/**
 * Admin-only gate-mode control (spec §6 "Gate control") — a second command
 * surface alongside the ops CLI break-glass path. The gate-status projection
 * only updates once billieChat round-trips the `.changed` fact (seconds
 * scale), so onSuccess just invalidates; the UI shows an "applying…" hint
 * on the control until useGateStatus reflects the requested mode.
 */
export function useSetGateMode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: SetGateModeVars) =>
      postCommand<{ mode: string; eventId: string }>('/api/marketing/releases/gate-mode', vars),
    onSuccess: (_res, vars) => {
      toast.success(`Gate mode set to ${vars.mode}`)
      // The 'marketing-releases' prefix also covers ['marketing-releases', 'gate-status'].
      invalidateWithLag(qc, [['marketing-releases']])
    },
    onError: (e: Error, vars) => {
      toast.error('Failed to change gate mode', { description: e.message })
      recordMarketingFailure(
        `Set gate mode to ${vars.mode}`,
        'gate',
        '/api/marketing/releases/gate-mode',
        vars,
        e,
      )
    },
  })
}
