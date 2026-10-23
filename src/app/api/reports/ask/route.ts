/**
 * POST /api/reports/ask — Ask Claude for a report draft (BTB-508).
 *
 * Body:
 *   { mode: 'ask', question, stream? }                                     a new draft
 *   { mode: 'refine', question, definition, refinement, issues?, stream? } revise a draft
 *   { mode: 'check', question, definition }                                 re-check a definition; no Claude call
 *
 * With `stream: true` the answer is a server-sent event stream: `stage`
 * and `partial` events (the plan, as Claude writes it) while it works,
 * then `result` (the outcome) or `error`, with a comment every few seconds
 * so the connection never sits idle. Closing the request cancels the call
 * to Claude.
 *
 * Any staff role can ask (report authors without limit, others up to
 * ASK_DAILY_LIMIT a Sydney day); only authors can save. Claude receives the
 * reporting schema description, the question and, for a refinement, the
 * draft and what the checks found (with result values and database errors
 * replaced by fixed text), never result rows. Every text is size-bounded.
 * The definition is checked and previewed through the report runner.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { isReportAuthor } from '@/server/reporting/run-report'
import { AskUnavailableError } from '@/server/reporting/ask/claude'
import { holdAskSlot } from '@/server/reporting/ask/quota'
import {
  checkEditedDefinition,
  draftFromQuestion,
  loadOwnAsk,
  parseDefinition,
  parseIssues,
  type DraftStreamOptions,
} from '@/server/reporting/ask/draft'

const MAX_TEXT = 2000

/** Questions and refinements a day for staff who are not report authors. */
export const ASK_DAILY_LIMIT = 20

/** Seconds between keep-alive comments on a streamed answer. */
const HEARTBEAT_MS = 10_000

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : ''
}

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status })
}

/** What a failed draft tells the person, and its HTTP status. */
function failure(e: unknown): { status: number; code: string; message: string } {
  if (e instanceof AskUnavailableError)
    return { status: 503, code: 'UNAVAILABLE', message: e.message }
  if (e instanceof Anthropic.APIUserAbortError) {
    return { status: 499, code: 'CANCELLED', message: 'The request was cancelled.' }
  }
  if (e instanceof Anthropic.RateLimitError) {
    return { status: 429, code: 'BUSY', message: 'Claude is busy. Try again in a minute.' }
  }
  if (e instanceof Anthropic.APIError) {
    console.error('[reports] Claude API error:', e.status, e.message)
    return { status: 502, code: 'CLAUDE_ERROR', message: 'Claude could not be reached. Try again.' }
  }
  console.error('[reports] Ask failed:', e)
  return { status: 500, code: 'ASK_FAILED', message: 'The draft could not be made. Try again.' }
}

/** Run a draft and stream its progress as server-sent events. */
function streamDraft(
  request: NextRequest,
  run: (options: DraftStreamOptions) => Promise<unknown>,
): Response {
  const encoder = new TextEncoder()
  const abort = new AbortController()
  request.signal?.addEventListener('abort', () => abort.abort())
  let closed = false
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
        }
      }
      const send = (event: string, data: unknown) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      const heartbeat = setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS)
      try {
        const outcome = await run({
          signal: abort.signal,
          onProgress: (event) => send(event.type, event),
        })
        send('result', outcome)
      } catch (e) {
        const { code, message } = failure(e)
        send('error', { error: { code, message } })
      } finally {
        clearInterval(heartbeat)
        if (!closed) {
          closed = true
          controller.close()
        }
      }
    },
    cancel() {
      closed = true
      abort.abort()
    },
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  const { payload, user } = auth

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return error(400, 'BAD_REQUEST', 'Send a JSON body.')
  }
  const mode = body.mode
  const question = text(body.question)
  if (!question) return error(400, 'NO_QUESTION', 'Enter a question.')
  if (mode !== 'ask' && mode !== 'refine' && mode !== 'check') {
    return error(400, 'BAD_MODE', 'mode must be ask, refine or check.')
  }

  // Report authors may send any definition (hand-edited SQL included).
  // Everyone else can only check or refine a definition Ask Claude gave
  // them, named by its askId: never SQL of their own.
  const author = isReportAuthor(user)
  let definition = null
  if (mode !== 'ask') {
    if (author) {
      definition = parseDefinition(body.definition)
    } else {
      const askId = typeof body.askId === 'string' ? body.askId.slice(0, 100) : ''
      definition = askId
        ? ((await loadOwnAsk(payload, String(user.id), askId))?.definition ?? null)
        : null
      if (!definition) {
        return error(
          400,
          'NO_DEFINITION',
          'Ask a question first; only report authors can check SQL of their own.',
        )
      }
    }
    if (!definition) {
      return error(400, 'NO_DEFINITION', 'Send the draft definition (within the size limits).')
    }
  }
  const refinement = mode === 'refine' ? text(body.refinement) : ''
  if (mode === 'refine' && !refinement) return error(400, 'NO_REFINEMENT', 'Say what to change.')

  // Staff who are not authors: one draft at a time and a daily limit,
  // held in the database so they hold across servers.
  let release: () => Promise<void> = async () => {}
  if (mode !== 'check' && !author) {
    const slot = await holdAskSlot(payload, String(user.id), ASK_DAILY_LIMIT)
    if (!slot.ok) {
      return slot.code === 'IN_PROGRESS'
        ? error(
            429,
            'IN_PROGRESS',
            'Claude is already drafting a report for you. Wait for it, or cancel it.',
          )
        : error(
            429,
            'DAILY_LIMIT',
            `You have asked ${ASK_DAILY_LIMIT} questions today, the daily limit. Ask a report author, or try again tomorrow.`,
          )
    }
    release = slot.release
  }

  const draft = (options: DraftStreamOptions = {}) =>
    mode === 'ask'
      ? draftFromQuestion(payload, user, { question }, {}, options)
      : draftFromQuestion(
          payload,
          user,
          {
            question,
            previous: {
              definition: definition!,
              refinement,
              issues: parseIssues(body.issues),
            },
          },
          {},
          options,
        )

  if (mode !== 'check' && body.stream === true) {
    return streamDraft(request, (options) => draft(options).finally(release))
  }

  try {
    if (mode === 'check') {
      return NextResponse.json(await checkEditedDefinition(payload, user, question, definition!))
    }
    return NextResponse.json(await draft())
  } catch (e) {
    const { status, code, message } = failure(e)
    return error(status, code, message)
  } finally {
    await release()
  }
}
