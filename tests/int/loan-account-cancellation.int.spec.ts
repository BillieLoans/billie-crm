/**
 * The schema behind a loan cancelled before disbursement (BTB-517).
 *
 * The event processor writes `account_status = 'cancelled'`, the
 * `cancellation_*` columns and a `void` instalment status straight into
 * Postgres (event-processor handle_account_cancelled). The Payload schema must
 * produce exactly those names, and the migration that deployed environments
 * run must produce them too, so this checks both against a real database:
 * the columns and enum values the Payload schema push created, a Payload
 * round trip through the `cancellation` group, the migration's SQL
 * (idempotent: it is applied on top of the pushed schema), and what the
 * reporting view shows of a cancelled loan.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { getDashboardPool, type QueryablePool } from '@/lib/dashboard-aggregates'
import { up as migrateUp } from '@/migrations/20261103_090000_loan_account_cancellation'

let payload: Payload
let pool: QueryablePool

const PREFIX = 'CANCELSCHEMA'

async function reset() {
  await pool.query(
    `DELETE FROM loan_accounts_repayment_schedule_payments
      WHERE _parent_id IN (SELECT id FROM loan_accounts WHERE loan_account_id LIKE $1)`,
    [`${PREFIX}%`],
  )
  await pool.query('DELETE FROM loan_accounts WHERE loan_account_id LIKE $1', [`${PREFIX}%`])
}

beforeAll(async () => {
  payload = await getPayload({ config })
  const p = getDashboardPool(payload)
  if (!p) throw new Error('Postgres pool not available')
  pool = p
})

beforeEach(reset)
afterAll(reset)

const CANCELLATION_COLUMNS = {
  cancellation_reason: 'character varying',
  cancellation_note: 'character varying',
  cancellation_evidence_ref: 'character varying',
  cancellation_cancelled_by_id: 'character varying',
  cancellation_cancelled_by_name: 'character varying',
  cancellation_cancelled_at: 'timestamp with time zone',
}

const enumValues = async (name: string): Promise<string[]> => {
  const { rows } = await pool.query(
    `SELECT e.enumlabel
       FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = $1
      ORDER BY e.enumsortorder`,
    [name],
  )
  return rows.map((r) => r.enumlabel as string)
}

describe('loan account cancellation schema', () => {
  it('creates the columns the event processor writes, with those names', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'loan_accounts' AND column_name LIKE 'cancellation\\_%'`,
    )
    const actual = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]))
    expect(actual).toEqual(CANCELLATION_COLUMNS)
  })

  it("adds 'cancelled' to the account status and 'void' to the instalment status", async () => {
    expect(await enumValues('enum_loan_accounts_account_status')).toContain('cancelled')
    expect(await enumValues('enum_loan_accounts_repayment_schedule_payments_status')).toContain(
      'void',
    )
  })

  it('round-trips the cancellation group through the column names the processor writes', async () => {
    await payload.create({
      collection: 'loan-accounts',
      data: {
        loanAccountId: `${PREFIX}-RT`,
        accountNumber: 'ACC-RT',
        accountStatus: 'cancelled',
        cancellation: {
          reason: 'mutual_cancellation',
          note: 'Customer and supervisor agreed to cancel before disbursement.',
          evidenceRef: 'email-2026-10-29-agreement',
          cancelledById: 'usr-supervisor-1',
          cancelledByName: 'Sam Supervisor',
          cancelledAt: '2026-10-30T04:45:00.000Z',
        },
      },
    })

    const { rows } = await pool.query(
      `SELECT account_status::text AS account_status,
              cancellation_reason, cancellation_note, cancellation_evidence_ref,
              cancellation_cancelled_by_id, cancellation_cancelled_by_name,
              cancellation_cancelled_at
         FROM loan_accounts WHERE loan_account_id = $1`,
      [`${PREFIX}-RT`],
    )
    expect(rows[0]).toMatchObject({
      account_status: 'cancelled',
      cancellation_reason: 'mutual_cancellation',
      cancellation_note: 'Customer and supervisor agreed to cancel before disbursement.',
      cancellation_evidence_ref: 'email-2026-10-29-agreement',
      cancellation_cancelled_by_id: 'usr-supervisor-1',
      cancellation_cancelled_by_name: 'Sam Supervisor',
    })
    expect(new Date(rows[0].cancellation_cancelled_at as string).toISOString()).toBe(
      '2026-10-30T04:45:00.000Z',
    )
  })

  it('accepts the raw lower-case reason code the processor writes, not only known ones', async () => {
    // `reason` is plain text, so a code added on the platform later can never
    // hit an enum mismatch in the processor's raw UPDATE.
    await pool.query(
      `INSERT INTO loan_accounts (loan_account_id, account_number, account_status, cancellation_reason)
       VALUES ($1, 'ACC-RAW', 'cancelled', 'some_future_reason_code')`,
      [`${PREFIX}-RAW`],
    )
    const { rows } = await pool.query(
      'SELECT cancellation_reason FROM loan_accounts WHERE loan_account_id = $1',
      [`${PREFIX}-RAW`],
    )
    expect(rows[0].cancellation_reason).toBe('some_future_reason_code')
  })

  it('stores a void instalment', async () => {
    const { rows: loan } = await pool.query(
      `INSERT INTO loan_accounts (loan_account_id, account_number, account_status)
       VALUES ($1, 'ACC-VOID', 'cancelled') RETURNING id`,
      [`${PREFIX}-VOID`],
    )
    await pool.query(
      `INSERT INTO loan_accounts_repayment_schedule_payments
         (id, _order, _parent_id, payment_number, status)
       VALUES ($1, 1, $2, 1, 'void')`,
      [`${PREFIX}-pay-1`, loan[0].id],
    )
    const { rows } = await pool.query(
      `SELECT status FROM reporting.instalment WHERE loan_account_id = $1`,
      [`${PREFIX}-VOID`],
    )
    expect(rows).toEqual([{ status: 'void' }])
  })

  it('has a migration that applies cleanly on top of the pushed schema, twice', async () => {
    const args = { db: (payload.db as any).drizzle, payload, req: {} } as any
    await migrateUp(args)
    await migrateUp(args)

    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'loan_accounts' AND column_name LIKE 'cancellation\\_%'`,
    )
    expect(rows.map((r) => r.column_name).sort()).toEqual(Object.keys(CANCELLATION_COLUMNS).sort())
    expect(await enumValues('enum_loan_accounts_account_status')).toContain('cancelled')
  })
})

describe('reporting.loan for a cancelled loan', () => {
  it('shows the reason code and when, and nothing a person wrote', async () => {
    await pool.query(
      `INSERT INTO loan_accounts
         (loan_account_id, account_number, account_status, cancellation_reason, cancellation_note,
          cancellation_evidence_ref, cancellation_cancelled_by_id, cancellation_cancelled_by_name,
          cancellation_cancelled_at)
       VALUES ($1, 'ACC-VIEW', 'cancelled', 'customer_withdrew',
               'Said she is moving to Perth and no longer needs it',
               'ref-1', 'usr-1', 'Sam Supervisor', '2026-10-30T22:30:00Z')`,
      [`${PREFIX}-VIEW`],
    )

    const { rows } = await pool.query(`SELECT * FROM reporting.loan WHERE loan_account_id = $1`, [
      `${PREFIX}-VIEW`,
    ])
    expect(rows[0]).toMatchObject({
      account_status: 'cancelled',
      cancellation_reason: 'customer_withdrew',
    })
    expect(new Date(rows[0].cancelled_at as string).toISOString()).toBe('2026-10-30T22:30:00.000Z')
    // 22:30Z on 30 Oct is the morning of 31 Oct in Sydney.
    expect(
      (
        await pool.query(
          `SELECT cancelled_on::text AS d FROM reporting.loan WHERE loan_account_id = $1`,
          [`${PREFIX}-VIEW`],
        )
      ).rows[0].d,
    ).toBe('2026-10-31')

    // Reports carry ids, categories and dates, never free text or names.
    const everything = JSON.stringify(rows[0])
    expect(everything).not.toContain('Perth')
    expect(everything).not.toContain('Sam Supervisor')
    expect(everything).not.toContain('ref-1')
    expect(Object.keys(rows[0])).not.toEqual(
      expect.arrayContaining(['cancellation_note', 'cancellation_cancelled_by_name']),
    )
  })
})
