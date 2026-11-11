/**
 * The conversations columns the event processor uses for "Undo clear" of a
 * different-person clear (BTB-569), checked against the real schema Payload
 * builds.
 *
 * handlers/reapplication.py writes these by name, compares the two timestamps
 * to order an undo against a clear, and moves the undone clear's who / when /
 * why into the `revoked_clear_*` columns. Payload derives the columns from the
 * `reapplicationBlock` group, so a renamed field or a date stored as text
 * would silently break the processor; this pins them.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { getDashboardPool, type QueryablePool } from '@/lib/dashboard-aggregates'
import { up as migrateUp } from '@/migrations/20261111_110000_conversation_block_clear_revoke'

const MATCHED = 'VCUNDO-MATCHED'
const STOPPED = 'vcundo-conv-stranger'
const OWN = 'vcundo-conv-own'

const UNDO_COLUMNS = [
  { column_name: 'reapplication_block_clear_revoke_justification', data_type: 'character varying' },
  { column_name: 'reapplication_block_clear_revoke_rejection', data_type: 'character varying' },
  { column_name: 'reapplication_block_clear_revoke_request_id', data_type: 'character varying' },
  { column_name: 'reapplication_block_clear_revoke_status', data_type: 'character varying' },
  { column_name: 'reapplication_block_clear_revoked_at', data_type: 'timestamp with time zone' },
  { column_name: 'reapplication_block_clear_revoked_by', data_type: 'character varying' },
  { column_name: 'reapplication_block_revoked_clear_at', data_type: 'timestamp with time zone' },
  { column_name: 'reapplication_block_revoked_clear_by', data_type: 'character varying' },
  { column_name: 'reapplication_block_revoked_clear_justification', data_type: 'character varying' },
]

// The guard as handlers/reapplication.py writes it.
const IS_CONTACT_MATCH_STOP = `reapplication_block_recognition->>'band' = 'verified_contact'`

let payload: Payload
let pool: QueryablePool

const cleanup = () =>
  pool.query(`DELETE FROM conversations WHERE conversation_id = ANY($1::text[])`, [[STOPPED, OWN]])

const undoColumnsOf = async () => {
  const { rows } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'conversations' AND column_name = ANY($1::text[])
      ORDER BY column_name`,
    [UNDO_COLUMNS.map((c) => c.column_name)],
  )
  return rows
}

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as QueryablePool
  await cleanup()
  // A stranger's application stopped on a shared mobile with MATCHED and then
  // cleared as a different person, and one of MATCHED's own cleared blocks.
  for (const [conversationId, customer, recognition] of [
    [STOPPED, 'VCUNDO-STRANGER', JSON.stringify({ band: 'verified_contact', matched_contact_kinds: ['phone'] })],
    [OWN, MATCHED, null],
  ] as const) {
    await pool.query(
      `INSERT INTO conversations
         (conversation_id, customer_id_string, application_number, status,
          started_at, updated_at, created_at, version,
          reapplication_block_reason, reapplication_block_canonical_customer_id,
          reapplication_block_recognition,
          reapplication_block_clear_status, reapplication_block_cleared_at,
          reapplication_block_cleared_by, reapplication_block_clear_justification,
          reapplication_block_clear_request_id)
       VALUES ($1, $2, $3, 'active', NOW(), NOW(), NOW(), 1, 'ACTIVE_LOAN', $4, $5::jsonb,
               'cleared', '2026-11-11T02:00:00Z', 'ops-7', 'Recycled number', 'req-clear-1')`,
      [conversationId, customer, `APP-${conversationId}`, MATCHED, recognition],
    )
  }
})

afterAll(async () => {
  await cleanup()
})

describe('different-person clear undo columns (BTB-569)', () => {
  it('has the undo columns, with the two times as timestamps', async () => {
    expect(await undoColumnsOf()).toEqual(UNDO_COLUMNS)
  })

  it('has a migration that applies cleanly on top of the pushed schema, twice', async () => {
    const args = { db: (payload.db as any).drizzle, payload, req: {} } as any
    await migrateUp(args)
    await migrateUp(args)
    expect(await undoColumnsOf()).toEqual(UNDO_COLUMNS)
  })

  it('an applied undo lands on the stopped conversation only, and reads back through Payload', async () => {
    // The shape of the event processor's write for clear_revoked.v1: the stop
    // is uncleared, the undo is recorded, and the clear it removed is kept.
    await pool.query(
      `UPDATE conversations
          SET reapplication_block_revoked_clear_at = reapplication_block_cleared_at,
              reapplication_block_revoked_clear_by = reapplication_block_cleared_by,
              reapplication_block_revoked_clear_justification = reapplication_block_clear_justification,
              reapplication_block_clear_status = NULL,
              reapplication_block_cleared_at = NULL,
              reapplication_block_cleared_by = NULL,
              reapplication_block_clear_justification = NULL,
              reapplication_block_clear_revoke_status = 'revoked',
              reapplication_block_clear_revoke_request_id = 'req-undo-1',
              reapplication_block_clear_revoked_at = $2::timestamptz,
              reapplication_block_clear_revoked_by = 'ops-9',
              reapplication_block_clear_revoke_justification = 'Same person after all'
        WHERE conversation_id = ANY($1::text[]) AND (${IS_CONTACT_MATCH_STOP})
          AND reapplication_block_clear_status = 'cleared'
          AND reapplication_block_cleared_at < $2::timestamptz`,
      [[STOPPED, OWN], '2026-11-12T03:00:00Z'],
    )

    const find = async (conversationId: string) =>
      (
        await payload.find({
          collection: 'conversations',
          where: { conversationId: { equals: conversationId } },
          depth: 0,
        })
      ).docs[0].reapplicationBlock

    const stopped = await find(STOPPED)
    expect(stopped).toMatchObject({
      reason: 'ACTIVE_LOAN',
      canonicalCustomerId: MATCHED,
      recognition: { band: 'verified_contact', matched_contact_kinds: ['phone'] },
      clearRequestId: 'req-clear-1',
      clearRevokeStatus: 'revoked',
      clearRevokeRequestId: 'req-undo-1',
      clearRevokedAt: '2026-11-12T03:00:00.000Z',
      clearRevokedBy: 'ops-9',
      clearRevokeJustification: 'Same person after all',
      revokedClearAt: '2026-11-11T02:00:00.000Z',
      revokedClearBy: 'ops-7',
      revokedClearJustification: 'Recycled number',
    })
    // Uncleared again, so "Clear: different person" is offered.
    expect(stopped?.clearStatus ?? null).toBeNull()
    expect(stopped?.clearedAt ?? null).toBeNull()

    // MATCHED's own cleared block is not a contact-match stop: untouched.
    const own = await find(OWN)
    expect(own).toMatchObject({ clearStatus: 'cleared', clearedBy: 'ops-7' })
    expect(own?.clearRevokeStatus ?? null).toBeNull()
    expect(own?.revokedClearAt ?? null).toBeNull()
  })

  it('a refused undo is kept on the conversation and reads back through Payload', async () => {
    await pool.query(
      `UPDATE conversations
          SET reapplication_block_clear_revoke_status = 'rejected',
              reapplication_block_clear_revoke_request_id = 'req-undo-2',
              reapplication_block_clear_revoke_rejection = 'NOT_CLEARED: no clear in effect'
        WHERE conversation_id = $1 AND (${IS_CONTACT_MATCH_STOP})`,
      [STOPPED],
    )
    const { docs } = await payload.find({
      collection: 'conversations',
      where: { conversationId: { equals: STOPPED } },
      depth: 0,
    })
    expect(docs[0].reapplicationBlock).toMatchObject({
      clearRevokeStatus: 'rejected',
      clearRevokeRequestId: 'req-undo-2',
      clearRevokeRejection: 'NOT_CLEARED: no clear in effect',
    })
  })
})
