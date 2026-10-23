'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { DraftOutcome, DraftProgress } from '@/server/reporting/ask/draft'
import type { PartialDraft } from '@/server/reporting/ask/partial'
import type { DraftDefinition, ValidationIssue } from '@/server/reporting/ask/validate'
import type { ReportCategory, ReportViewerRole } from '@/lib/schemas/reports'

export type { DraftOutcome, DraftDefinition, ValidationIssue, PartialDraft }

export type AskClaudeParams =
  | { mode: 'ask'; question: string }
  | {
      mode: 'refine'
      question: string
      definition: DraftDefinition
      refinement: string
      issues?: Array<{ code: string; message: string }>
      /** The draft's logged request: how staff who are not authors name it. */
      askId?: string
    }
  | { mode: 'check'; question: string; definition: DraftDefinition; askId?: string }

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

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
    signal,
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

export type AskStage = 'matching' | 'planning' | 'writing_sql' | 'checking'

export interface AskProgress {
  /** Stages reached so far, with the time each began (ms from the start). */
  stages: Array<{ stage: AskStage; atMs: number }>
  partial: PartialDraft | null
  startedAt: number
}

/** Split a server-sent event stream into its events. */
export function parseEvents(buffer: string): {
  events: Array<{ event: string; data: string }>
  rest: string
} {
  const events: Array<{ event: string; data: string }> = []
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (data.length) events.push({ event, data: data.join('\n') })
  }
  return { events, rest }
}

/**
 * Ask Claude for a draft or a change, streamed: the stages and the plan
 * arrive while Claude works, and `cancel` stops it (and the request to
 * Claude). A check of a definition is not streamed (no Claude call).
 */
export function useAskClaude() {
  const [progress, setProgress] = useState<AskProgress | null>(null)
  const [isPending, setPending] = useState(false)
  const controller = useRef<AbortController | null>(null)

  // Leaving the page cancels a draft in progress.
  useEffect(() => () => controller.current?.abort(), [])

  const cancel = useCallback(() => {
    controller.current?.abort()
  }, [])

  const run = useCallback(async (params: AskClaudeParams): Promise<DraftOutcome> => {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setPending(true)
    const startedAt = Date.now()
    setProgress({ stages: [], partial: null, startedAt })
    try {
      if (params.mode === 'check') {
        setProgress({ stages: [{ stage: 'checking', atMs: 0 }], partial: null, startedAt })
        return await post<DraftOutcome>('/api/reports/ask', params, abort.signal)
      }
      const res = await fetch('/api/reports/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        credentials: 'include',
        body: JSON.stringify({ ...params, stream: true }),
        signal: abort.signal,
      })
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => null)
        throw new AskClaudeFailure(
          json?.error?.message ?? 'The request failed. Try again.',
          json?.error?.code ?? 'FAILED',
        )
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parsed = parseEvents(buffer)
        buffer = parsed.rest
        for (const { event, data } of parsed.events) {
          const payload = JSON.parse(data) as unknown
          if (event === 'stage') {
            const e = payload as Extract<DraftProgress, { type: 'stage' }>
            setProgress((p) =>
              p ? { ...p, stages: [...p.stages, { stage: e.stage, atMs: e.atMs }] } : p,
            )
          } else if (event === 'partial') {
            const e = payload as Extract<DraftProgress, { type: 'partial' }>
            setProgress((p) => (p ? { ...p, partial: e.draft } : p))
          } else if (event === 'result') {
            return payload as DraftOutcome
          } else if (event === 'error') {
            const e = (payload as { error?: { code?: string; message?: string } }).error ?? {}
            throw new AskClaudeFailure(
              e.message ?? 'The draft could not be made. Try again.',
              e.code ?? 'FAILED',
            )
          }
        }
      }
      throw new AskClaudeFailure(
        'The connection closed before the draft was ready. Try again.',
        'CLOSED',
      )
    } catch (error) {
      if (abort.signal.aborted) throw new AskClaudeFailure('Cancelled.', 'CANCELLED')
      if (error instanceof AskClaudeFailure) throw error
      throw new AskClaudeFailure('The request failed. Try again.', 'FAILED')
    } finally {
      if (controller.current === abort) {
        controller.current = null
        setPending(false)
      }
    }
  }, [])

  return { run, cancel, isPending, progress }
}

export interface SaveRequest {
  definition: DraftDefinition
  publish?: boolean
  roles?: ReportViewerRole[]
  category?: ReportCategory
  reportId?: string
}

/** Save a checked draft as a report: a draft, or published (BTB-508). */
export function useSaveAskDraft() {
  return useMutation({
    mutationFn: (request: SaveRequest) =>
      post<{ ok: true; id: string; slug: string; published: boolean }>(
        '/api/reports/ask/save',
        request,
      ),
  })
}

export interface ExistingReportMatch {
  slug: string
  title: string
  description: string | null
  parameters: Record<string, string>
}

/** Published reports that already answer a question (no Claude call). */
export async function findExistingReports(question: string): Promise<ExistingReportMatch[]> {
  try {
    const res = await fetch(`/api/reports/ask/match?q=${encodeURIComponent(question)}`, {
      credentials: 'include',
    })
    if (!res.ok) return []
    return ((await res.json()) as { matches: ExistingReportMatch[] }).matches
  } catch {
    return []
  }
}

export interface RecentAsk {
  id: string
  question: string
  title: string | null
  createdAt: string
}

/** The user's recent questions that produced a draft. */
export function useRecentAsks(enabled: boolean) {
  return useQuery({
    queryKey: ['reports', 'ask', 'recent'],
    queryFn: async (): Promise<RecentAsk[]> => {
      const res = await fetch('/api/reports/ask/recent', { credentials: 'include' })
      if (!res.ok) return []
      return ((await res.json()) as { recent: RecentAsk[] }).recent
    },
    enabled,
    staleTime: 30_000,
  })
}

/** One past question and its definition, to reopen. */
export async function loadRecentAsk(
  id: string,
): Promise<{ question: string; definition: DraftDefinition } | null> {
  const res = await fetch(`/api/reports/ask/recent?id=${encodeURIComponent(id)}`, {
    credentials: 'include',
  })
  if (!res.ok) return null
  return (await res.json()) as { question: string; definition: DraftDefinition }
}

export interface ReportDefinitionDoc extends DraftDefinition {
  id: string
  slug: string
  status: 'draft' | 'published'
  roles: ReportViewerRole[]
  featured: boolean
  schedule: string
}

/** A report's whole definition (authors), to change it. */
export async function loadReportDefinition(slug: string): Promise<ReportDefinitionDoc | null> {
  const res = await fetch(`/api/reports/${encodeURIComponent(slug)}/definition`, {
    credentials: 'include',
  })
  if (!res.ok) return null
  return (await res.json()) as ReportDefinitionDoc
}
