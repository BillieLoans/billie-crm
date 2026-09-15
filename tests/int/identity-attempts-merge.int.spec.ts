/**
 * Order independence of the per-attempt identity verification merges
 * (billieChat spec 2026-09-15) — proven against a REAL Postgres.
 *
 * The event-processor merges two events into one entry of
 * `conversations.identity_verification_attempts` (keyed by LAB request id):
 * `identity_verification.attempt.v1` and
 * `identity_verification.report.archived.v1`. Two prod machines consume the
 * inbox concurrently, so either can land first. Both go through
 * `db.merge_jsonb_entry`, whose SQL is pinned VERBATIM below and in
 * `event-processor/tests/test_db_merge_jsonb_entry.py` — change one, change
 * the other. The Python unit tests cannot evaluate jsonb; this one does.
 */
import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest'
import { Client } from 'pg'

/** Exact text emitted by merge_jsonb_entry(conversations, identity_verification_attempts, conversation_id, bump_version=True). */
const MERGE_SQL =
  "UPDATE conversations SET identity_verification_attempts = jsonb_set(COALESCE(identity_verification_attempts, '{}'::jsonb), " +
  "ARRAY[$1::text], COALESCE(identity_verification_attempts -> $1, '{}'::jsonb) || $2::jsonb, true), " +
  'updated_at = NOW(), version = COALESCE(version, 1) + 1 WHERE conversation_id = $3'

/** Same helper without the version bump — the archived handler's variant. */
const MERGE_SQL_NO_BUMP = MERGE_SQL.replace(', version = COALESCE(version, 1) + 1', '')

const ATTEMPT_PATCH = {
  attempt_number: 1,
  step_up: false,
  step_up_requested: true,
  document_types: ['DRIVERS_LICENCE'],
  decision: 'DECLINED',
  identity_verification_failed: true,
  screening_hit: false,
  pep_result: 'no-match',
  sanctions_result: 'no-match',
  lab_verification: { requestId: '60000650', overallResult: 'Failed' },
  lab_request_id: '60000650',
  checked_at: '2026-09-15T00:00:00+00:00',
}

const ARCHIVED_PATCH = {
  report_file_location: 's3://b/86332415-5F3/IdentityVerification/verification_report_60000650.pdf',
  report_file_name: 'verification_report_60000650.pdf',
  raw_response_file_location: 's3://b/86332415-5F3/IdentityVerification/verify_response_60000650.json',
  raw_response_file_name: 'verify_response_60000650.json',
  archived_at: '2026-09-15T00:00:05+00:00',
  attempt_number: 1,
  step_up: false,
}

const KEY = '60000650'

describe('identity_verification_attempts merge (real Postgres)', () => {
  let client: Client
  const conversationIds: string[] = []

  const seed = async (conversationId: string) => {
    conversationIds.push(conversationId)
    // Mirrors event-processor _ensure_conversation_exists.
    await client.query(
      `INSERT INTO conversations
         (conversation_id, customer_id_string, application_number, status,
          started_at, updated_at, created_at, version)
       VALUES ($1, $2, $3, 'active', NOW(), NOW(), NOW(), 1)
       ON CONFLICT (conversation_id) DO NOTHING`,
      [conversationId, 'CUST-MERGE', 'APP-MERGE'],
    )
  }

  const read = async (conversationId: string) => {
    const res = await client.query(
      'SELECT identity_verification_attempts AS attempts, version FROM conversations WHERE conversation_id = $1',
      [conversationId],
    )
    return res.rows[0] as { attempts: Record<string, Record<string, unknown>>; version: number }
  }

  beforeAll(async () => {
    client = new Client({ connectionString: inject('pgUri') })
    await client.connect()
  })

  afterAll(async () => {
    if (conversationIds.length) {
      await client.query('DELETE FROM conversations WHERE conversation_id = ANY($1::text[])', [
        conversationIds,
      ])
    }
    await client.end()
  })

  it('attempt then archived yields one entry with both sets of fields', async () => {
    await seed('conv-merge-a')
    await client.query(MERGE_SQL, [KEY, JSON.stringify(ATTEMPT_PATCH), 'conv-merge-a'])
    await client.query(MERGE_SQL_NO_BUMP, [KEY, JSON.stringify(ARCHIVED_PATCH), 'conv-merge-a'])
    const { attempts, version } = await read('conv-merge-a')
    expect(Object.keys(attempts)).toEqual([KEY])
    expect(attempts[KEY]).toEqual({ ...ATTEMPT_PATCH, ...ARCHIVED_PATCH })
    expect(Number(version)).toBe(2)
  })

  it('archived BEFORE attempt yields the identical entry (cross-machine reorder)', async () => {
    await seed('conv-merge-b')
    await client.query(MERGE_SQL_NO_BUMP, [KEY, JSON.stringify(ARCHIVED_PATCH), 'conv-merge-b'])
    await client.query(MERGE_SQL, [KEY, JSON.stringify(ATTEMPT_PATCH), 'conv-merge-b'])
    const { attempts } = await read('conv-merge-b')
    expect(attempts[KEY]).toEqual({ ...ATTEMPT_PATCH, ...ARCHIVED_PATCH })
  })

  it('a second attempt lands under its own key without touching the first', async () => {
    await seed('conv-merge-c')
    await client.query(MERGE_SQL, [KEY, JSON.stringify(ATTEMPT_PATCH), 'conv-merge-c'])
    await client.query(MERGE_SQL_NO_BUMP, [KEY, JSON.stringify(ARCHIVED_PATCH), 'conv-merge-c'])
    const second = { ...ATTEMPT_PATCH, attempt_number: 2, step_up: true, decision: 'APPROVED', lab_request_id: '60000651' }
    await client.query(MERGE_SQL, ['60000651', JSON.stringify(second), 'conv-merge-c'])
    const { attempts } = await read('conv-merge-c')
    expect(Object.keys(attempts).sort()).toEqual(['60000650', '60000651'])
    expect(attempts['60000650']).toEqual({ ...ATTEMPT_PATCH, ...ARCHIVED_PATCH })
    expect(attempts['60000651']).toEqual(second)
  })

  it('replaying the same event is idempotent', async () => {
    await seed('conv-merge-d')
    await client.query(MERGE_SQL, [KEY, JSON.stringify(ATTEMPT_PATCH), 'conv-merge-d'])
    await client.query(MERGE_SQL, [KEY, JSON.stringify(ATTEMPT_PATCH), 'conv-merge-d'])
    const { attempts } = await read('conv-merge-d')
    expect(attempts[KEY]).toEqual(ATTEMPT_PATCH)
  })
})
