'use client'

/**
 * Phase-2 (Stream A) marketing command mutation hooks — batches + feedback
 * triage. Thin `useMutation` wrappers over the B3 command routes, following the
 * Phase-1 marketing pattern (sonner toast + query invalidation). Each command
 * returns 202 (command → projection); the UI re-reads via the invalidated
 * list/detail queries.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

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
      qc.invalidateQueries({ queryKey: ['marketing-batches'] })
    },
    onError: (e: Error) => toast.error('Failed to create batch', { description: e.message }),
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
      qc.invalidateQueries({ queryKey: ['marketing-batches'] })
      qc.invalidateQueries({ queryKey: ['marketing-contacts'] })
    },
    onError: (e: Error) => toast.error('Failed to assign contacts', { description: e.message }),
  })
}

export function useTriggerInvitations() {
  return useMutation({
    mutationFn: (batchId: string) =>
      postCommand<{ invitedCount: number; skippedUnconsented: number }>(
        `/api/marketing/batches/${encodeURIComponent(batchId)}/invite`,
      ),
    onSuccess: (res) => {
      toast.success(
        `Invited ${res.invitedCount} member(s)` +
          (res.skippedUnconsented ? `, skipped ${res.skippedUnconsented} unconsented` : ''),
      )
    },
    onError: (e: Error) => toast.error('Failed to trigger invitations', { description: e.message }),
  })
}

export interface SetFeedbackStatusVars {
  feedbackId: string
  status: 'new' | 'acknowledged' | 'resolved'
}

export function useSetFeedbackStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: SetFeedbackStatusVars) =>
      postCommand(`/api/marketing/feedback/${encodeURIComponent(vars.feedbackId)}/status`, {
        status: vars.status,
      }),
    onSuccess: () => {
      toast.success('Feedback status updated')
      qc.invalidateQueries({ queryKey: ['marketing-feedback'] })
    },
    onError: (e: Error) => toast.error('Failed to update status', { description: e.message }),
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
      toast.success('Contact created')
      qc.invalidateQueries({ queryKey: ['marketing-contacts'] })
    },
    onError: (e: Error) => toast.error('Failed to create contact', { description: e.message }),
  })
}
