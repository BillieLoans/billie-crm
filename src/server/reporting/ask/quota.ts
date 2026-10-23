/**
 * The Ask Claude allowance for staff who are not report authors: one draft
 * in progress at a time and ASK_DAILY_LIMIT a Sydney day, held in the
 * database so it holds across every server (Fly machine), not per process.
 *
 * A draft starting takes a "pending" report-asks row, under a per-person
 * advisory lock so two requests at once cannot both pass the check; the
 * row is removed when the draft ends (its own log row records it). A
 * pending row older than the longest draft is from a server that died and
 * no longer counts.
 */
import type { Payload } from 'payload'
import { requirePgPool } from '@/lib/dashboard-aggregates'
import { sydneyDateString, sydneyDayStartUtc } from '@/lib/disbursement-cutoff'
import { ASK_STREAM_TIMEOUT_MS } from './claude'

/**
 * A pending row older than this is from a server that died. Well past the
 * longest draft (the Claude stream, the preview run and logging), so a slow
 * draft still counts as in progress.
 */
export const ASK_HOLD_MS = Math.max(10 * 60_000, ASK_STREAM_TIMEOUT_MS * 4)

export type AskSlot =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; code: 'IN_PROGRESS' | 'DAILY_LIMIT' }

/** Take a slot for one draft, or say why not. Release it when the draft ends. */
export async function holdAskSlot(
  payload: Payload,
  userId: string,
  limit: number,
  now: Date = new Date(),
): Promise<AskSlot> {
  const pool = requirePgPool(payload)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`report-ask:${userId}`])
    const fresh = new Date(now.getTime() - ASK_HOLD_MS).toISOString()
    // Abandoned holds (a server that died) are cleared, not left as "in progress".
    await client.query(
      `DELETE FROM report_asks WHERE user_id = $1 AND outcome = 'pending' AND created_at <= $2`,
      [userId, fresh],
    )
    // In progress: any live hold, whatever day it started (a draft begun just
    // before midnight still counts). Today: finished drafts and live holds.
    const { rows } = await client.query(
      `SELECT count(*) FILTER (WHERE outcome = 'pending') AS holding,
              count(*) FILTER (WHERE created_at >= $2) AS today
         FROM report_asks
        WHERE user_id = $1 AND kind IN ('ask', 'refine')
          AND created_at >= LEAST($2::timestamptz, $3::timestamptz)
          AND (outcome <> 'pending' OR created_at > $3)`,
      [userId, sydneyDayStartUtc(sydneyDateString(now)).toISOString(), fresh],
    )
    const holding = Number(rows[0]?.holding ?? 0)
    const today = Number(rows[0]?.today ?? 0)
    if (holding > 0 || today >= limit) {
      await client.query('ROLLBACK')
      return { ok: false, code: holding > 0 ? 'IN_PROGRESS' : 'DAILY_LIMIT' }
    }
    const inserted = await client.query(
      `INSERT INTO report_asks (user_id, kind, outcome, question)
       VALUES ($1, 'ask', 'pending', '(in progress)') RETURNING id`,
      [userId],
    )
    await client.query('COMMIT')
    const id = inserted.rows[0].id as string
    return {
      ok: true,
      release: async () => {
        try {
          await pool.query('DELETE FROM report_asks WHERE id = $1', [id])
        } catch (error) {
          // It stops counting as in progress after ASK_HOLD_MS anyway.
          console.error('[reports] could not release an Ask slot:', error)
        }
      },
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
