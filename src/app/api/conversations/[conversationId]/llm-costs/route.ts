/**
 * GET /api/conversations/:conversationId/llm-costs
 *
 * Per-conversation LLM cost roll-up (BTB-302) for the application detail view.
 * Reads the `llm-costs` projection (written by the event-processor's
 * `handle_llm_log`) and returns a server-side summary plus per-call rows.
 *
 * Access mirrors the collection's read rule: supervisor/admin only.
 * Rate-limited like the assessment routes (30 req/min/user).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { headers } from 'next/headers'
import configPromise from '@payload-config'
import { hasApprovalAuthority } from '@/lib/access'
import { checkRateLimit, ASSESSMENT_RATE_LIMIT } from '@/lib/utils/rateLimit'
import { summarizeLlmCosts, toLlmCostRow, type LlmCostsResponse } from '@/lib/llm-costs'

interface RouteParams {
  params: Promise<{ conversationId: string }>
}

/** A single application rarely exceeds a few hundred LLM calls; cap defensively. */
const MAX_ROWS = 1000

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params

  try {
    const payload = await getPayload({ config: configPromise })
    const headersList = await headers()

    const { user } = await payload.auth({
      headers: new Headers(Array.from(headersList.entries())),
    })
    if (!user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } },
        { status: 401 },
      )
    }
    if (!hasApprovalAuthority(user)) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } },
        { status: 403 },
      )
    }

    const rateLimitKey = `llm-costs:${String(user.id)}`
    if (!checkRateLimit(rateLimitKey, ASSESSMENT_RATE_LIMIT)) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
        { status: 429 },
      )
    }

    const result = await payload.find({
      collection: 'llm-costs',
      where: { conversationId: { equals: conversationId } },
      sort: '-calledAt',
      limit: MAX_ROWS,
      overrideAccess: false,
      user,
    })

    const rows = result.docs.map(toLlmCostRow)
    const body: LlmCostsResponse = {
      summary: summarizeLlmCosts(rows),
      rows,
      truncated: result.totalDocs > rows.length,
      totalDocs: result.totalDocs,
    }

    return NextResponse.json(body)
  } catch (error) {
    console.error('[GET /api/conversations/:id/llm-costs] Error:', {
      conversationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load LLM costs.' } },
      { status: 500 },
    )
  }
}
