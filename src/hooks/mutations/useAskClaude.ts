'use client'

import { useMutation } from '@tanstack/react-query'
import type { DraftOutcome } from '@/server/reporting/ask/draft'
import type { DraftDefinition, ValidationIssue } from '@/server/reporting/ask/validate'

export type { DraftOutcome, DraftDefinition, ValidationIssue }

export type AskClaudeParams =
  | { mode: 'ask'; question: string }
  | {
      mode: 'refine'
      question: string
      definition: DraftDefinition
      refinement: string
      issues?: Array<{ code: string; message: string }>
    }
  | { mode: 'check'; question: string; definition: DraftDefinition }

/** A failed Ask request, with the server's message. */
export class AskClaudeFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly issues?: ValidationIssue[],
  ) {
    super(message)
    this.name = 'AskClaudeFailure'
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const error = json?.error ?? {}
    throw new AskClaudeFailure(
      error.message ?? 'The request failed. Try again.',
      error.code ?? 'FAILED',
      error.issues,
    )
  }
  return json as T
}

/** Ask Claude for a draft, refine one, or re-check hand-edited SQL (BTB-508). */
export function useAskClaude() {
  return useMutation({
    mutationFn: (params: AskClaudeParams) => post<DraftOutcome>('/api/reports/ask', params),
  })
}

/** Save a checked draft as an unpublished report (BTB-508). */
export function useSaveAskDraft() {
  return useMutation({
    mutationFn: (definition: DraftDefinition) =>
      post<{ ok: true; id: string; slug: string }>('/api/reports/ask/save', { definition }),
  })
}
