/**
 * The columns behind account event ordering (BTB-537).
 *
 * The event processor writes the highest `account_version` it has applied
 * straight into `loan_accounts.account_state_version` and
 * `loan_accounts.account_schedule_version` (event-processor
 * handlers/account.py), and compares against them inside its UPDATE. The
 * Payload schema must produce exactly those names, and the migration that
 * deployed environments run must produce them too, so this checks both
 * against a real database, plus the guard itself: the statement
 * `db.update_by_key(..., version_column=...)` builds, run as the processor
 * runs it.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { getDashboardPool, type QueryablePool } from '@/lib/dashboard-aggregates'
import { up as migrateUp } from '@/migrations/20261111_090000_loan_account_event_versions'

let payload: Payload
let pool: QueryablePool

const PREFIX = 'EVENTVERSION'

async function reset() {
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

const VERSION_COLUMNS = {
  account_state_version: 'numeric',
  account_schedule_version: 'numeric',
}

const versionColumns = async (): Promise<Record<string, string>> => {
  const { rows } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'loan_accounts'
        AND column_name IN ('account_state_version', 'account_schedule_version')`,
  )
  return Object.fromEntries(rows.map((r) => [r.column_name as string, r.data_type as string]))
}

/**
 * The UPDATE `update_by_key(values={sdk_status, application_number,
 * account_state_version}, version_column='account_state_version')` sends.
 * event-processor/tests/test_account_version_ordering.py pins the text.
 */
const GUARDED_UPDATE = `
  UPDATE loan_accounts SET
    sdk_status = CASE WHEN account_state_version > $3
      THEN COALESCE(sdk_status, $1) ELSE $1 END,
    application_number = CASE WHEN account_state_version > $3
      THEN COALESCE(application_number, $2) ELSE $2 END,
    account_state_version = GREATEST(account_state_version, $3)
  WHERE loan_account_id = $4`

describe('loan account event version columns', () => {
  it('creates the columns the event processor writes, with those names', async () => {
    expect(await versionColumns()).toEqual(VERSION_COLUMNS)
  })

  it('round-trips both versions through the column names the processor writes', async () => {
    await payload.create({
      collection: 'loan-accounts',
      data: {
        loanAccountId: `${PREFIX}-RT`,
        accountNumber: 'ACC-RT',
        accountStatus: 'active',
        accountStateVersion: 5,
        accountScheduleVersion: 6,
      },
    })

    const { rows } = await pool.query(
      `SELECT account_state_version::int AS state, account_schedule_version::int AS schedule
         FROM loan_accounts WHERE loan_account_id = $1`,
      [`${PREFIX}-RT`],
    )
    expect(rows[0]).toEqual({ state: 5, schedule: 6 })
  })

  it('has a migration that applies cleanly on top of the pushed schema, twice', async () => {
    const args = { db: payload.db.drizzle, payload, req: {} } as unknown as Parameters<
      typeof migrateUp
    >[0]
    await migrateUp(args)
    await migrateUp(args)

    expect(await versionColumns()).toEqual(VERSION_COLUMNS)
  })
})

describe("the event processor's version guard", () => {
  const seed = async (id: string, stateVersion: number | null, scheduleVersion: number | null) => {
    await pool.query(
      `INSERT INTO loan_accounts
         (loan_account_id, account_number, account_status, sdk_status,
          account_state_version, account_schedule_version)
       VALUES ($1, 'ACC-GUARD', 'active', 'ACTIVE', $2, $3)`,
      [id, stateVersion, scheduleVersion],
    )
  }

  const apply = async (id: string, version: number) => {
    await pool.query(GUARDED_UPDATE, ['SUSPENDED', 'APP-FROM-EVENT', version, id])
    const { rows } = await pool.query(
      `SELECT sdk_status, application_number, account_state_version::int AS state,
              account_schedule_version::int AS schedule
         FROM loan_accounts WHERE loan_account_id = $1`,
      [id],
    )
    return rows[0]
  }

  it('applies a newer event and stores its version', async () => {
    await seed(`${PREFIX}-NEWER`, 5, null)
    expect(await apply(`${PREFIX}-NEWER`, 6)).toMatchObject({
      sdk_status: 'SUSPENDED',
      application_number: 'APP-FROM-EVENT',
      state: 6,
    })
  })

  it('keeps what an older event would overwrite, and fills what is empty', async () => {
    await seed(`${PREFIX}-OLDER`, 5, null)
    expect(await apply(`${PREFIX}-OLDER`, 3)).toMatchObject({
      sdk_status: 'ACTIVE',
      application_number: 'APP-FROM-EVENT',
      state: 5,
    })
  })

  it('re-applies an event with the same version', async () => {
    await seed(`${PREFIX}-EQUAL`, 5, null)
    expect(await apply(`${PREFIX}-EQUAL`, 5)).toMatchObject({ sdk_status: 'SUSPENDED', state: 5 })
  })

  it('applies to a row with no stored version, and stores it', async () => {
    await seed(`${PREFIX}-FIRST`, null, null)
    expect(await apply(`${PREFIX}-FIRST`, 4)).toMatchObject({ sdk_status: 'SUSPENDED', state: 4 })
  })

  it('is not blocked by a higher schedule version, and leaves it alone', async () => {
    await seed(`${PREFIX}-FAMILY`, 4, 6)
    expect(await apply(`${PREFIX}-FAMILY`, 5)).toMatchObject({
      sdk_status: 'SUSPENDED',
      state: 5,
      schedule: 6,
    })
  })
})
