/**
 * API Route: GET /api/marketing/dashboard-feed
 *
 * Read-only aggregate counts for the marketing Looker Studio dashboard —
 * contacts by stage + source, referral rate, and the acquisition funnel.
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

interface CountRow {
  k: unknown
  c: unknown
}

function toCountMap(rows: CountRow[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const key = r.k == null ? 'unknown' : String(r.k)
    out[key] = Number(r.c) || 0
  }
  return out
}

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
      payload.db as { pool?: { query: (text: string) => Promise<{ rows: CountRow[] }> } }
    ).pool
    if (!pool) {
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Aggregation unavailable.' } },
        { status: 500 },
      )
    }

    const [stageRes, sourceRes, referralRes] = await Promise.all([
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
    ])

    const byStage = toCountMap(stageRes.rows)
    const bySource = toCountMap(sourceRes.rows)
    const total = Number(referralRes.rows[0]?.k ?? 0)
    const referred = Number(referralRes.rows[0]?.c ?? 0)

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
    })
  } catch (error) {
    console.error('[Marketing Dashboard Feed] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load dashboard feed.' } },
      { status: 500 },
    )
  }
}
