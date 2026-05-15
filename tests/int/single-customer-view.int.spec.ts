/**
 * Integration tests for the Single Customer View — TEMPORARILY DISABLED.
 *
 * The original tests (12 cases for the customer 360° page) seeded MongoDB
 * directly via `MongoClient`. Pending re-port against Payload Local API +
 * the testcontainer Postgres — see tests/int/servicing-app.int.spec.ts for
 * the wider story.
 */

import { describe, it } from 'vitest'

describe.skip('Single Customer View Integration Tests (pending Postgres port)', () => {
  it('see git history pre-cleanup for the original 12-case Mongo-seeded suite', () => {})
})
