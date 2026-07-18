/**
 * API Route: GET /api/marketing/overview
 *
 * Staff-session variant of the Looker dashboard-feed aggregates, powering the
 * in-app stats strip on the marketing landing page: acquisition funnel by
 * stage, consented contact count, open feedback and overdue complaints.
 * Erased contacts (DSR tombstones) and merged-away duplicates are excluded,
 * matching the dashboard-feed's posture. Gated on `canReadMarketing` — unlike
 * dashboard-feed this is a session-authenticated staff read, not a service
 * key.
 */

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canReadMarketing } from '@/lib/access'
import { OVERDUE_COMPLAINT_DAYS } from '@/lib/marketing-labels'

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

export async function GET() {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload } = auth

  try {
    const pool = (
      payload.db as { pool?: { query: (text: string) => Promise<{ rows: CountRow[] }> } }
    ).pool
    if (!pool) throw new Error('pg pool unavailable')

    const overdueThreshold = new Date(
      Date.now() - OVERDUE_COMPLAINT_DAYS * 86_400_000,
    ).toISOString()

    const [stageRows, consentedRows, openFeedbackRows, overdueRows] = await Promise.all([
      pool.query(
        `SELECT derived_stage AS k, COUNT(*) AS c FROM contacts
         WHERE (erased IS NOT TRUE) AND merged_into IS NULL
         GROUP BY derived_stage`,
      ),
      pool.query(
        `SELECT 'consented' AS k, COUNT(*) AS c FROM contacts
         WHERE (erased IS NOT TRUE) AND merged_into IS NULL
           AND (consent -> 'marketing' ->> 'granted')::boolean IS TRUE`,
      ),
      pool.query(
        `SELECT 'open' AS k, COUNT(*) AS c FROM feedback
         WHERE status IS DISTINCT FROM 'resolved'`,
      ),
      pool.query(
        `SELECT 'overdue' AS k, COUNT(*) AS c FROM feedback
         WHERE status IS DISTINCT FROM 'resolved'
           AND LOWER(feedback_type) = 'complaint'
           AND received_at < '${overdueThreshold}'`,
      ),
    ])

    const byStage: Record<string, number> = {}
    for (const row of stageRows.rows) {
      byStage[row.k == null ? 'unknown' : String(row.k)] = Number(row.c) || 0
    }
    const funnel = FUNNEL_ORDER.map((stage) => ({ stage, count: byStage[stage] ?? 0 }))
    const totalContacts = Object.values(byStage).reduce((a, b) => a + b, 0)

    return NextResponse.json({
      totalContacts,
      funnel,
      consented: Number(consentedRows.rows[0]?.c) || 0,
      openFeedback: Number(openFeedbackRows.rows[0]?.c) || 0,
      overdueComplaints: Number(overdueRows.rows[0]?.c) || 0,
    })
  } catch (e) {
    console.error('[Marketing Overview] query error:', e)
    return NextResponse.json(
      { error: { code: 'QUERY_FAILED', message: 'Loading the marketing overview failed.' } },
      { status: 500 },
    )
  }
}
