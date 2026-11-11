/**
 * The conversations columns the event processor uses for a verified-contact
 * stop and its "different person" clear (BTB-569), checked against the real
 * schema Payload builds.
 *
 * handlers/reapplication.py writes `reapplication_block_clear_rejection` by
 * name, and tells a contact-match stop from every other block with
 * `reapplication_block_recognition->>'band'`. Payload derives both columns from
 * the `reapplicationBlock` group, so a renamed field or a recognition column
 * that is not jsonb would silently break the processor; this pins them.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { getDashboardPool, type QueryablePool } from '@/lib/dashboard-aggregates'
import { up as migrateUp } from '@/migrations/20261111_100000_conversation_block_clear_rejection'

const MATCHED = 'VCSTOP-MATCHED'
const STOPPED = 'vcstop-conv-stranger'
const OWN = 'vcstop-conv-own'

// The guards as handlers/reapplication.py writes them.
const IS_CONTACT_MATCH_STOP = `reapplication_block_recognition->>'band' = 'verified_contact'`
const NOT_CONTACT_MATCH_STOP = `reapplication_block_recognition->>'band' IS DISTINCT FROM 'verified_contact'`

let payload: Payload
let pool: QueryablePool

const cleanup = () =>
  pool.query(`DELETE FROM conversations WHERE conversation_id = ANY($1::text[])`, [[STOPPED, OWN]])

const clearStatusOf = async (conversationId: string) => {
  const { rows } = await pool.query(
    `SELECT reapplication_block_clear_status AS status FROM conversations WHERE conversation_id = $1`,
    [conversationId],
  )
  return rows[0]?.status ?? null
}

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as QueryablePool
  await cleanup()
  // A stranger's application stopped on a shared mobile with MATCHED, and one
  // of MATCHED's own blocked applications. Both name MATCHED as canonical.
  for (const [conversationId, customer, recognition] of [
    [STOPPED, 'VCSTOP-STRANGER', JSON.stringify({ band: 'verified_contact', matched_contact_kinds: ['phone'] })],
    [OWN, MATCHED, null],
  ] as const) {
    await pool.query(
      `INSERT INTO conversations
         (conversation_id, customer_id_string, application_number, status,
          started_at, updated_at, created_at, version,
          reapplication_block_reason, reapplication_block_canonical_customer_id,
          reapplication_block_recognition)
       VALUES ($1, $2, $3, 'active', NOW(), NOW(), NOW(), 1, 'SERVICEABILITY', $4, $5::jsonb)`,
      [conversationId, customer, `APP-${conversationId}`, MATCHED, recognition],
    )
  }
})

afterAll(async () => {
  await cleanup()
})

describe('verified-contact stop columns (BTB-569)', () => {
  it('has the clear-rejection column as text and the recognition column as jsonb', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'conversations'
          AND column_name IN ('reapplication_block_clear_rejection', 'reapplication_block_recognition')
        ORDER BY column_name`,
    )
    expect(rows).toEqual([
      { column_name: 'reapplication_block_clear_rejection', data_type: 'character varying' },
      { column_name: 'reapplication_block_recognition', data_type: 'jsonb' },
    ])
  })

  it('has a migration that applies cleanly on top of the pushed schema, twice', async () => {
    const args = { db: (payload.db as any).drizzle, payload, req: {} } as any
    await migrateUp(args)
    await migrateUp(args)
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'conversations' AND column_name = 'reapplication_block_clear_rejection'`,
    )
    expect(rows).toHaveLength(1)
  })

  it("an ordinary clear of the matched customer skips the stranger's stopped application", async () => {
    await pool.query(
      `UPDATE conversations SET reapplication_block_clear_status = 'cleared'
        WHERE reapplication_block_canonical_customer_id = $1 AND (${NOT_CONTACT_MATCH_STOP})`,
      [MATCHED],
    )
    expect(await clearStatusOf(OWN)).toBe('cleared')
    expect(await clearStatusOf(STOPPED)).toBeNull()
  })

  it('a different-person outcome lands on the stopped conversation only, and reads back through Payload', async () => {
    await pool.query(
      `UPDATE conversations
          SET reapplication_block_clear_status = 'rejected',
              reapplication_block_clear_request_id = 'req-dp-1',
              reapplication_block_clear_rejection = 'UNKNOWN_STOPPED_CONVERSATION: none on record'
        WHERE conversation_id = ANY($1::text[]) AND (${IS_CONTACT_MATCH_STOP})`,
      [[STOPPED, OWN]],
    )
    expect(await clearStatusOf(STOPPED)).toBe('rejected')
    // MATCHED's own application is not a contact-match stop: untouched.
    expect(await clearStatusOf(OWN)).toBe('cleared')

    const { docs } = await payload.find({
      collection: 'conversations',
      where: { conversationId: { equals: STOPPED } },
      depth: 0,
    })
    expect(docs[0].reapplicationBlock).toMatchObject({
      reason: 'SERVICEABILITY',
      canonicalCustomerId: MATCHED,
      recognition: { band: 'verified_contact', matched_contact_kinds: ['phone'] },
      clearStatus: 'rejected',
      clearRequestId: 'req-dp-1',
      clearRejection: 'UNKNOWN_STOPPED_CONVERSATION: none on record',
    })
  })
})
