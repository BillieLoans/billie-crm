'use client'

/**
 * Phase-2 (Stream A) marketing command mutation hooks — batches + feedback
 * triage. Thin `useMutation` wrappers over the B3 command routes, following the
 * Phase-1 marketing pattern (sonner toast + query invalidation). Each command
 * returns 202 (command → projection); the UI re-reads via the invalidated
 * list/detail queries.
 */

import { useEffect } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFailedActionsStore } from '@/stores/failed-actions'

/**
 * Marketing commands are 202-accepted (command → event → projection), so a
 * refetch fired at success time frequently races the projection and returns
 * pre-change data — the UI looks like it reverted. Invalidate now AND again
 * after the typical projection lag so the view self-heals without a manual
 * refresh.
 */
const LAG_RETRIES_MS = [1500, 4000]

function invalidateWithLag(qc: QueryClient, keys: string[][]) {
  const run = () => keys.forEach((queryKey) => qc.invalidateQueries({ queryKey }))
  run()
  LAG_RETRIES_MS.forEach((ms) => setTimeout(run, ms))
}

async function postCommand<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Command failed: ${res.status}`)
  }
  return res.json()
}

export interface CreateBatchVars {
  name: string
  criteria?: Record<string, unknown>
}

export function useCreateBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: CreateBatchVars) =>
      postCommand<{ batchId: string; eventId: string }>('/api/marketing/batches', vars),
    onSuccess: () => {
      toast.success('Batch created')
      invalidateWithLag(qc, [['marketing-batches']])
    },
    onError: (e: Error, vars) => {
      toast.error('Failed to create batch', { description: e.message })
      recordMarketingFailure(
        `Create batch "${vars.name}"`,
        vars.name,
        '/api/marketing/batches',
        vars,
        e,
      )
    },
  })
}

export interface AssignBatchVars {
  batchId: string
  contactIds: string[]
}

export function useAssignBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: AssignBatchVars) =>
      postCommand<{ assignedCount: number }>(
        `/api/marketing/batches/${encodeURIComponent(vars.batchId)}/assign`,
        { contact_ids: vars.contactIds },
      ),
    onSuccess: (res) => {
      toast.success(`Assigned ${res.assignedCount} contact(s) to the batch`)
      invalidateWithLag(qc, [['marketing-batches'], ['marketing-contacts']])
    },
    onError: (e: Error, vars) => {
      toast.error('Failed to assign contacts', { description: e.message })
      recordMarketingFailure(
        `Assign ${vars.contactIds.length} contact(s) to batch`,
        vars.batchId,
        `/api/marketing/batches/${encodeURIComponent(vars.batchId)}/assign`,
        { contact_ids: vars.contactIds },
        e,
      )
    },
  })
}

export function useTriggerInvitations() {
  return useMutation({
    mutationFn: (batchId: string) =>
      postCommand<{
        invitedCount: number
        skippedUnconsented: number
        skippedNeedsReview?: number
      }>(`/api/marketing/batches/${encodeURIComponent(batchId)}/invite`),
    onSuccess: (res) => {
      const skipped = [
        res.skippedUnconsented ? `${res.skippedUnconsented} unconsented` : null,
        res.skippedNeedsReview ? `${res.skippedNeedsReview} needing review` : null,
      ].filter(Boolean)
      toast.success(
        `Invited ${res.invitedCount} member(s)` +
          (skipped.length ? ` — skipped ${skipped.join(', ')}` : ''),
      )
    },
    onError: (e: Error, batchId) => {
      toast.error('Failed to trigger invitations', { description: e.message })
      recordMarketingFailure(
        'Send batch invitations',
        batchId,
        `/api/marketing/batches/${encodeURIComponent(batchId)}/invite`,
        undefined,
        e,
      )
    },
  })
}

export interface SetFeedbackStatusVars {
  feedbackId: string
  status: 'new' | 'acknowledged' | 'resolved'
  /** What was done — required by the API when resolving. */
  note?: string
}

export function useSetFeedbackStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: SetFeedbackStatusVars) =>
      postCommand(`/api/marketing/feedback/${encodeURIComponent(vars.feedbackId)}/status`, {
        status: vars.status,
        ...(vars.note ? { note: vars.note } : {}),
      }),
    onSuccess: () => {
      toast.success('Feedback status updated')
      invalidateWithLag(qc, [['marketing-feedback']])
    },
    onError: (e: Error) => toast.error('Failed to update status', { description: e.message }),
  })
}

export interface LinkContactVars {
  contactId: string
  customerId: string
}

/** Manually link a contact to a customer (marketing detail view). */
export function useLinkContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: LinkContactVars) =>
      postCommand(`/api/marketing/contacts/${encodeURIComponent(vars.contactId)}/link`, {
        customer_id: vars.customerId,
      }),
    onSuccess: () => {
      toast.success('Contact linked')
      invalidateWithLag(qc, [['marketing-contacts']])
    },
    onError: (e: Error, vars) => {
      toast.error('Failed to link contact', { description: e.message })
      recordMarketingFailure(
        'Link contact to customer',
        vars.contactId,
        `/api/marketing/contacts/${encodeURIComponent(vars.contactId)}/link`,
        { customer_id: vars.customerId },
        e,
      )
    },
  })
}

/** Remove a contact's customer link (marketing detail view). */
export function useUnlinkContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (contactId: string) =>
      postCommand(`/api/marketing/contacts/${encodeURIComponent(contactId)}/unlink`),
    onSuccess: () => {
      toast.success('Contact unlinked')
      invalidateWithLag(qc, [['marketing-contacts']])
    },
    onError: (e: Error) => toast.error('Failed to unlink contact', { description: e.message }),
  })
}

export interface RecordConsentVars {
  contactId: string
  granted: boolean
  channels: Array<'sms' | 'whatsapp' | 'email'>
  method: string
  evidence?: string
}

/** Staff consent capture/withdrawal (offline contacts, verbal opt-outs). */
export function useRecordConsent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: RecordConsentVars) =>
      postCommand(`/api/marketing/contacts/${encodeURIComponent(vars.contactId)}/consent`, {
        granted: vars.granted,
        channels: vars.channels,
        method: vars.method,
        ...(vars.evidence ? { evidence: vars.evidence } : {}),
      }),
    onSuccess: (_res, vars) => {
      toast.success(vars.granted ? 'Consent recorded' : 'Consent withdrawal recorded')
      invalidateWithLag(qc, [['marketing-contacts']])
    },
    onError: (e: Error, vars) => {
      toast.error('Failed to record consent', { description: e.message })
      recordMarketingFailure(
        vars.granted ? 'Record consent' : 'Record consent withdrawal',
        vars.contactId,
        `/api/marketing/contacts/${encodeURIComponent(vars.contactId)}/consent`,
        {
          granted: vars.granted,
          channels: vars.channels,
          method: vars.method,
          evidence: vars.evidence,
        },
        e,
      )
    },
  })
}

export interface SetReviewFlagVars {
  contactId: string
  needsReview: boolean
  reason?: string
}

/** A2: park/unpark a contact for review (excluded from sends while set). */
export function useSetReviewFlag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: SetReviewFlagVars) =>
      postCommand(`/api/marketing/contacts/${encodeURIComponent(vars.contactId)}/review-flag`, {
        needs_review: vars.needsReview,
        ...(vars.reason ? { reason: vars.reason } : {}),
      }),
    onSuccess: (_res, vars) => {
      toast.success(vars.needsReview ? 'Contact flagged for review' : 'Review flag cleared')
      invalidateWithLag(qc, [['marketing-contacts']])
    },
    onError: (e: Error) => toast.error('Failed to update review flag', { description: e.message }),
  })
}

export interface CreateContactVars {
  first_name?: string
  email?: string
  mobile?: string
  city?: string
  postcode?: string
  channel_preference?: 'whatsapp' | 'sms'
  source: string
}

export function useCreateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: CreateContactVars) =>
      postCommand<{ contactId: string; eventId: string }>('/api/marketing/contacts', vars),
    onSuccess: () => {
      toast.success('Contact created — appearing in the grid shortly')
      invalidateWithLag(qc, [['marketing-contacts']])
    },
    onError: (e: Error) => toast.error('Failed to create contact', { description: e.message }),
  })
}

// ── Failed-actions integration ──────────────────────────────────────────────
//
// Marketing commands are idempotent platform-side, so a generic replay is
// safe: every command is a postCommand(url, body). Failures land in the
// shared failed-actions queue with enough context to replay verbatim.

export interface MarketingCommandFailureParams {
  url: string
  body?: unknown
  label: string
  [key: string]: unknown
}

export function recordMarketingFailure(
  label: string,
  subjectId: string,
  url: string,
  body: unknown,
  error: Error,
): void {
  useFailedActionsStore
    .getState()
    .addFailedAction(
      'marketing-command',
      subjectId,
      { url, body, label } satisfies MarketingCommandFailureParams,
      error.message,
      label,
    )
}

/**
 * Mount once inside the marketing views: replays failed marketing commands
 * when the Failed Actions panel dispatches a retry event.
 */
export function useMarketingCommandRetryListener() {
  const qc = useQueryClient()
  const removeAction = useFailedActionsStore((state) => state.removeAction)

  useEffect(() => {
    const onRetry = async (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { id: string; type: string; params: MarketingCommandFailureParams }
        | undefined
      if (!detail || detail.type !== 'marketing-command') return
      try {
        await postCommand(detail.params.url, detail.params.body)
        removeAction(detail.id)
        toast.success(`Retried: ${detail.params.label}`)
        invalidateWithLag(qc, [
          ['marketing-contacts'],
          ['marketing-batches'],
          ['marketing-feedback'],
        ])
      } catch (e) {
        toast.error(`Retry failed: ${detail.params.label}`, {
          description: e instanceof Error ? e.message : undefined,
        })
      }
    }
    window.addEventListener('billie-retry-action', onRetry)
    return () => window.removeEventListener('billie-retry-action', onRetry)
  }, [qc, removeAction])
}
