/**
 * API Route: GET /api/marketing/dashboard-feed
 *
 * Read-only aggregate counts for the marketing Looker Studio dashboard —
 * contacts by stage + source, referral rate, the acquisition funnel,
 * application acquisition by campaign and keyword (BTB-404), and by channel
 * (BTB-500: paid, organic search, LLM, social, referral, direct).
 *
 * Authenticated by a static service API key (`x-api-key` header ===
 * MARKETING_DASHBOARD_API_KEY), NOT a staff session — it's consumed by an
 * external BI tool. Fail-closed: a missing/blank env key rejects every request.
 *
 * Aggregates come straight from the `contacts` projection via the pg pool
 * (scalar GROUP BY counts — the Local API has no groupBy). Erased contacts
 * (DSR tombstones) are excluded from every metric.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { safeEqual } from '@/lib/intake-auth'

/** Canonical funnel order (mirrors Contacts.derivedStage options). */
const FUNNEL_ORDER = [
  'lead',
  'waitlist',
  'invited',
  'applicant',
  'customer',
  'former_customer',
] as const

/**
 * Acquisition channel of a conversation, from `conversations.attribution`.
 *
 *   paid      — a Google click id, or a paid utm_medium
 *   organic   — utm_medium "organic": a search engine referrer, inferred by
 *               billie.loans / chat.billie.loans (BTB-500)
 *   llm       — utm_medium "llm": an LLM assistant referrer (ChatGPT,
 *               Perplexity, Gemini, Claude, Copilot ...), inferred likewise
 *   social    — utm_medium "social": a social-network referrer
 *   referral  — utm_medium "referral": any other site, inferred by billie.loans
 *   email/sms — explicitly tagged sends
 *   other     — tagged with a medium outside the list above
 *   direct    — no attribution recorded: a direct visit, a client that sends
 *               no referrer (native LLM apps), or a conversation that started
 *               before attribution capture went live (6 Oct 2026)
 *
 * The click id keys are tested for presence only; their values are never
 * selected.
 */
const CHANNEL_SQL = `CASE
  WHEN attribution IS NULL THEN 'direct'
  WHEN attribution->>'gclid' IS NOT NULL
    OR attribution->>'gbraid' IS NOT NULL
    OR attribution->>'wbraid' IS NOT NULL
    OR LOWER(attribution->>'utm_medium') IN ('cpc', 'ppc', 'paid', 'paid_search', 'paidsearch', 'display')
    THEN 'paid'
  WHEN LOWER(attribution->>'utm_medium') IN ('organic', 'llm', 'social', 'referral', 'email', 'sms')
    THEN LOWER(attribution->>'utm_medium')
  ELSE 'other'
END`

interface CountRow {
  k: unknown
  c: unknown
}

interface OutcomeRow {
  started: unknown
  decided: unknown
  approved: unknown
}

interface AcquisitionRow extends OutcomeRow {
  channel: unknown
  utm_source: unknown
  utm_medium: unknown
  utm_campaign: unknown
  utm_term: unknown
  matchtype: unknown
}

interface ChannelRow extends OutcomeRow {
  channel: unknown
  utm_source: unknown
  utm_medium: unknown
}

const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

function toCountMap(rows: CountRow[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const key = r.k == null ? 'unknown' : String(r.k)
    out[key] = Number(r.c) || 0
  }
  return out
}

const outcomes = (r: OutcomeRow) => ({
  started: Number(r.started) || 0,
  decided: Number(r.decided) || 0,
  approved: Number(r.approved) || 0,
})

export async function GET(request: NextRequest) {
  const expected = process.env.MARKETING_DASHBOARD_API_KEY
  const provided = request.headers.get('x-api-key') ?? ''
  // Constant-time comparison to avoid leaking the key via timing side channels.
  if (!expected || !safeEqual(provided, expected)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Invalid service credentials' } },
      { status: 401 },
    )
  }

  try {
    const payload = await getPayload({ config: configPromise })
    const pool = (
      payload.db as { pool?: { query: (text: string) => Promise<{ rows: unknown[] }> } }
    ).pool
    if (!pool) {
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Aggregation unavailable.' } },
        { status: 500 },
      )
    }

    const [stageRes, sourceRes, referralRes, acquisitionRes, channelRes] = await Promise.all([
      pool.query(
        `SELECT derived_stage AS k, COUNT(*)::bigint AS c
           FROM contacts WHERE erased IS NOT TRUE GROUP BY derived_stage`,
      ),
      pool.query(
        `SELECT source AS k, COUNT(*)::bigint AS c
           FROM contacts WHERE erased IS NOT TRUE GROUP BY source`,
      ),
      pool.query(
        `SELECT COUNT(*)::bigint AS k, COUNT(referred_by_contact_id)::bigint AS c
           FROM contacts WHERE erased IS NOT TRUE`,
      ),
      // BTB-404: conversations with attribution, by campaign and keyword.
      // Counts are conversations, not distinct clicks or applicants — one
      // click can start more than one. A final-decision event with no
      // decision is stored as '' and is not "decided". Click ids are
      // deliberately not selected. Since BTB-500 this also holds organic,
      // LLM, social and referral rows (source + medium, no campaign).
      pool.query(
        `SELECT ${CHANNEL_SQL}                 AS channel,
                attribution->>'utm_source'   AS utm_source,
                attribution->>'utm_medium'   AS utm_medium,
                attribution->>'utm_campaign' AS utm_campaign,
                attribution->>'utm_term'     AS utm_term,
                attribution->>'matchtype'    AS matchtype,
                COUNT(*)::bigint             AS started,
                COUNT(NULLIF(final_decision, ''))::bigint AS decided,
                (COUNT(*) FILTER (WHERE UPPER(final_decision) = 'APPROVED'))::bigint AS approved
           FROM conversations
          WHERE attribution IS NOT NULL
          GROUP BY 1, 2, 3, 4, 5, 6
          ORDER BY started DESC, 4 NULLS LAST, 5 NULLS LAST, 6, 2, 3
          LIMIT 500`,
      ),
      // BTB-500: every conversation by channel, source and medium — the
      // paid / organic / LLM / social / referral / direct split. Unlike the
      // block above this includes conversations with no attribution, so the
      // tracked share can be read against the whole.
      pool.query(
        `SELECT channel, utm_source, utm_medium,
                COUNT(*)::bigint AS started,
                COUNT(NULLIF(final_decision, ''))::bigint AS decided,
                (COUNT(*) FILTER (WHERE UPPER(final_decision) = 'APPROVED'))::bigint AS approved
           FROM (SELECT ${CHANNEL_SQL}               AS channel,
                        attribution->>'utm_source' AS utm_source,
                        attribution->>'utm_medium' AS utm_medium,
                        final_decision
                   FROM conversations) AS c
          GROUP BY 1, 2, 3
          ORDER BY started DESC, 1, 2 NULLS LAST, 3 NULLS LAST
          LIMIT 500`,
      ),
    ])

    const byStage = toCountMap(stageRes.rows as CountRow[])
    const bySource = toCountMap(sourceRes.rows as CountRow[])
    const referralRow = referralRes.rows[0] as CountRow | undefined
    const total = Number(referralRow?.k ?? 0)
    const referred = Number(referralRow?.c ?? 0)
    const acquisition = (acquisitionRes.rows as AcquisitionRow[]).map((r) => ({
      channel: textOrNull(r.channel) ?? 'other',
      utmSource: textOrNull(r.utm_source),
      utmMedium: textOrNull(r.utm_medium),
      utmCampaign: textOrNull(r.utm_campaign),
      utmTerm: textOrNull(r.utm_term),
      matchtype: textOrNull(r.matchtype),
      ...outcomes(r),
    }))
    const channels = (channelRes.rows as ChannelRow[]).map((r) => ({
      channel: textOrNull(r.channel) ?? 'other',
      utmSource: textOrNull(r.utm_source),
      utmMedium: textOrNull(r.utm_medium),
      ...outcomes(r),
    }))

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      totalContacts: total,
      byStage,
      bySource,
      referral: {
        total,
        referred,
        rate: total > 0 ? referred / total : 0,
      },
      funnel: FUNNEL_ORDER.map((stage) => ({ stage, count: byStage[stage] ?? 0 })),
      acquisition,
      channels,
    })
  } catch (error) {
    console.error('[Marketing Dashboard Feed] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load dashboard feed.' } },
      { status: 500 },
    )
  }
}
