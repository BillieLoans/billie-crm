/**
 * POST /api/reports/ask — Ask Claude for a report draft (BTB-508).
 *
 * Body:
 *   { mode: 'ask', question }                                     a new draft
 *   { mode: 'refine', question, definition, refinement, issues? } revise a draft
 *   { mode: 'check', question, definition }                        re-check hand-edited SQL; no Claude call
 *
 * Report authors (admin, supervisor) only. Claude receives the reporting
 * schema description and the question, never result rows. The definition is
 * checked and previewed through the report runner.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { headers } from 'next/headers'
import Anthropic from '@anthropic-ai/sdk'
import configPromise from '@payload-config'
import { isReportAuthor } from '@/server/reporting/run-report'
import { AskUnavailableError } from '@/server/reporting/ask/claude'
import { checkEditedDefinition, draftFromQuestion } from '@/server/reporting/ask/draft'
import type { DraftDefinition } from '@/server/reporting/ask/validate'

const MAX_TEXT = 2000

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : ''
}

function asDefinition(value: unknown): DraftDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.sql !== 'string' || typeof v.title !== 'string') return null
  return {
    title: v.title,
    description: typeof v.description === 'string' ? v.description : '',
    sql: v.sql,
    parameters: v.parameters ?? [],
    chart: v.chart ?? null,
  }
}

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function POST(request: NextRequest) {
  const payload = await getPayload({ config: configPromise })
  const { user } = await payload.auth({
    headers: new Headers(Array.from((await headers()).entries())),
  })
  if (!user) return error(401, 'UNAUTHENTICATED', 'Please log in to continue.')
  if (!isReportAuthor(user))
    return error(403, 'FORBIDDEN', 'Only report authors can draft reports.')

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return error(400, 'BAD_REQUEST', 'Send a JSON body.')
  }
  const mode = body.mode
  const question = text(body.question)
  if (!question) return error(400, 'NO_QUESTION', 'Enter a question.')

  try {
    if (mode === 'ask') {
      return NextResponse.json(await draftFromQuestion(payload, user, { question }))
    }
    const definition = asDefinition(body.definition)
    if (!definition) return error(400, 'NO_DEFINITION', 'Send the draft definition.')
    if (mode === 'check') {
      return NextResponse.json(await checkEditedDefinition(payload, user, question, definition))
    }
    if (mode === 'refine') {
      const refinement = text(body.refinement)
      if (!refinement) return error(400, 'NO_REFINEMENT', 'Say what to change.')
      const issues = Array.isArray(body.issues)
        ? body.issues.filter((i): i is string => typeof i === 'string').slice(0, 20)
        : undefined
      return NextResponse.json(
        await draftFromQuestion(payload, user, {
          question,
          previous: { definition, refinement, issues },
        }),
      )
    }
    return error(400, 'BAD_MODE', 'mode must be ask, refine or check.')
  } catch (e) {
    if (e instanceof AskUnavailableError) return error(503, 'UNAVAILABLE', e.message)
    if (e instanceof Anthropic.RateLimitError) {
      return error(429, 'BUSY', 'Claude is busy. Try again in a minute.')
    }
    if (e instanceof Anthropic.APIError) {
      console.error('[reports] Claude API error:', e.status, e.message)
      return error(502, 'CLAUDE_ERROR', 'Claude could not be reached. Try again.')
    }
    console.error('[reports] Ask failed:', e)
    return error(500, 'ASK_FAILED', 'The draft could not be made. Try again.')
  }
}
