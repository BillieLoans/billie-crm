/**
 * The Ask Claude allowance for staff who are not authors, against the real
 * Postgres: requests arriving together (as from different servers) get one
 * slot between them; the daily limit counts finished and in-progress
 * drafts; a slot left by a server that died stops counting.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import type { Pool } from 'pg'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { ASK_HOLD_MS, holdAskSlot } from '@/server/reporting/ask/quota'

let payload: Payload
let pool: Pool
let userId: string
const PREFIX = 'rptquota'

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as unknown as Pool
  await pool.query(`DELETE FROM users WHERE email LIKE '${PREFIX}-%'`)
  const user = await payload.create({
    collection: 'users',
    data: {
      email: `${PREFIX}-${Date.now()}@billie.loans`,
      password: 'Test1234!',
      role: 'readonly',
      firstName: 'Quota',
      lastName: 'User',
    },
  })
  userId = String(user.id)
}, 60_000)

beforeEach(async () => {
  await pool.query(`DELETE FROM report_asks WHERE user_id = $1`, [userId])
})

afterAll(async () => {
  await pool.query(`DELETE FROM report_asks WHERE user_id = $1`, [userId])
  await pool.query(`DELETE FROM users WHERE email LIKE '${PREFIX}-%'`)
})

describe('holdAskSlot', () => {
  it('gives one slot to requests that arrive together, and frees it on release', async () => {
    const slots = await Promise.all(
      Array.from({ length: 5 }, () => holdAskSlot(payload, userId, 20)),
    )
    const granted = slots.filter((s) => s.ok)
    expect(granted).toHaveLength(1)
    expect(slots.filter((s) => !s.ok).map((s) => !s.ok && s.code)).toEqual(
      Array(4).fill('IN_PROGRESS'),
    )
    await (granted[0] as { release: () => Promise<void> }).release()
    expect((await holdAskSlot(payload, userId, 20)).ok).toBe(true)
  })

  it('counts finished drafts toward the daily limit', async () => {
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO report_asks (user_id, kind, outcome) VALUES ($1, 'ask', 'ok')`,
        [userId],
      )
    }
    // A check makes no Claude call and does not count.
    await pool.query(
      `INSERT INTO report_asks (user_id, kind, outcome) VALUES ($1, 'check', 'ok')`,
      [userId],
    )
    expect(await holdAskSlot(payload, userId, 3)).toEqual({ ok: false, code: 'DAILY_LIMIT' })
    expect((await holdAskSlot(payload, userId, 4)).ok).toBe(true)
  })

  it('clears a slot left by a server that died', async () => {
    await pool.query(
      `INSERT INTO report_asks (user_id, kind, outcome, created_at) VALUES ($1, 'ask', 'pending', $2)`,
      [userId, new Date(Date.now() - ASK_HOLD_MS - 60_000).toISOString()],
    )
    expect((await holdAskSlot(payload, userId, 20)).ok).toBe(true)
    const left = await pool.query(
      `SELECT count(*)::int AS n FROM report_asks WHERE user_id = $1 AND outcome = 'pending'`,
      [userId],
    )
    expect(left.rows[0].n).toBe(1) // only the new hold
  })

  it('still counts a draft begun just before midnight as in progress after it', async () => {
    // 13:00 UTC is midnight in Sydney during daylight saving (AEDT).
    const midnight = new Date('2026-11-02T13:00:00Z')
    await pool.query(
      `INSERT INTO report_asks (user_id, kind, outcome, created_at) VALUES ($1, 'ask', 'pending', $2)`,
      [userId, new Date(midnight.getTime() - 30_000).toISOString()],
    )
    expect(await holdAskSlot(payload, userId, 20, new Date(midnight.getTime() + 10_000))).toEqual({
      ok: false,
      code: 'IN_PROGRESS',
    })
  })
})
