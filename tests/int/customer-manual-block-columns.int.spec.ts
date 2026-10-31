/**
 * The customers columns the event processor writes for the CRM's manual block
 * (BTB-517), checked against the real schema Payload builds.
 *
 * handlers/reapplication.py writes these by name. Payload derives them from the
 * `reapplicationBlock` group, so a renamed field would silently break the
 * processor's upsert; this pins the names on both sides.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { getDashboardPool, type QueryablePool } from '@/lib/dashboard-aggregates'
import { up as migrateUp } from '@/migrations/20261104_090000_customer_manual_block'

const CUSTOMER = 'MANUALBLK-CUS'
const COLUMNS = [
  'reapplication_block_manual_block_request_id',
  'reapplication_block_manual_set_reason_code',
  'reapplication_block_manual_set_rejected_request_id',
  'reapplication_block_manual_set_rejection',
  'reapplication_block_manual_set_request_id',
]

let payload: Payload
let pool: QueryablePool

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as QueryablePool
  await pool.query(`DELETE FROM customers WHERE customer_id = $1`, [CUSTOMER])
})

afterAll(async () => {
  await pool.query(`DELETE FROM customers WHERE customer_id = $1`, [CUSTOMER])
})

describe('customers manual block columns (BTB-517)', () => {
  it('exist as text columns with the names the processor writes', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'customers' AND column_name = ANY($1::text[])
        ORDER BY column_name`,
      [COLUMNS],
    )
    expect(rows).toEqual(
      COLUMNS.map((column_name) => ({ column_name, data_type: 'character varying' })),
    )
  })

  it('read back through Payload as the reapplicationBlock group fields', async () => {
    await pool.query(
      `INSERT INTO customers (customer_id, reapplication_block_reason,
          reapplication_block_manual_block_request_id, reapplication_block_manual_set_request_id,
          reapplication_block_manual_set_reason_code, reapplication_block_manual_set_rejected_request_id,
          reapplication_block_manual_set_rejection)
       VALUES ($1, 'MANUAL_ADMIN', 'req-1', 'req-1', 'fraud_hold', 'req-0', 'INVALID_EXPIRY: bad date')`,
      [CUSTOMER],
    )
    const { docs } = await payload.find({
      collection: 'customers',
      where: { customerId: { equals: CUSTOMER } },
      depth: 0,
    })
    expect(docs[0].reapplicationBlock).toMatchObject({
      reason: 'MANUAL_ADMIN',
      manualBlockRequestId: 'req-1',
      manualSetRequestId: 'req-1',
      manualSetReasonCode: 'fraud_hold',
      manualSetRejectedRequestId: 'req-0',
      manualSetRejection: 'INVALID_EXPIRY: bad date',
    })
  })

  it('has a migration that applies cleanly on top of the pushed schema, twice', async () => {
    const args = { db: (payload.db as any).drizzle, payload, req: {} } as any
    await migrateUp(args)
    await migrateUp(args)
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'customers' AND column_name LIKE 'reapplication\\_block\\_manual\\_%'
        ORDER BY column_name`,
    )
    expect(rows.map((r) => r.column_name)).toEqual(COLUMNS)
  })
})
