/**
 * Synthetic TEST data for the AI-authored reports benchmark (BTB-508).
 *
 * Every row is clearly marked: ids start with TEST-BENCH, customers with
 * TEST-BENCH-CUST. Nothing is copied from real records. The generator is
 * deterministic (seeded), so every benchmark run sees the same data.
 *
 * Covers 1 September to 31 October 2026 (Sydney) and deliberately includes:
 * - starts minutes either side of Sydney midnight, before and after the
 *   daylight-saving change on Sunday 4 October 2026 (UTC+10 → UTC+11);
 * - revised decisions (declined, then approved later);
 * - repeated deliveries of the same decision event, which the unique
 *   decision key absorbs as the event processor's upsert does (so the table
 *   never holds a duplicate; this exercises the insert path, not a trap);
 * - mock approvals, some with loans;
 * - conversations before attribution capture (6 October 2026) and ad
 *   clicks with no UTM tags;
 * - repeat applications by the same customer.
 *
 * Clearing removes the TEST-BENCH rows and every `snap_portfolio` row for
 * September and October 2026 (snapshots carry no TEST marker), so seed only
 * a branch whose snapshots you do not need.
 *
 * Usage (on a Neon branch with the CRM schema migrated, never production):
 *   BENCH_DATABASE_URI=postgresql://owner@…/branch pnpm exec tsx scripts/report-benchmark/seed.ts
 */
import { Pool } from 'pg'

export const BENCH_PREFIX = 'TEST-BENCH'

type Q = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const DST_START = Date.UTC(2026, 9, 3, 16) // 2026-10-04 02:00 AEST = 03:00 AEDT
const sydneyOffsetHours = (t: number) => (t >= DST_START ? 11 : 10)

/** UTC instant for a Sydney wall-clock time. */
function sydney(y: number, m: number, d: number, h: number, min = 0): number {
  const guess = Date.UTC(y, m - 1, d, h, min)
  return guess - sydneyOffsetHours(guess - 10 * HOUR) * HOUR
}

const REASONS: Array<[string, number]> = [
  ['CREDIT_ASSESSMENT:SERVICEABILITY', 0.35],
  ['CREDIT_ASSESSMENT:ACCOUNT_CONDUCT', 0.2],
  ['CREDIT_ASSESSMENT:ID_VERIFICATION', 0.1],
  ['BUSINESS_ACCOUNT', 0.1],
  ['NO_PERSONAL_ACCOUNT', 0.08],
  ['REAPPLICATION_BLOCK:RECENT_DECLINE', 0.07],
  ['CREDIT_ASSESSMENT:FINAL_RULE', 0.06],
  ['SYSTEM_FAILURE:TIMEOUT', 0.04],
]

const ATTRIBUTION: Array<[Record<string, string> | null, number]> = [
  [{ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'pay-advance-au' }, 0.25],
  [{ utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'spring-promo' }, 0.1],
  [{ gclid: 'test-click' }, 0.05],
  [{ utm_source: 'google', utm_medium: 'organic' }, 0.15],
  [{ utm_source: 'chatgpt.com', utm_medium: 'llm' }, 0.05],
  [{ utm_source: 'finder.com.au', utm_medium: 'referral' }, 0.1],
  [{ utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'october' }, 0.05],
  [null, 0.25],
]

function pick<T>(r: () => number, weighted: Array<[T, number]>): T {
  let x = r()
  for (const [v, w] of weighted) {
    if ((x -= w) < 0) return v
  }
  return weighted[weighted.length - 1][0]
}

/** Remove previous benchmark rows. */
export async function clearBenchmark(db: Q): Promise<void> {
  const like = `${BENCH_PREFIX}%`
  await db.query(`DELETE FROM reporting.decision_event WHERE conversation_id LIKE $1`, [like])
  await db.query(
    `DELETE FROM loan_accounts_repayment_schedule_payments
      WHERE _parent_id IN (SELECT id FROM loan_accounts WHERE loan_account_id LIKE $1)`,
    [like],
  )
  await db.query(`DELETE FROM loan_accounts WHERE loan_account_id LIKE $1`, [like])
  await db.query(`DELETE FROM conversations WHERE conversation_id LIKE $1`, [like])
  await db.query(
    `DELETE FROM reporting.snap_portfolio WHERE as_at_date BETWEEN '2026-09-01' AND '2026-10-31'`,
  )
}

/**
 * Insert the benchmark data set.
 *
 * @returns counts of what was written.
 */
export async function seedBenchmark(db: Q, seed = 20261022): Promise<Record<string, number>> {
  const r = rng(seed)
  await clearBenchmark(db)
  const counts = {
    conversations: 0,
    decisionEvents: 0,
    duplicateDeliveries: 0,
    loans: 0,
    instalments: 0,
    snapshots: 0,
  }
  const start = sydney(2026, 9, 1, 0)
  const end = sydney(2026, 11, 1, 0)

  // Starts placed either side of Sydney midnight around the DST change.
  const edges: number[] = []
  for (const [m, d] of [
    [10, 2],
    [10, 3],
    [10, 4],
    [10, 5],
    [9, 15],
  ]) {
    const midnight = sydney(2026, m, d, 0)
    edges.push(midnight - 3 * 60_000, midnight + 3 * 60_000)
  }

  const total = 600
  for (let i = 0; i < total; i++) {
    const id = `${BENCH_PREFIX}-C${String(i).padStart(4, '0')}`
    const startedAt = i < edges.length ? edges[i] : start + Math.floor(r() * (end - start))
    const customer = `${BENCH_PREFIX}-CUST${String(Math.floor(r() * 450)).padStart(3, '0')}`
    const capturing = startedAt >= sydney(2026, 10, 6, 0)
    const attribution = capturing ? pick(r, ATTRIBUTION) : null
    const submitted = r() < 0.72
    const decides = submitted && r() < 0.85
    const mock = decides && r() < 0.03
    let decision: 'APPROVED' | 'DECLINED' | 'REFERRED' | null = null
    let reason: string | null = null
    if (decides) {
      const x = r()
      decision = mock ? 'APPROVED' : x < 0.45 ? 'APPROVED' : x < 0.95 ? 'DECLINED' : 'REFERRED'
      if (decision === 'DECLINED') reason = r() < 0.05 ? null : pick(r, REASONS)
    }
    const decidedAt = decides ? startedAt + Math.floor((5 + r() * 175) * 60_000) : null
    const ruleset = mock
      ? null
      : decidedAt && decidedAt < sydney(2026, 10, 1, 0)
        ? 'rs-2026-09'
        : 'rs-2026-10'
    const appNumber = submitted ? `${BENCH_PREFIX}-APP${String(i).padStart(4, '0')}` : ''
    const revised = decision === 'APPROVED' && !mock && r() < 0.08

    await db.query(
      `INSERT INTO conversations
         (conversation_id, application_number, customer_id_string, status, started_at, attribution,
          decision_status, decision_detail_reason, decision_detail_ruleset_version,
          statement_capture, version)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, 1)`,
      [
        id,
        appNumber,
        customer,
        // conversations.status has no 'referred'; a referred chat waits, paused.
        decision && decision !== 'REFERRED'
          ? decision.toLowerCase()
          : submitted
            ? 'paused'
            : 'hard_end',
        new Date(startedAt).toISOString(),
        attribution ? JSON.stringify(attribution) : null,
        decision ? decision.toLowerCase() : null,
        reason,
        ruleset,
        submitted && r() < 0.95 ? JSON.stringify({ consentStatus: 'complete' }) : null,
      ],
    )
    counts.conversations++

    if (decision && decidedAt) {
      const events: Array<[string, string, string | null, number]> = []
      if (revised) {
        events.push([
          `${id}-d1`,
          'DECLINED',
          'CREDIT_ASSESSMENT:FINAL_RULE',
          // Between the start and the final decision.
          startedAt + Math.floor((decidedAt - startedAt) / 2),
        ])
      }
      events.push([`${id}-d${events.length + 1}`, decision, reason, decidedAt])
      for (const [key, d, why, at] of events) {
        const deliveries = r() < 0.1 ? 2 : 1 // duplicate delivery of the same event
        for (let k = 0; k < deliveries; k++) {
          await db.query(
            `INSERT INTO reporting.decision_event
               (decision_key, event_id, conversation_id, application_number, decision, reason,
                retry_eligible, ruleset_version, build_sha, mock_origin, decided_at)
             VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (decision_key) DO NOTHING`,
            [
              key,
              id,
              appNumber || null,
              d,
              why,
              d === 'DECLINED' ? r() < 0.4 : null,
              ruleset,
              ruleset ? `sha-${ruleset.slice(-2)}a1` : null,
              mock,
              new Date(at).toISOString(),
            ],
          )
          if (k === 0) counts.decisionEvents++
          else counts.duplicateDeliveries++
        }
      }
    }

    if (decision === 'APPROVED' && decidedAt && r() < 0.85) {
      const disbursedAt = decidedAt + Math.floor((2 + r() * 38) * HOUR)
      if (disbursedAt >= end) continue
      const amount = 100 + 50 * Math.floor(r() * 9)
      const fee = Math.round(amount * 0.2 * 100) / 100
      const each = Math.round(((amount + fee) / 4) * 100) / 100

      // The schedule decides the loan's state, so the two always agree.
      // "Now" is the end of the window (1 November 2026, Sydney).
      const dues = [1, 2, 3, 4].map((n) => disbursedAt + n * 14 * DAY)
      const pastDue = dues.filter((due) => due < end).length
      const x = r()
      let status: 'active' | 'paid_off' | 'in_arrears' | 'written_off' =
        x < 0.55 ? 'active' : x < 0.8 ? 'paid_off' : x < 0.95 ? 'in_arrears' : 'written_off'
      // Arrears and write-off need a missed instalment that has fallen due.
      if ((status === 'in_arrears' || status === 'written_off') && pastDue === 0) status = 'active'
      const missedFrom = status === 'in_arrears' ? 1 + Math.floor(r() * pastDue) : 1
      const schedule = dues.map((due, k) => {
        const n = k + 1
        const st =
          status === 'paid_off'
            ? 'paid'
            : due >= end
              ? 'scheduled'
              : status === 'written_off' || (status === 'in_arrears' && n >= missedFrom)
                ? 'missed'
                : 'paid'
        return { n, due, st, paid: st === 'paid' ? each : 0 }
      })
      const paid = Math.round(schedule.reduce((sum, p) => sum + p.paid, 0) * 100) / 100
      const closed = status === 'paid_off' || status === 'written_off'
      const firstMissed = schedule.find((p) => p.st === 'missed')
      const inArrears = status === 'in_arrears'
      const dpd = inArrears && firstMissed ? Math.floor((end - firstMissed.due) / DAY) : 0
      const closedAt = closed
        ? status === 'paid_off'
          ? Math.min(disbursedAt + Math.floor(r() * 50) * DAY, end - HOUR)
          : Math.min((firstMissed?.due ?? disbursedAt) + 30 * DAY, end - HOUR)
        : null

      const { rows } = await db.query(
        `INSERT INTO loan_accounts
           (loan_account_id, account_number, customer_id_string, account_status,
            loan_terms_loan_amount, loan_terms_loan_fee, loan_terms_total_payable,
            loan_terms_disbursed_date, application_number, aging_is_in_arrears, aging_bucket,
            aging_current_d_p_d, balances_total_outstanding, balances_total_paid,
            closure_reason, closure_closed_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id`,
        [
          `${BENCH_PREFIX}-L${String(i).padStart(4, '0')}`,
          `ACC-${BENCH_PREFIX}-${i}`,
          customer,
          status,
          amount,
          fee,
          amount + fee,
          new Date(disbursedAt).toISOString(),
          appNumber,
          inArrears,
          inArrears ? (dpd > 30 ? 'late_arrears' : 'early_arrears') : closed ? 'closed' : 'current',
          dpd,
          closed ? 0 : Math.round((amount + fee - paid) * 100) / 100,
          paid,
          status === 'paid_off' ? 'PAID_OFF' : status === 'written_off' ? 'WRITTEN_OFF' : null,
          closedAt === null ? null : new Date(closedAt).toISOString(),
        ],
      )
      counts.loans++
      const parent = rows[0].id
      for (const p of schedule) {
        await db.query(
          `INSERT INTO loan_accounts_repayment_schedule_payments
             (_order, _parent_id, id, payment_number, due_date, amount, status, amount_paid,
              amount_remaining, paid_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            p.n,
            parent,
            `${BENCH_PREFIX}-P${i}-${p.n}`,
            p.n,
            new Date(p.due).toISOString(),
            each,
            p.st,
            p.paid,
            Math.round((each - p.paid) * 100) / 100,
            p.paid > 0
              ? new Date(Math.min(p.due, end - HOUR) - Math.floor(r() * 24) * HOUR).toISOString()
              : null,
          ],
        )
        counts.instalments++
      }
    }
  }

  // One ledger snapshot per Sydney day.
  for (
    let d = new Date(Date.UTC(2026, 8, 1));
    d < new Date(Date.UTC(2026, 10, 1));
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const day = d.toISOString().slice(0, 10)
    const k = (d.getTime() - Date.UTC(2026, 8, 1)) / (24 * HOUR)
    const principal = 20000 + k * 450 + Math.round(r() * 1000)
    const fees = Math.round(principal * 0.2 * 100) / 100
    await db.query(
      `INSERT INTO reporting.snap_portfolio
         (as_at_date, total_active_accounts, principal_receivable, fees_receivable, total_receivables)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (as_at_date) DO UPDATE SET
         total_active_accounts = EXCLUDED.total_active_accounts,
         principal_receivable = EXCLUDED.principal_receivable,
         fees_receivable = EXCLUDED.fees_receivable,
         total_receivables = EXCLUDED.total_receivables`,
      [day, 80 + Math.floor(k * 2.5), principal, fees, principal + fees],
    )
    counts.snapshots++
  }
  return counts
}

async function main(): Promise<void> {
  const uri = process.env.BENCH_DATABASE_URI
  if (!uri) throw new Error('Set BENCH_DATABASE_URI to the benchmark branch (owner role)')
  const pool = new Pool({ connectionString: uri, max: 2 })
  try {
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM conversations WHERE conversation_id NOT LIKE 'TEST-%')
            + (SELECT count(*) FROM loan_accounts WHERE loan_account_id NOT LIKE 'TEST-%')
              AS n`,
    )
    if (Number(rows[0].n) > 0) {
      throw new Error(
        `This database holds ${rows[0].n} conversations or loans that are not TEST data. ` +
          'Seed an empty Neon branch, never one with real records.',
      )
    }
    console.log(await seedBenchmark(pool))
  } finally {
    await pool.end()
  }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
