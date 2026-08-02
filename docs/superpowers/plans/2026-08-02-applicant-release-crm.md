# Applicant Release — billie-crm Control Plane Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the billie-crm half of the batch applicant release feature: event contracts and publishers, the three read-only projections with Python handlers, the release/preflight/revoke API routes, React Query hooks, and the Releases tab in the marketing view.

**Architecture:** A CRM-mastered "applicant release" domain following the write-off command pattern — routes resolve targets from local projections at command time, dual-publish `applicant_release.*` commands to `chatLedger` (for billieChat) and the internal stream (for the CRM's own projection), and the Python event processor materialises `release_batches` / `release_grants` / `release_gate_status` for the UI.

**Tech Stack:** Payload CMS v3 (Next.js 15), TypeScript, Zod v4, TanStack React Query, ioredis, Python 3.12 + asyncpg (event-processor), vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-08-02-batch-applicant-release-design.md`

## Global Constraints

- Repo: `/Users/rohansharp/workspace/billie-crm`, branch `feat/batch-applicant-release` (already exists — verify with `git rev-parse --abbrev-ref HEAD` before starting; Rohan switches branches mid-session, so re-check before every commit).
- Prettier: single quotes, no semicolons, trailing commas, 100-char width. en-AU formatting via `src/lib/formatters.ts`.
- Node tests: `pnpm exec vitest run <file> --config ./vitest.config.mts` (jsdom, sequential). UI component tests MUST mock `@payloadcms/ui` (`vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: null }) }))`) or the react-image-crop CSS import fails collection.
- Python tests: `cd event-processor && python -m pytest tests/test_applicant_release_handlers.py -v` (asyncio_mode=auto, `mock_pool` fixture).
- Event types (verbatim): `applicant_release.released.v1`, `.revoked.v1`, `.gate_mode.set.v1` (outbound commands, `cls: 'cmd'` on chatLedger, `cls: 'msg'` on the internal stream); `.grant_claimed.v1`, `.invites_sent.v1`, `.gate_mode.changed.v1` (inbound facts).
- Streams: `CHATLEDGER_STREAM` (`chatLedger`) outbound to billieChat; `REDIS_PUBLISH_STREAM` (`inbox:billie-servicing:internal`) for own projection; facts arrive on `REDIS_EXTERNAL_STREAM` (`inbox:billie-servicing`) — no processor stream changes needed.
- Wire payloads are snake_case (matches the billieChat Pydantic models in the companion plan). `conv` = `applicant-release:{releaseId}` for release-scoped events; `applicant-release:gate` for gate-mode events.
- Release types: `waitlist` | `phone_list` | `open_quota`. Grant statuses: `granted` | `claimed` | `expired` | `revoked`. Phone-list cap: 1,000 numbers. Expiry: 1–90 days, default 14.
- Access: writes `canMarketing`, reads `canReadMarketing` (from `src/lib/access.ts`). Collections: `group: 'Marketing'`, `hidden: hideFromNonAdmins`, `create/update/delete: () => false`.
- After collection changes: `pnpm generate:types`. Schema change ships as a committed Payload migration via the local-Docker recipe (see `~/.claude` memory `payload-migration-local-recipe`: throwaway local Postgres, branch off latest main so `migrate:create` doesn't drop others' migrations).
- Companion plan (billieChat half): `docs/superpowers/plans/2026-08-02-applicant-release-billiechat.md`.

---

### Task 1: Event types, payload types, command schemas, mobile normalisation fix

**Files:**
- Modify: `src/lib/events/config.ts`, `src/lib/events/types.ts`, `src/lib/marketing.ts`
- Create: `src/lib/schemas/releases.ts`
- Test: `tests/unit/lib/releaseSchemas.test.ts`, extend `tests/unit/lib/` mobile tests (find the existing `normaliseAuMobile` test file with `rg -l "normaliseAuMobile" tests/`)

**Interfaces:**
- Produces (config.ts): `EVENT_TYPE_APPLICANT_RELEASE_RELEASED`, `_REVOKED`, `_GATE_MODE_SET`, `_GRANT_CLAIMED`, `_INVITES_SENT`, `_GATE_MODE_CHANGED` (env-overridable, defaults = the verbatim names); `RELEASE_TYPES = ['waitlist', 'phone_list', 'open_quota'] as const`; `ReleaseType` type alias.
- Produces (types.ts): `ApplicantReleaseGrantSpec { mobile_e164: string; contact_id: string | null; send_sms: boolean }`, `ApplicantReleaseReleasedPayload { release_id; name; type: ReleaseType; expires_at; send_invite_sms; grants: ApplicantReleaseGrantSpec[]; quota_count: number | null; released_by }`, `ApplicantReleaseRevokedPayload { release_id; revoked_by; reason?: string }`, `ApplicantReleaseGateModeSetPayload { mode: 'open' | 'gated'; set_by; reason?: string }`.
- Produces (schemas): `CreateReleaseCommandSchema` (input: `releaseId` min 8, `name` 1–200, `type`, `count` int ≥1 (waitlist/open_quota), `mobiles` string[] 1–1000 (phone_list), `expiryDays` int 1–90 default 14, `sendInviteSms` boolean default false — cross-field refined), `RevokeReleaseCommandSchema { reason?: string }`.
- Produces (marketing.ts): `normaliseAuMobile` additionally accepts bare `4XXXXXXXX` (9 digits starting with 4) — aligning with the Python variant per spec §7.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/lib/releaseSchemas.test.ts
import { describe, test, expect } from 'vitest'
import { CreateReleaseCommandSchema } from '@/lib/schemas/releases'
import { normaliseAuMobile } from '@/lib/marketing'

const base = { releaseId: 'rel_12345678', name: 'August wave 3', expiryDays: 14, sendInviteSms: false }

describe('CreateReleaseCommandSchema', () => {
  test('waitlist requires count, forbids mobiles', () => {
    expect(CreateReleaseCommandSchema.safeParse({ ...base, type: 'waitlist', count: 150 }).success).toBe(true)
    expect(CreateReleaseCommandSchema.safeParse({ ...base, type: 'waitlist' }).success).toBe(false)
    expect(
      CreateReleaseCommandSchema.safeParse({ ...base, type: 'waitlist', count: 1, mobiles: ['0400000001'] }).success,
    ).toBe(false)
  })

  test('phone_list requires mobiles, caps at 1000', () => {
    expect(
      CreateReleaseCommandSchema.safeParse({ ...base, type: 'phone_list', mobiles: ['0400 000 001'] }).success,
    ).toBe(true)
    expect(CreateReleaseCommandSchema.safeParse({ ...base, type: 'phone_list' }).success).toBe(false)
    const tooMany = Array.from({ length: 1001 }, (_, i) => `04000${String(i).padStart(5, '0')}`)
    expect(
      CreateReleaseCommandSchema.safeParse({ ...base, type: 'phone_list', mobiles: tooMany }).success,
    ).toBe(false)
  })

  test('open_quota requires count and forces sendInviteSms off', () => {
    const parsed = CreateReleaseCommandSchema.safeParse({
      ...base, type: 'open_quota', count: 150, sendInviteSms: true,
    })
    expect(parsed.success).toBe(false) // SMS with no recipients is a contradiction
    expect(
      CreateReleaseCommandSchema.safeParse({ ...base, type: 'open_quota', count: 150 }).success,
    ).toBe(true)
  })

  test('expiryDays bounds and default', () => {
    expect(CreateReleaseCommandSchema.parse({ ...base, type: 'waitlist', count: 1, expiryDays: undefined }).expiryDays).toBe(14)
    expect(CreateReleaseCommandSchema.safeParse({ ...base, type: 'waitlist', count: 1, expiryDays: 0 }).success).toBe(false)
    expect(CreateReleaseCommandSchema.safeParse({ ...base, type: 'waitlist', count: 1, expiryDays: 91 }).success).toBe(false)
  })
})

describe('normaliseAuMobile bare-4 alignment (spec §7)', () => {
  test('accepts bare 4XXXXXXXX like the Python variant', () => {
    expect(normaliseAuMobile('400000001')).toBe('+61400000001')
  })
  test('existing forms unchanged', () => {
    expect(normaliseAuMobile('0400 000 001')).toBe('+61400000001')
    expect(normaliseAuMobile('+61400000001')).toBe('+61400000001')
    expect(normaliseAuMobile('61400000001')).toBe('+61400000001')
    expect(normaliseAuMobile('12345')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/unit/lib/releaseSchemas.test.ts --config ./vitest.config.mts`
Expected: FAIL (module not found / bare-4 returns null).

- [ ] **Step 3: Implement**

In `src/lib/events/config.ts` (after the write-off block, same style):

```ts
// Applicant release (spec 2026-08-02) — CRM-mastered entry-gate commands
export const EVENT_TYPE_APPLICANT_RELEASE_RELEASED =
  process.env.EVENT_TYPE_APPLICANT_RELEASE_RELEASED ?? 'applicant_release.released.v1'
export const EVENT_TYPE_APPLICANT_RELEASE_REVOKED =
  process.env.EVENT_TYPE_APPLICANT_RELEASE_REVOKED ?? 'applicant_release.revoked.v1'
export const EVENT_TYPE_APPLICANT_RELEASE_GATE_MODE_SET =
  process.env.EVENT_TYPE_APPLICANT_RELEASE_GATE_MODE_SET ?? 'applicant_release.gate_mode.set.v1'
export const EVENT_TYPE_APPLICANT_RELEASE_GRANT_CLAIMED =
  process.env.EVENT_TYPE_APPLICANT_RELEASE_GRANT_CLAIMED ?? 'applicant_release.grant_claimed.v1'
export const EVENT_TYPE_APPLICANT_RELEASE_INVITES_SENT =
  process.env.EVENT_TYPE_APPLICANT_RELEASE_INVITES_SENT ?? 'applicant_release.invites_sent.v1'
export const EVENT_TYPE_APPLICANT_RELEASE_GATE_MODE_CHANGED =
  process.env.EVENT_TYPE_APPLICANT_RELEASE_GATE_MODE_CHANGED ??
  'applicant_release.gate_mode.changed.v1'

export const RELEASE_TYPES = ['waitlist', 'phone_list', 'open_quota'] as const
export type ReleaseType = (typeof RELEASE_TYPES)[number]
```

In `src/lib/events/types.ts`:

```ts
// ---- Applicant release ------------------------------------------------------

import type { ReleaseType } from './config'

export interface ApplicantReleaseGrantSpec {
  mobile_e164: string
  contact_id: string | null
  send_sms: boolean
}

export interface ApplicantReleaseReleasedPayload {
  release_id: string
  name: string
  type: ReleaseType
  expires_at: string
  send_invite_sms: boolean
  grants: ApplicantReleaseGrantSpec[]
  quota_count: number | null
  released_by: string
}

export interface ApplicantReleaseRevokedPayload {
  release_id: string
  revoked_by: string
  reason?: string
}

export interface ApplicantReleaseGateModeSetPayload {
  mode: 'open' | 'gated'
  set_by: string
  reason?: string
}
```

(If `types.ts` already imports from `./config`, merge into the existing import.)

Create `src/lib/schemas/releases.ts`:

```ts
import { z } from 'zod'
import { RELEASE_TYPES } from '@/lib/events/config'

/**
 * Staff command to release a batch of applicants (spec §5). releaseId is
 * minted client-side (nanoid) so retries are idempotent end-to-end.
 */
export const CreateReleaseCommandSchema = z
  .object({
    releaseId: z.string().min(8),
    name: z.string().min(1).max(200),
    type: z.enum(RELEASE_TYPES),
    count: z.number().int().min(1).optional(),
    mobiles: z.array(z.string().min(1)).min(1).max(1000).optional(),
    expiryDays: z.number().int().min(1).max(90).default(14),
    sendInviteSms: z.boolean().default(false),
  })
  .refine((d) => (d.type === 'phone_list' ? !!d.mobiles : d.count !== undefined), {
    message: 'waitlist/open_quota need count; phone_list needs mobiles',
    path: ['count'],
  })
  .refine((d) => !(d.type !== 'phone_list' && d.mobiles), {
    message: 'mobiles only applies to phone_list releases',
    path: ['mobiles'],
  })
  .refine((d) => !(d.type === 'open_quota' && d.sendInviteSms), {
    message: 'An open quota has no recipients to SMS',
    path: ['sendInviteSms'],
  })
export type CreateReleaseCommand = z.infer<typeof CreateReleaseCommandSchema>

export const RevokeReleaseCommandSchema = z.object({
  reason: z.string().max(500).optional(),
})
export type RevokeReleaseCommand = z.infer<typeof RevokeReleaseCommandSchema>
```

In `src/lib/marketing.ts`, extend `normaliseAuMobile` — add one branch before the final `return null`:

```ts
  else if (digits.startsWith('4') && digits.length === 9) candidate = `+61${digits}`
```

(The full function then reads: `+` prefix → as-is; `61…` → `+`; `0…` 10 digits → `+61` + slice(1); `4…` 9 digits → `+61` + digits; else null — matching `event-processor` `clicksend.py:36-51`.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/unit/lib/releaseSchemas.test.ts --config ./vitest.config.mts`
Expected: PASS. Also run the existing marketing-lib tests to confirm no regression: `pnpm exec vitest run -t "normaliseAuMobile" --config ./vitest.config.mts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/events/config.ts src/lib/events/types.ts src/lib/schemas/releases.ts src/lib/marketing.ts tests/unit/lib/releaseSchemas.test.ts
git commit -m "feat(releases): event contracts, command schemas, bare-4 mobile normalisation"
```

---

### Task 2: Projections — collections, natural key, migration

**Files:**
- Create: `src/collections/ReleaseBatches.ts`, `src/collections/ReleaseGrants.ts`, `src/collections/ReleaseGateStatus.ts`
- Modify: `src/payload.config.ts` (imports, collections array, `afterSchemaInit`)
- Create: `src/migrations/<timestamp>_applicant_release.ts` (generated)
- Test: `tests/int/release-collections.int.spec.ts`

**Interfaces:**
- Produces collection slugs `release-batches`, `release-grants`, `release-gate-status` and their generated types `ReleaseBatch`, `ReleaseGrant`, `ReleaseGateStatus` in `src/payload-types.ts`.
- SQL tables (used verbatim by Task 3 handlers): `release_batches` (`release_id` unique, `name`, `type`, `status`, `quota_count`, `expires_at`, `send_invite_sms`, `granted_count`, `claimed_count`, `sms_sent_count`, `sms_failed_count`, `skipped_already_customer`, `skipped_invalid_number`, `skipped_already_released`, `skipped_needs_review`, `created_by_actor`, `released_at`, `revoked_by`, `revoked_at`); `release_grants` (`release_id`, `mobile_e164`, `contact_id`, `source`, `status`, `sms_status`, `claimed_at`; composite unique `(release_id, mobile_e164)` named `release_grants_natural_key_idx`); `release_gate_status` (`gate_id` unique, `mode`, `set_by`, `changed_at`).

- [ ] **Step 1: Write the collections**

```ts
// src/collections/ReleaseBatches.ts
import type { CollectionConfig, Access } from 'payload'
import { canReadMarketing, hideFromNonAdmins } from '@/lib/access'

const marketingRead: Access = ({ req: { user } }) => canReadMarketing(user)

export const ReleaseBatches: CollectionConfig = {
  slug: 'release-batches',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'releaseId', 'type', 'status', 'releasedAt'],
    group: 'Marketing',
    hidden: hideFromNonAdmins,
    description: 'Applicant release batches — read-only projection of applicant_release events',
  },
  access: {
    read: marketingRead,
    create: () => false, // Only written by the event processor
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'releaseId', type: 'text', required: true, unique: true, admin: { readOnly: true } },
    { name: 'name', type: 'text', admin: { readOnly: true } },
    {
      name: 'type',
      type: 'select',
      options: ['waitlist', 'phone_list', 'open_quota'],
      admin: { readOnly: true },
    },
    {
      name: 'status',
      type: 'select',
      options: ['active', 'revoked'],
      admin: { readOnly: true, description: 'Expired is derived from expiresAt at read time' },
    },
    { name: 'quotaCount', type: 'number', admin: { readOnly: true } },
    { name: 'expiresAt', type: 'date', admin: { readOnly: true } },
    { name: 'sendInviteSms', type: 'checkbox', admin: { readOnly: true } },
    { name: 'grantedCount', type: 'number', admin: { readOnly: true } },
    { name: 'claimedCount', type: 'number', admin: { readOnly: true } },
    { name: 'smsSentCount', type: 'number', admin: { readOnly: true } },
    { name: 'smsFailedCount', type: 'number', admin: { readOnly: true } },
    { name: 'skippedAlreadyCustomer', type: 'number', admin: { readOnly: true } },
    { name: 'skippedInvalidNumber', type: 'number', admin: { readOnly: true } },
    { name: 'skippedAlreadyReleased', type: 'number', admin: { readOnly: true } },
    { name: 'skippedNeedsReview', type: 'number', admin: { readOnly: true } },
    { name: 'createdByActor', type: 'text', admin: { readOnly: true } },
    { name: 'releasedAt', type: 'date', admin: { readOnly: true } },
    { name: 'revokedBy', type: 'text', admin: { readOnly: true } },
    { name: 'revokedAt', type: 'date', admin: { readOnly: true } },
  ],
  timestamps: true,
}
```

```ts
// src/collections/ReleaseGrants.ts
import type { CollectionConfig, Access } from 'payload'
import { canReadMarketing, hideFromNonAdmins } from '@/lib/access'

const marketingRead: Access = ({ req: { user } }) => canReadMarketing(user)

export const ReleaseGrants: CollectionConfig = {
  slug: 'release-grants',
  admin: {
    useAsTitle: 'mobileE164',
    defaultColumns: ['releaseId', 'mobileE164', 'status', 'claimedAt'],
    group: 'Marketing',
    hidden: hideFromNonAdmins,
    description: 'Per-person release grants — read-only projection, natural key (releaseId, mobileE164)',
  },
  access: {
    read: marketingRead,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'releaseId', type: 'text', required: true, index: true, admin: { readOnly: true } },
    { name: 'mobileE164', type: 'text', required: true, admin: { readOnly: true } },
    { name: 'contactId', type: 'text', index: true, admin: { readOnly: true } },
    {
      name: 'source',
      type: 'select',
      options: ['targeted', 'quota_claim'],
      admin: { readOnly: true },
    },
    {
      name: 'status',
      type: 'select',
      options: ['granted', 'claimed', 'expired', 'revoked'],
      admin: { readOnly: true },
    },
    {
      name: 'smsStatus',
      type: 'select',
      options: ['sent', 'failed', 'not_sent'],
      admin: { readOnly: true },
    },
    { name: 'claimedAt', type: 'date', admin: { readOnly: true } },
  ],
  timestamps: true,
}
```

```ts
// src/collections/ReleaseGateStatus.ts
import type { CollectionConfig, Access } from 'payload'
import { canReadMarketing, hideFromNonAdmins } from '@/lib/access'

const marketingRead: Access = ({ req: { user } }) => canReadMarketing(user)

export const ReleaseGateStatus: CollectionConfig = {
  slug: 'release-gate-status',
  admin: {
    group: 'Marketing',
    hidden: hideFromNonAdmins,
    description: 'Single-row projection of the billieChat application gate mode',
  },
  access: {
    read: marketingRead,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'gateId', type: 'text', required: true, unique: true, admin: { readOnly: true } },
    { name: 'mode', type: 'select', options: ['open', 'gated'], admin: { readOnly: true } },
    { name: 'setBy', type: 'text', admin: { readOnly: true } },
    { name: 'changedAt', type: 'date', admin: { readOnly: true } },
  ],
  timestamps: true,
}
```

Register in `src/payload.config.ts`: import the three and append to the collections array (after `Feedback`). In `afterSchemaInit`, after the collection-cases block, add:

```ts
        // Natural key for release grants — the Python processor upserts via
        // ON CONFLICT (release_id, mobile_e164) (spec §5).
        const releaseGrants = (schema.tables as Record<string, unknown>).release_grants as
          | Parameters<typeof extendTable>[0]['table']
          | undefined
        if (releaseGrants) {
          extendTable({
            table: releaseGrants,
            extraConfig: (t) => ({
              releaseGrantsNaturalKey: uniqueIndex('release_grants_natural_key_idx').on(
                t.releaseId,
                t.mobileE164,
              ),
            }),
          })
        }
```

- [ ] **Step 2: Regenerate types**

Run: `pnpm generate:types`
Expected: `src/payload-types.ts` gains `ReleaseBatch`, `ReleaseGrant`, `ReleaseGateStatus`. (Note the billie-crm dev container caveat: if running inside Docker with the named node_modules volume, run this where deps are installed.)

- [ ] **Step 3: Write the failing int test**

```ts
// tests/int/release-collections.int.spec.ts
/**
 * Release projections are read-only: staff can read (per role), nobody can
 * write through the Payload API — only the Python processor writes the tables.
 * Mirrors tests/int/marketing-collections.int.spec.ts (real Postgres via
 * testcontainers globalSetup).
 */
import { describe, it, expect } from 'vitest'
import { getPayloadClient } from '../utils/getPayloadClient' // ← match the helper marketing-collections.int.spec.ts uses

describe('release collections', () => {
  it('release-batches rejects API create', async () => {
    const payload = await getPayloadClient()
    await expect(
      payload.create({
        collection: 'release-batches',
        data: { releaseId: 'rel-x', name: 'nope' },
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('release_grants enforces the natural key', async () => {
    const payload = await getPayloadClient()
    // Write twice via overrideAccess (processor-equivalent path) — second
    // insert with the same (releaseId, mobileE164) must violate the unique index.
    await payload.create({
      collection: 'release-grants',
      data: { releaseId: 'rel-nk', mobileE164: '+61400000001', status: 'granted' },
      overrideAccess: true,
    })
    await expect(
      payload.create({
        collection: 'release-grants',
        data: { releaseId: 'rel-nk', mobileE164: '+61400000001', status: 'granted' },
        overrideAccess: true,
      }),
    ).rejects.toThrow()
  })
})
```

Open `tests/int/marketing-collections.int.spec.ts` first and copy its exact Payload-client bootstrap (helper name/path differ from the placeholder above — use whatever it uses).

- [ ] **Step 4: Run int test**

Run: `pnpm exec vitest run tests/int/release-collections.int.spec.ts --config ./vitest.config.mts`
Expected: PASS (testcontainers pushes the schema, so the tables + unique index exist).

- [ ] **Step 5: Create the committed migration**

Follow the local recipe (memory `payload-migration-local-recipe` / CLAUDE.md): from a branch containing latest main, against a throwaway local Docker Postgres, run `make -C infra/fly pg-migrate-create ENV=dev NAME=applicant_release`. Inspect the generated `src/migrations/<ts>_applicant_release.ts`: it must create `release_batches`, `release_grants`, `release_gate_status` with the columns listed in **Interfaces**, the three `payload_locked_documents_rels` steps per table (column + FK + index — see `20260704_043533_marketing_phase2.ts` for the shape), plus `release_grants_natural_key_idx`. Verify `src/migrations/index.ts` gained the entry.

- [ ] **Step 6: Commit**

```bash
git add src/collections/ReleaseBatches.ts src/collections/ReleaseGrants.ts src/collections/ReleaseGateStatus.ts src/payload.config.ts src/payload-types.ts src/migrations tests/int/release-collections.int.spec.ts
git commit -m "feat(releases): release projections with natural key and migration"
```

---

### Task 3: Python event-processor handlers

**Files:**
- Create: `event-processor/src/billie_servicing/handlers/applicant_release.py`
- Modify: `event-processor/src/billie_servicing/handlers/__init__.py`, `event-processor/src/billie_servicing/main.py`
- Test: `event-processor/tests/test_applicant_release_handlers.py`

**Interfaces:**
- Consumes: dict envelopes (local events fall through `processor.py`'s `else` branch — no SDK, no parser change), `upsert`/`update_by_key` from `db.py`, tables from Task 2.
- Produces handlers registered in `setup_handlers`: `handle_applicant_release_released`, `_revoked`, `_grant_claimed`, `_invites_sent`, `_gate_mode_changed` — all `(pool, parsed_event: dict) -> None`.

- [ ] **Step 1: Write the failing tests**

```python
# event-processor/tests/test_applicant_release_handlers.py
"""applicant_release.* projection handlers (CRM-local events, dict envelopes)."""
import json

from billie_servicing.handlers.applicant_release import (
    handle_applicant_release_gate_mode_changed,
    handle_applicant_release_grant_claimed,
    handle_applicant_release_invites_sent,
    handle_applicant_release_released,
    handle_applicant_release_revoked,
)


def _event(typ: str, payload: dict) -> dict:
    return {
        "conv": f"applicant-release:{payload.get('release_id', 'gate')}",
        "agt": "billie-crm", "usr": "staff-1", "cls": "msg", "typ": typ,
        "cause": "ev-1", "payload": json.dumps(payload),
    }


RELEASED = {
    "release_id": "rel-1", "name": "Wave", "type": "waitlist",
    "expires_at": "2026-08-16T00:00:00+00:00", "send_invite_sms": True,
    "grants": [
        {"mobile_e164": "+61400000001", "contact_id": "c-1", "send_sms": True},
        {"mobile_e164": "+61400000002", "contact_id": None, "send_sms": False},
    ],
    "quota_count": None, "released_by": "staff-1",
}


async def test_released_upserts_batch_and_grants(mock_pool):
    await handle_applicant_release_released(
        mock_pool, _event("applicant_release.released.v1", RELEASED)
    )
    batch = mock_pool.last_upsert("release_batches")
    assert batch.values["release_id"] == "rel-1"
    assert batch.values["granted_count"] == 2
    assert batch.values["status"] == "active"
    grants = mock_pool.inserts_into("release_grants")
    assert len(grants) == 2
    assert grants[0].values["sms_status"] == "not_sent"  # sent only confirmed by invites_sent


async def test_revoked_flips_statuses(mock_pool):
    await handle_applicant_release_revoked(
        mock_pool,
        _event("applicant_release.revoked.v1",
               {"release_id": "rel-1", "revoked_by": "staff-2", "reason": "oops"}),
    )
    update = mock_pool.updates_to("release_batches")[-1]
    assert update.values["status"] == "revoked"
    assert update.values["revoked_by"] == "staff-2"
    assert mock_pool.has_call_against("release_grants")  # grants swept to revoked


async def test_grant_claimed_upserts_row_and_recomputes_count(mock_pool):
    await handle_applicant_release_grant_claimed(
        mock_pool,
        _event("applicant_release.grant_claimed.v1", {
            "release_id": "rel-1", "mobile_e164": "+61400000001",
            "source": "quota", "claimed_at": "2026-08-02T09:00:00+00:00",
            "conversation_id": "conv-9",
        }),
    )
    grant = mock_pool.last_upsert("release_grants")
    assert grant.values["status"] == "claimed"
    assert grant.values["source"] == "quota_claim"
    assert grant.conflict_columns == ["release_id", "mobile_e164"]
    # claimed_count recomputed from grant rows (replay-safe), not incremented
    sql_all = " ".join(c.sql for c in mock_pool.calls())
    assert "claimed_count" in sql_all and "count(" in sql_all.lower()


async def test_invites_sent_marks_sms_statuses(mock_pool):
    await handle_applicant_release_invites_sent(
        mock_pool,
        _event("applicant_release.invites_sent.v1", {
            "release_id": "rel-1", "sent": ["+61400000001"],
            "failed": [{"mobile_e164": "+61400000003", "reason": "send_failed"}],
        }),
    )
    sql_all = " ".join(c.sql for c in mock_pool.calls())
    assert "sms_status" in sql_all
    batch_update = mock_pool.updates_to("release_batches")[-1]
    assert batch_update.values["sms_sent_count"] == 1
    assert batch_update.values["sms_failed_count"] == 1


async def test_gate_mode_changed_upserts_single_row(mock_pool):
    await handle_applicant_release_gate_mode_changed(
        mock_pool,
        _event("applicant_release.gate_mode.changed.v1",
               {"mode": "gated", "set_by": "ops", "changed_at": "2026-08-02T09:00:00+00:00"}),
    )
    row = mock_pool.last_upsert("release_gate_status")
    assert row.values["gate_id"] == "gate"
    assert row.values["mode"] == "gated"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd event-processor && python -m pytest tests/test_applicant_release_handlers.py -v`
Expected: FAIL with import error.

- [ ] **Step 3: Implement the handlers**

```python
# event-processor/src/billie_servicing/handlers/applicant_release.py
"""Projection handlers for applicant_release.* events (spec 2026-08-02 §5).

These are CRM-local events: the processor's parser falls through to the dict
envelope (like writeoff.*), so每 handler decodes the payload itself.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg

from billie_servicing.db import update_by_key, upsert


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_payload(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("payload", {})
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return {}
    return payload if isinstance(payload, dict) else {}


def _coerce_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


async def _recompute_claimed_count(pool: asyncpg.Pool, release_id: str) -> None:
    """Recompute from grant rows so replays can never drift the counter."""
    await pool.execute(
        'UPDATE "release_batches" SET claimed_count = ('
        'SELECT count(*) FROM "release_grants" '
        "WHERE release_id = $1 AND status = 'claimed') WHERE release_id = $1",
        release_id,
    )


async def handle_applicant_release_released(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """applicant_release.released.v1 — create the batch row + targeted grant rows."""
    p = _parse_payload(event)
    grants = p.get("grants") or []
    await upsert(
        pool,
        "release_batches",
        conflict_columns=["release_id"],
        values={
            "id": str(uuid.uuid4()),
            "release_id": p["release_id"],
            "name": p.get("name"),
            "type": p.get("type"),
            "status": "active",
            "quota_count": p.get("quota_count"),
            "expires_at": _coerce_ts(p.get("expires_at")),
            "send_invite_sms": bool(p.get("send_invite_sms")),
            "granted_count": len(grants),
            "claimed_count": 0,
            "sms_sent_count": 0,
            "sms_failed_count": 0,
            "created_by_actor": p.get("released_by"),
            "released_at": _now(),
            "updated_at": _now(),
            "created_at": _now(),
        },
        do_nothing_on_conflict=True,  # create-once; replays leave the row untouched
    )
    for grant in grants:
        await upsert(
            pool,
            "release_grants",
            conflict_columns=["release_id", "mobile_e164"],
            values={
                "id": str(uuid.uuid4()),
                "release_id": p["release_id"],
                "mobile_e164": grant["mobile_e164"],
                "contact_id": grant.get("contact_id"),
                "source": "targeted",
                "status": "granted",
                "sms_status": "not_sent",
                "updated_at": _now(),
                "created_at": _now(),
            },
            do_nothing_on_conflict=True,
        )


async def handle_applicant_release_revoked(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """applicant_release.revoked.v1 — flip the batch and its open grants."""
    p = _parse_payload(event)
    await update_by_key(
        pool,
        "release_batches",
        key_column="release_id",
        key_value=p["release_id"],
        values={
            "status": "revoked",
            "revoked_by": p.get("revoked_by"),
            "revoked_at": _now(),
            "updated_at": _now(),
        },
    )
    await pool.execute(
        'UPDATE "release_grants" SET status = \'revoked\', updated_at = $2 '
        "WHERE release_id = $1 AND status IN ('granted', 'claimed')",
        p["release_id"],
        _now(),
    )


async def handle_applicant_release_grant_claimed(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """applicant_release.grant_claimed.v1 — upsert the grant row (mints quota rows)."""
    p = _parse_payload(event)
    source = "quota_claim" if p.get("source") == "quota" else "targeted"
    await upsert(
        pool,
        "release_grants",
        conflict_columns=["release_id", "mobile_e164"],
        values={
            "id": str(uuid.uuid4()),
            "release_id": p["release_id"],
            "mobile_e164": p["mobile_e164"],
            "source": source,
            "status": "claimed",
            "sms_status": "not_sent",
            "claimed_at": _coerce_ts(p.get("claimed_at")),
            "updated_at": _now(),
            "created_at": _now(),
        },
        insert_only_columns=["created_at", "sms_status", "contact_id"],
    )
    await _recompute_claimed_count(pool, p["release_id"])


async def handle_applicant_release_invites_sent(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """applicant_release.invites_sent.v1 — record SMS outcomes reported by billieChat."""
    p = _parse_payload(event)
    release_id = p["release_id"]
    for mobile in p.get("sent") or []:
        await pool.execute(
            'UPDATE "release_grants" SET sms_status = \'sent\', updated_at = $3 '
            "WHERE release_id = $1 AND mobile_e164 = $2",
            release_id,
            mobile,
            _now(),
        )
    for failure in p.get("failed") or []:
        await pool.execute(
            'UPDATE "release_grants" SET sms_status = \'failed\', updated_at = $3 '
            "WHERE release_id = $1 AND mobile_e164 = $2",
            release_id,
            failure.get("mobile_e164"),
            _now(),
        )
    await update_by_key(
        pool,
        "release_batches",
        key_column="release_id",
        key_value=release_id,
        values={
            "sms_sent_count": len(p.get("sent") or []),
            "sms_failed_count": len(p.get("failed") or []),
            "updated_at": _now(),
        },
    )


async def handle_applicant_release_gate_mode_changed(
    pool: asyncpg.Pool, event: dict[str, Any]
) -> None:
    """applicant_release.gate_mode.changed.v1 — single-row gate status."""
    p = _parse_payload(event)
    await upsert(
        pool,
        "release_gate_status",
        conflict_columns=["gate_id"],
        values={
            "id": str(uuid.uuid4()),
            "gate_id": "gate",
            "mode": p.get("mode"),
            "set_by": p.get("set_by"),
            "changed_at": _coerce_ts(p.get("changed_at")) or _now(),
            "updated_at": _now(),
            "created_at": _now(),
        },
        insert_only_columns=["created_at"],
    )
```

(Fix the stray non-ASCII character in the docstring — write "so each handler".) Export the five handlers from `handlers/__init__.py` following the existing export blocks, then register in `main.py::setup_handlers` after the write-off block:

```python
    # Applicant release (spec 2026-08-02) — CRM-originated + billieChat facts
    processor.register_handler(
        "applicant_release.released.v1", handle_applicant_release_released
    )
    processor.register_handler(
        "applicant_release.revoked.v1", handle_applicant_release_revoked
    )
    processor.register_handler(
        "applicant_release.grant_claimed.v1", handle_applicant_release_grant_claimed
    )
    processor.register_handler(
        "applicant_release.invites_sent.v1", handle_applicant_release_invites_sent
    )
    processor.register_handler(
        "applicant_release.gate_mode.changed.v1", handle_applicant_release_gate_mode_changed
    )
```

(`applicant_release.gate_mode.set.v1` is deliberately NOT registered — it's billieChat's command; the processor ACKs-and-skips unregistered types.)

- [ ] **Step 4: Run to verify pass**

Run: `cd event-processor && python -m pytest tests/test_applicant_release_handlers.py -v && ruff check src/billie_servicing/handlers/applicant_release.py`
Expected: PASS (5 tests), ruff clean. Also run `python -m pytest tests/test_processor_routing.py -v` to confirm no dispatch regression.

- [ ] **Step 5: Commit**

```bash
git add event-processor/src/billie_servicing/handlers/applicant_release.py event-processor/src/billie_servicing/handlers/__init__.py event-processor/src/billie_servicing/main.py event-processor/tests/test_applicant_release_handlers.py
git commit -m "feat(releases): projection handlers for applicant_release events"
```

---

### Task 4: Dual publisher

**Files:**
- Create: `src/server/release-publisher.ts`
- Test: `tests/unit/server/releasePublisher.test.ts`

**Interfaces:**
- Consumes: `getChatLedgerRedisClient` + retry constants from `src/server/chatledger-publisher.ts` (export them if not already), `createAndPublishEvent`/`EventPublishError` from `src/server/event-publisher.ts`, payload types from Task 1.
- Produces: `publishReleaseCommand(options: { typ: string; conv: string; usr: string; payload: unknown }): Promise<{ eventId: string }>` — XADDs to `chatLedger` with `cls: 'cmd'` AND to the internal stream via `createAndPublishEvent` (cls `'msg'`), same `cause` eventId on the chatLedger copy; throws `EventPublishError` if the chatLedger write fails after retries. If only the internal-stream write fails, it still throws (the CRM's own projection is not optional — staff would fly blind).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/server/releasePublisher.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest'

const redisMock = vi.hoisted(() => ({
  status: 'ready',
  connect: vi.fn(),
  xadd: vi.fn().mockResolvedValue('1-1'),
}))
vi.mock('@/server/chatledger-publisher', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return { ...original, getChatLedgerRedisClient: () => redisMock }
})
const internal = vi.hoisted(() => ({
  createAndPublishEvent: vi.fn().mockResolvedValue({ eventId: 'ie-1', requestId: 'rq-1', status: 'accepted' }),
  EventPublishError: class EventPublishError extends Error {},
}))
vi.mock('@/server/event-publisher', () => internal)

import { publishReleaseCommand } from '@/server/release-publisher'

beforeEach(() => {
  redisMock.xadd.mockClear().mockResolvedValue('1-1')
  internal.createAndPublishEvent.mockClear()
})

describe('publishReleaseCommand', () => {
  test('writes chatLedger cmd and internal stream', async () => {
    const result = await publishReleaseCommand({
      typ: 'applicant_release.released.v1',
      conv: 'applicant-release:rel-1',
      usr: 'staff-1',
      payload: { release_id: 'rel-1' },
    })
    expect(result.eventId).toBeTruthy()
    expect(redisMock.xadd).toHaveBeenCalledTimes(1)
    const xaddArgs = redisMock.xadd.mock.calls[0]
    expect(xaddArgs[0]).toBe('chatLedger')
    const fields: Record<string, string> = {}
    for (let i = 2; i < xaddArgs.length; i += 2) fields[xaddArgs[i]] = xaddArgs[i + 1]
    expect(fields.cls).toBe('cmd')
    expect(fields.typ).toBe('applicant_release.released.v1')
    expect(fields.agt).toBe('billie-crm')
    expect(JSON.parse(fields.payload)).toEqual({ release_id: 'rel-1' })
    expect(internal.createAndPublishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ typ: 'applicant_release.released.v1', userId: 'staff-1' }),
    )
  })

  test('throws when chatLedger keeps failing', async () => {
    redisMock.xadd.mockRejectedValue(new Error('down'))
    await expect(
      publishReleaseCommand({ typ: 't', conv: 'c', usr: 'u', payload: {} }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/unit/server/releasePublisher.test.ts --config ./vitest.config.mts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/server/release-publisher.ts
/**
 * Dual publisher for applicant_release.* commands (spec §3).
 *
 * One staff action = two writes: chatLedger (cls 'cmd' — billieChat's Broker
 * routes it to applicantReleaseService) and the internal stream (cls 'msg' —
 * the CRM's own Python processor materialises release_batches). Both writes
 * are required; a failure of either surfaces as EVENT_PUBLISH_FAILED so the
 * failed-actions queue can replay the whole command.
 */
import { nanoid } from 'nanoid'
import { CHATLEDGER_STREAM, CRM_AGENT_ID, PUBLISH_BACKOFF_MS, PUBLISH_MAX_RETRIES } from '@/lib/events/config'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'
import { getChatLedgerRedisClient } from '@/server/chatledger-publisher'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface ReleaseCommandOptions {
  typ: string
  conv: string
  usr: string
  payload: unknown
}

export async function publishReleaseCommand(
  options: ReleaseCommandOptions,
): Promise<{ eventId: string }> {
  const eventId = nanoid()
  const fields: Record<string, string> = {
    conv: options.conv,
    agt: CRM_AGENT_ID,
    usr: options.usr,
    seq: '1',
    cls: 'cmd',
    typ: options.typ,
    cause: eventId,
    payload: JSON.stringify(options.payload),
  }
  const redis = getChatLedgerRedisClient()
  let lastError: Error | undefined
  let published = false
  for (let attempt = 0; attempt < PUBLISH_MAX_RETRIES; attempt++) {
    try {
      if (redis.status === 'wait') {
        await redis.connect()
      }
      await redis.xadd(CHATLEDGER_STREAM, '*', ...Object.entries(fields).flat())
      published = true
      break
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < PUBLISH_MAX_RETRIES - 1) {
        await sleep(PUBLISH_BACKOFF_MS[attempt] ?? 400)
      }
    }
  }
  if (!published) {
    throw new EventPublishError('Failed to publish release command to chatLedger after retries', {
      attempts: PUBLISH_MAX_RETRIES,
      cause: lastError,
    })
  }
  // Internal stream for the CRM's own projection — same payload, msg class.
  await createAndPublishEvent({ typ: options.typ, userId: options.usr, payload: options.payload })
  return { eventId }
}
```

If `getChatLedgerRedisClient` is not exported from `chatledger-publisher.ts`, export it (one-line change) rather than duplicating client construction.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/unit/server/releasePublisher.test.ts --config ./vitest.config.mts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/release-publisher.ts src/server/chatledger-publisher.ts tests/unit/server/releasePublisher.test.ts
git commit -m "feat(releases): dual publisher for applicant_release commands"
```

---

### Task 5: Target resolution + preflight partition library

**Files:**
- Create: `src/lib/releases.ts`
- Test: `tests/unit/lib/releasePartition.test.ts`

**Interfaces:**
- Consumes: Payload local API (`payload.find`), `normaliseAuMobile`, `getMarketingConsentGranted` from `src/lib/marketing.ts`, `CreateReleaseCommand` from Task 1.
- Produces:
  - `interface ReleaseCandidate { mobileE164: string; contactId: string | null; sendSms: boolean; bucket: 'granted_sms' | 'granted_no_sms' | 'skipped_already_customer' | 'skipped_already_released' | 'skipped_needs_review' | 'skipped_invalid_number' }`
  - `async computeReleasePartition({ payload, user, command }): Promise<{ candidates: ReleaseCandidate[]; counts: Record<ReleaseCandidate['bucket'], number> }>` — the ONE partition implementation used by both the preflight route (display) and the release route (actual grants), so the numbers staff confirmed are the numbers released.
  - For `open_quota`: returns empty candidates, all counts 0 (there is nothing to partition).

Partition rules (spec §5): waitlist candidates = contacts with `derivedStage: 'waitlist'`, `mobileE164` set, `erased: false`, `mergedInto` absent, ordered `waitlistPosition` asc then `waitlistJoinedAt` asc, stopping after `count` eligible; phone-list candidates = each pasted number through `normaliseAuMobile` (null → `skipped_invalid_number`), deduplicated, matched to contacts by `mobileE164`. Buckets, in precedence order per candidate: already-customer (contact has `customerId`) → already-released (mobile has a `release-grants` row with status `granted`/`claimed` whose release is `active` and unexpired) → needs-review (contact `needsReview`) → granted with SMS (`sendInviteSms && contact && getMarketingConsentGranted(consent) === true`) → granted without SMS.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/lib/releasePartition.test.ts
import { describe, test, expect, vi } from 'vitest'
import { computeReleasePartition } from '@/lib/releases'

type Doc = Record<string, unknown>

/** Payload.find stub keyed by collection. */
function payloadWith(docs: { contacts?: Doc[]; grants?: Doc[]; batches?: Doc[] }) {
  return {
    find: vi.fn(async ({ collection }: { collection: string }) => {
      if (collection === 'contacts') return { docs: docs.contacts ?? [], totalDocs: (docs.contacts ?? []).length }
      if (collection === 'release-grants') return { docs: docs.grants ?? [], totalDocs: (docs.grants ?? []).length }
      if (collection === 'release-batches') return { docs: docs.batches ?? [], totalDocs: (docs.batches ?? []).length }
      return { docs: [], totalDocs: 0 }
    }),
  } as never
}

const consented = { marketing: { granted: true } }

describe('computeReleasePartition — waitlist', () => {
  test('takes eligible contacts in order and buckets correctly', async () => {
    const payload = payloadWith({
      contacts: [
        { contactId: 'c1', mobileE164: '+61400000001', consent: consented, needsReview: false, customerId: null },
        { contactId: 'c2', mobileE164: '+61400000002', consent: null, needsReview: false, customerId: null },
        { contactId: 'c3', mobileE164: '+61400000003', consent: consented, needsReview: true, customerId: null },
        { contactId: 'c4', mobileE164: '+61400000004', consent: consented, needsReview: false, customerId: 'cust-1' },
      ],
    })
    const { counts } = await computeReleasePartition({
      payload,
      user: { id: 'staff-1' } as never,
      command: {
        releaseId: 'rel_12345678', name: 'w', type: 'waitlist',
        count: 4, expiryDays: 14, sendInviteSms: true,
      },
    })
    expect(counts.granted_sms).toBe(1)          // c1
    expect(counts.granted_no_sms).toBe(1)       // c2 (no consent)
    expect(counts.skipped_needs_review).toBe(1) // c3
    expect(counts.skipped_already_customer).toBe(1) // c4
  })

  test('already-released mobiles are skipped', async () => {
    const payload = payloadWith({
      contacts: [
        { contactId: 'c1', mobileE164: '+61400000001', consent: consented, needsReview: false, customerId: null },
      ],
      grants: [{ releaseId: 'rel-old', mobileE164: '+61400000001', status: 'granted' }],
      batches: [{ releaseId: 'rel-old', status: 'active', expiresAt: '2099-01-01T00:00:00Z' }],
    })
    const { counts } = await computeReleasePartition({
      payload,
      user: { id: 'staff-1' } as never,
      command: { releaseId: 'rel_12345678', name: 'w', type: 'waitlist', count: 1, expiryDays: 14, sendInviteSms: false },
    })
    expect(counts.skipped_already_released).toBe(1)
  })
})

describe('computeReleasePartition — phone_list', () => {
  test('normalises, dedupes, flags invalid; unknown numbers grant without SMS', async () => {
    const payload = payloadWith({ contacts: [] })
    const { candidates, counts } = await computeReleasePartition({
      payload,
      user: { id: 'staff-1' } as never,
      command: {
        releaseId: 'rel_12345678', name: 'p', type: 'phone_list',
        mobiles: ['0400 000 001', '400000001', 'garbage', '0400000002'],
        expiryDays: 14, sendInviteSms: true,
      },
    })
    expect(counts.skipped_invalid_number).toBe(1)
    expect(counts.granted_no_sms).toBe(2) // deduped +61400000001, +61400000002 — no contact → no consent → no SMS
    expect(candidates.filter((c) => c.bucket === 'granted_no_sms').map((c) => c.mobileE164)).toEqual(
      ['+61400000001', '+61400000002'],
    )
  })
})

describe('computeReleasePartition — open_quota', () => {
  test('returns empty partition', async () => {
    const { candidates, counts } = await computeReleasePartition({
      payload: payloadWith({}),
      user: { id: 'staff-1' } as never,
      command: { releaseId: 'rel_12345678', name: 'q', type: 'open_quota', count: 150, expiryDays: 14, sendInviteSms: false },
    })
    expect(candidates).toEqual([])
    expect(Object.values(counts).every((n) => n === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/unit/lib/releasePartition.test.ts --config ./vitest.config.mts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/releases.ts`**

```ts
/**
 * Target resolution + preflight partition for applicant releases (spec §5).
 *
 * ONE implementation serves both the preflight display and the actual release
 * command — the numbers staff confirmed are, by construction, the numbers
 * released.
 */
import type { Payload } from 'payload'
import { getMarketingConsentGranted, normaliseAuMobile } from '@/lib/marketing'
import type { CreateReleaseCommand } from '@/lib/schemas/releases'

export type ReleaseBucket =
  | 'granted_sms'
  | 'granted_no_sms'
  | 'skipped_already_customer'
  | 'skipped_already_released'
  | 'skipped_needs_review'
  | 'skipped_invalid_number'

export interface ReleaseCandidate {
  mobileE164: string
  contactId: string | null
  sendSms: boolean
  bucket: ReleaseBucket
}

export interface ReleasePartition {
  candidates: ReleaseCandidate[]
  counts: Record<ReleaseBucket, number>
}

interface PartitionArgs {
  payload: Payload
  user: unknown
  command: CreateReleaseCommand
}

const EMPTY_COUNTS: Record<ReleaseBucket, number> = {
  granted_sms: 0,
  granted_no_sms: 0,
  skipped_already_customer: 0,
  skipped_already_released: 0,
  skipped_needs_review: 0,
  skipped_invalid_number: 0,
}

interface ContactLite {
  contactId?: string | null
  mobileE164?: string | null
  consent?: unknown
  needsReview?: boolean | null
  customerId?: string | null
}

export async function computeReleasePartition({
  payload,
  user,
  command,
}: PartitionArgs): Promise<ReleasePartition> {
  if (command.type === 'open_quota') {
    return { candidates: [], counts: { ...EMPTY_COUNTS } }
  }

  const activeGrantMobiles = await fetchActivelyReleasedMobiles(payload, user)
  const candidates: ReleaseCandidate[] = []

  if (command.type === 'waitlist') {
    const result = await payload.find({
      collection: 'contacts',
      where: {
        derivedStage: { equals: 'waitlist' },
        mobileE164: { exists: true },
        erased: { not_equals: true },
        mergedInto: { exists: false },
      } as never,
      sort: 'waitlistPosition,waitlistJoinedAt',
      limit: 10_000,
      depth: 0,
      overrideAccess: false,
      user,
    })
    let taken = 0
    for (const doc of result.docs as ContactLite[]) {
      if (taken >= (command.count ?? 0)) break
      const candidate = bucketContact(doc, command.sendInviteSms, activeGrantMobiles)
      candidates.push(candidate)
      if (candidate.bucket === 'granted_sms' || candidate.bucket === 'granted_no_sms') taken++
    }
  } else {
    const seen = new Set<string>()
    for (const raw of command.mobiles ?? []) {
      const mobile = normaliseAuMobile(raw)
      if (!mobile) {
        candidates.push({ mobileE164: raw, contactId: null, sendSms: false, bucket: 'skipped_invalid_number' })
        continue
      }
      if (seen.has(mobile)) continue
      seen.add(mobile)
      const match = await payload.find({
        collection: 'contacts',
        where: { mobileE164: { equals: mobile }, mergedInto: { exists: false } } as never,
        limit: 1,
        depth: 0,
        overrideAccess: false,
        user,
      })
      const contact = (match.docs[0] as ContactLite | undefined) ?? null
      candidates.push(
        bucketContact(
          contact ?? { mobileE164: mobile, contactId: null },
          command.sendInviteSms,
          activeGrantMobiles,
        ),
      )
    }
  }

  const counts = { ...EMPTY_COUNTS }
  for (const c of candidates) counts[c.bucket]++
  return { candidates, counts }
}

function bucketContact(
  contact: ContactLite,
  sendInviteSms: boolean,
  activeGrantMobiles: Set<string>,
): ReleaseCandidate {
  const mobile = contact.mobileE164 as string
  const base = { mobileE164: mobile, contactId: contact.contactId ?? null }
  if (contact.customerId) return { ...base, sendSms: false, bucket: 'skipped_already_customer' }
  if (activeGrantMobiles.has(mobile)) return { ...base, sendSms: false, bucket: 'skipped_already_released' }
  if (contact.needsReview) return { ...base, sendSms: false, bucket: 'skipped_needs_review' }
  const consented = getMarketingConsentGranted(contact.consent) === true
  if (sendInviteSms && contact.contactId && consented) {
    return { ...base, sendSms: true, bucket: 'granted_sms' }
  }
  return { ...base, sendSms: false, bucket: 'granted_no_sms' }
}

async function fetchActivelyReleasedMobiles(payload: Payload, user: unknown): Promise<Set<string>> {
  const now = new Date().toISOString()
  const activeBatches = await payload.find({
    collection: 'release-batches',
    where: { status: { equals: 'active' }, expiresAt: { greater_than: now } } as never,
    limit: 1000,
    depth: 0,
    overrideAccess: false,
    user,
  })
  const ids = activeBatches.docs.map((d) => (d as { releaseId?: string }).releaseId).filter(Boolean)
  if (ids.length === 0) return new Set()
  const grants = await payload.find({
    collection: 'release-grants',
    where: { releaseId: { in: ids }, status: { in: ['granted', 'claimed'] } } as never,
    limit: 10_000,
    depth: 0,
    overrideAccess: false,
    user,
  })
  return new Set(grants.docs.map((d) => (d as { mobileE164?: string }).mobileE164 ?? ''))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/unit/lib/releasePartition.test.ts --config ./vitest.config.mts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/releases.ts tests/unit/lib/releasePartition.test.ts
git commit -m "feat(releases): shared target-resolution and preflight partition"
```

---

### Task 6: API routes

**Files:**
- Create: `src/app/api/marketing/releases/route.ts` (GET list, POST release)
- Create: `src/app/api/marketing/releases/preflight/route.ts` (POST)
- Create: `src/app/api/marketing/releases/[releaseId]/route.ts` (GET detail)
- Create: `src/app/api/marketing/releases/[releaseId]/revoke/route.ts` (POST)
- Create: `src/app/api/marketing/releases/gate-status/route.ts` (GET)
- Test: `tests/unit/routes/releaseRoutes.test.ts`

**Interfaces:**
- Consumes: `computeReleasePartition` (Task 5), `publishReleaseCommand` (Task 4), schemas (Task 1), `requireAuth`/`canMarketing`/`canReadMarketing`, `logInteraction` from `@/server/marketing-grpc-client`.
- Produces:
  - `POST /api/marketing/releases/preflight` body = `CreateReleaseCommand` → 200 `{ counts, total }` (canReadMarketing)
  - `POST /api/marketing/releases` body = `CreateReleaseCommand` → 202 `{ releaseId, eventId }` (canMarketing); publishes `applicant_release.released.v1` with grants = partition buckets `granted_sms`+`granted_no_sms`, `expires_at` = now + expiryDays, skip counts embedded in… **note:** skip counts land on the projection via the released payload? No — the released payload carries only grants/quota; the route ALSO passes the skip counts in the payload as `skipped: {...}` so the handler can store them. Extend the payload with `skipped_already_customer` etc. (see Step 3) — the billieChat model ignores unknown fields (Pydantic default) so this is contract-safe.
  - `GET /api/marketing/releases?page=` → projection list with `derivedStatus` (`expired` when `status='active'` and `expiresAt` past) (canReadMarketing)
  - `GET /api/marketing/releases/[releaseId]` → `{ release, grants }` (grants paged, 100/page)
  - `POST /api/marketing/releases/[releaseId]/revoke` body = `RevokeReleaseCommandSchema` → 202
  - `GET /api/marketing/releases/gate-status` → `{ mode: 'open' | 'gated', changedAt, setBy }` (defaults `{ mode: 'open' }` when no row)

- [ ] **Step 1: Write the failing route tests**

```ts
// tests/unit/routes/releaseRoutes.test.ts
/**
 * Release command routes. next/server, @/lib/auth, @/server/release-publisher,
 * @/server/marketing-grpc-client and @/lib/releases are mocked; zod schemas real.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 })),
  },
}))

const authHolder = vi.hoisted(() => ({
  current: {
    user: { id: 'staff-1' },
    payload: { find: vi.fn(async () => ({ docs: [], totalDocs: 0 })) },
  } as Record<string, unknown>,
}))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => authHolder.current) }))

const publisher = vi.hoisted(() => ({ publishReleaseCommand: vi.fn() }))
vi.mock('@/server/release-publisher', () => publisher)

const partition = vi.hoisted(() => ({ computeReleasePartition: vi.fn() }))
vi.mock('@/lib/releases', () => partition)

const grpc = vi.hoisted(() => ({ logInteraction: vi.fn().mockResolvedValue({}) }))
vi.mock('@/server/marketing-grpc-client', () => grpc)

import { POST as releasePost } from '@/app/api/marketing/releases/route'
import { POST as preflightPost } from '@/app/api/marketing/releases/preflight/route'
import { POST as revokePost } from '@/app/api/marketing/releases/[releaseId]/revoke/route'

function req(body?: unknown): NextRequest {
  return new Request('http://x/api/marketing/releases', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}
const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) })

const command = {
  releaseId: 'rel_12345678', name: 'Wave', type: 'waitlist',
  count: 2, expiryDays: 14, sendInviteSms: true,
}

beforeEach(() => {
  authHolder.current = {
    user: { id: 'staff-1' },
    payload: { find: vi.fn(async () => ({ docs: [], totalDocs: 0 })) },
  }
  publisher.publishReleaseCommand.mockReset().mockResolvedValue({ eventId: 'e-1' })
  partition.computeReleasePartition.mockReset().mockResolvedValue({
    candidates: [
      { mobileE164: '+61400000001', contactId: 'c-1', sendSms: true, bucket: 'granted_sms' },
      { mobileE164: '+61400000002', contactId: null, sendSms: false, bucket: 'granted_no_sms' },
      { mobileE164: '+61400000003', contactId: 'c-3', sendSms: false, bucket: 'skipped_already_customer' },
    ],
    counts: {
      granted_sms: 1, granted_no_sms: 1, skipped_already_customer: 1,
      skipped_already_released: 0, skipped_needs_review: 0, skipped_invalid_number: 0,
    },
  })
  grpc.logInteraction.mockClear()
})

describe('POST /api/marketing/releases', () => {
  test('202: publishes released.v1 with granted candidates only', async () => {
    const res = (await releasePost(req(command))) as { body: { releaseId: string }; status: number }
    expect(res.status).toBe(202)
    expect(res.body.releaseId).toBe('rel_12345678')
    const call = publisher.publishReleaseCommand.mock.calls[0][0]
    expect(call.typ).toBe('applicant_release.released.v1')
    expect(call.conv).toBe('applicant-release:rel_12345678')
    expect(call.payload.grants).toHaveLength(2) // skipped_already_customer excluded
    expect(call.payload.grants[0]).toEqual({ mobile_e164: '+61400000001', contact_id: 'c-1', send_sms: true })
    expect(call.payload.skipped.already_customer).toBe(1)
  })

  test('logs a released_to_apply interaction for matched contacts', async () => {
    await releasePost(req(command))
    expect(grpc.logInteraction).toHaveBeenCalledTimes(1) // only c-1 (granted + matched)
    expect(grpc.logInteraction.mock.calls[0][0]).toMatchObject({ contactId: 'c-1', kind: 'released_to_apply' })
  })

  test('400 on schema violation', async () => {
    const res = (await releasePost(req({ ...command, type: 'phone_list' }))) as { status: number }
    expect(res.status).toBe(400)
    expect(publisher.publishReleaseCommand).not.toHaveBeenCalled()
  })

  test('503 when publish fails', async () => {
    publisher.publishReleaseCommand.mockRejectedValue(new Error('down'))
    const res = (await releasePost(req(command))) as { body: { error: { code: string } }; status: number }
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('EVENT_PUBLISH_FAILED')
  })
})

describe('POST /api/marketing/releases/preflight', () => {
  test('returns counts without publishing', async () => {
    const res = (await preflightPost(req(command))) as { body: { counts: Record<string, number> }; status: number }
    expect(res.status).toBe(200)
    expect(res.body.counts.granted_sms).toBe(1)
    expect(publisher.publishReleaseCommand).not.toHaveBeenCalled()
  })
})

describe('POST /api/marketing/releases/[releaseId]/revoke', () => {
  test('202: publishes revoked.v1', async () => {
    const res = (await revokePost(req({ reason: 'mistake' }), p({ releaseId: 'rel-1' }))) as { status: number }
    expect(res.status).toBe(202)
    const call = publisher.publishReleaseCommand.mock.calls[0][0]
    expect(call.typ).toBe('applicant_release.revoked.v1')
    expect(call.payload).toMatchObject({ release_id: 'rel-1', revoked_by: 'staff-1', reason: 'mistake' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/unit/routes/releaseRoutes.test.ts --config ./vitest.config.mts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the routes**

`src/app/api/marketing/releases/preflight/route.ts`:

```ts
/**
 * POST /api/marketing/releases/preflight — the partition staff confirm before
 * releasing. POST (not GET) because phone_list bodies carry up to 1,000
 * numbers. Read-gated: it's a computation, not a command.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canReadMarketing } from '@/lib/access'
import { CreateReleaseCommandSchema } from '@/lib/schemas/releases'
import { computeReleasePartition } from '@/lib/releases'

export async function POST(request: NextRequest) {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Body must be valid JSON' } },
      { status: 400 },
    )
  }
  const parsed = CreateReleaseCommandSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid release payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    )
  }

  const { counts, candidates } = await computeReleasePartition({
    payload,
    user,
    command: parsed.data,
  })
  return NextResponse.json({ counts, total: candidates.length })
}
```

`src/app/api/marketing/releases/route.ts`:

```ts
/**
 * GET  /api/marketing/releases — projection list (+ derived expired status)
 * POST /api/marketing/releases — the release command (spec §5): resolve
 * targets NOW, dual-publish applicant_release.released.v1, 202.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing, canReadMarketing } from '@/lib/access'
import { CreateReleaseCommandSchema } from '@/lib/schemas/releases'
import { computeReleasePartition } from '@/lib/releases'
import { publishReleaseCommand } from '@/server/release-publisher'
import { EVENT_TYPE_APPLICANT_RELEASE_RELEASED } from '@/lib/events/config'
import type { ApplicantReleaseReleasedPayload } from '@/lib/events/types'
import { EventPublishError } from '@/server/event-publisher'
import { logInteraction } from '@/server/marketing-grpc-client'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth

  const sp = request.nextUrl.searchParams
  const result = await payload.find({
    collection: 'release-batches',
    page: Number(sp.get('page') ?? 1),
    limit: 50,
    sort: '-releasedAt',
    overrideAccess: false,
    user,
  })
  const now = Date.now()
  const docs = result.docs.map((doc) => {
    const d = doc as { status?: string | null; expiresAt?: string | null }
    const derivedStatus =
      d.status === 'active' && d.expiresAt && Date.parse(d.expiresAt) < now ? 'expired' : d.status
    return { ...doc, derivedStatus }
  })
  return NextResponse.json({ ...result, docs })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canMarketing)
    if ('error' in auth) return auth.error
    const { payload, user } = auth

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Body must be valid JSON' } },
        { status: 400 },
      )
    }
    const parsed = CreateReleaseCommandSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid release payload',
            details: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      )
    }
    const command = parsed.data

    const { candidates, counts } = await computeReleasePartition({ payload, user, command })
    const granted = candidates.filter(
      (c) => c.bucket === 'granted_sms' || c.bucket === 'granted_no_sms',
    )

    const expiresAt = new Date(Date.now() + command.expiryDays * 86_400_000).toISOString()
    const eventPayload: ApplicantReleaseReleasedPayload & { skipped: Record<string, number> } = {
      release_id: command.releaseId,
      name: command.name,
      type: command.type,
      expires_at: expiresAt,
      send_invite_sms: command.sendInviteSms,
      grants: granted.map((c) => ({
        mobile_e164: c.mobileE164,
        contact_id: c.contactId,
        send_sms: c.sendSms,
      })),
      quota_count: command.type === 'open_quota' ? (command.count ?? 0) : null,
      released_by: String(user.id),
      skipped: {
        already_customer: counts.skipped_already_customer,
        already_released: counts.skipped_already_released,
        needs_review: counts.skipped_needs_review,
        invalid_number: counts.skipped_invalid_number,
      },
    }

    const { eventId } = await publishReleaseCommand({
      typ: EVENT_TYPE_APPLICANT_RELEASE_RELEASED,
      conv: `applicant-release:${command.releaseId}`,
      usr: String(user.id),
      payload: eventPayload,
    })

    // Timeline visibility on matched contacts — best-effort, never blocks the 202.
    for (const c of granted) {
      if (!c.contactId) continue
      logInteraction({
        idempotencyKey: `release:${command.releaseId}:${c.contactId}`,
        contactId: c.contactId,
        kind: 'released_to_apply',
        sourceSystem: 'billie-crm',
        actor: String(user.id),
        metadataJson: JSON.stringify({ release_id: command.releaseId, name: command.name }),
      }).catch(() => {})
    }

    return NextResponse.json({ releaseId: command.releaseId, eventId }, { status: 202 })
  } catch (error) {
    console.error('[Release] Error:', error)
    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'Failed to publish the release. Please try again.',
          },
        },
        { status: 503 },
      )
    }
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
      { status: 500 },
    )
  }
}
```

`src/app/api/marketing/releases/[releaseId]/route.ts`:

```ts
/** GET /api/marketing/releases/[releaseId] — release detail + grant rows. */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canReadMarketing } from '@/lib/access'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ releaseId: string }> },
) {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth
  const { releaseId } = await params

  const releases = await payload.find({
    collection: 'release-batches',
    where: { releaseId: { equals: releaseId } } as never,
    limit: 1,
    overrideAccess: false,
    user,
  })
  const release = releases.docs[0] ?? null
  const grants = await payload.find({
    collection: 'release-grants',
    where: { releaseId: { equals: releaseId } } as never,
    page: Number(request.nextUrl.searchParams.get('page') ?? 1),
    limit: 100,
    sort: 'mobileE164',
    overrideAccess: false,
    user,
  })
  return NextResponse.json({ release, grants })
}
```

`src/app/api/marketing/releases/[releaseId]/revoke/route.ts`:

```ts
/** POST /api/marketing/releases/[releaseId]/revoke — kill remaining grants. */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing } from '@/lib/access'
import { RevokeReleaseCommandSchema } from '@/lib/schemas/releases'
import { publishReleaseCommand } from '@/server/release-publisher'
import { EVENT_TYPE_APPLICANT_RELEASE_REVOKED } from '@/lib/events/config'
import { EventPublishError } from '@/server/event-publisher'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ releaseId: string }> },
) {
  try {
    const auth = await requireAuth(canMarketing)
    if ('error' in auth) return auth.error
    const { user } = auth
    const { releaseId } = await params

    const body = await request.json().catch(() => ({}))
    const parsed = RevokeReleaseCommandSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid revoke payload' } },
        { status: 400 },
      )
    }

    const { eventId } = await publishReleaseCommand({
      typ: EVENT_TYPE_APPLICANT_RELEASE_REVOKED,
      conv: `applicant-release:${releaseId}`,
      usr: String(user.id),
      payload: {
        release_id: releaseId,
        revoked_by: String(user.id),
        reason: parsed.data.reason,
      },
    })
    return NextResponse.json({ releaseId, eventId }, { status: 202 })
  } catch (error) {
    console.error('[Release Revoke] Error:', error)
    if (error instanceof EventPublishError) {
      return NextResponse.json(
        { error: { code: 'EVENT_PUBLISH_FAILED', message: 'Failed to publish the revoke.' } },
        { status: 503 },
      )
    }
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
      { status: 500 },
    )
  }
}
```

`src/app/api/marketing/releases/gate-status/route.ts`:

```ts
/** GET /api/marketing/releases/gate-status — projected billieChat gate mode. */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canReadMarketing } from '@/lib/access'

export async function GET() {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth

  const rows = await payload.find({
    collection: 'release-gate-status',
    where: { gateId: { equals: 'gate' } } as never,
    limit: 1,
    overrideAccess: false,
    user,
  })
  const row = rows.docs[0] as { mode?: string; setBy?: string; changedAt?: string } | undefined
  return NextResponse.json({
    mode: row?.mode ?? 'open',
    setBy: row?.setBy ?? null,
    changedAt: row?.changedAt ?? null,
  })
}
```

**Contract note (spec §4 addition):** the released payload gains a `skipped` object (counts). Because billieChat's Pydantic model ignores unknown fields by default, this is backward-compatible; the CRM handler (Task 3) already stores `skipped_*` — extend `handle_applicant_release_released` to read `p.get("skipped", {})` into the four `skipped_*` columns (add to the Task 3 values dict: `"skipped_already_customer": (p.get("skipped") or {}).get("already_customer", 0),` etc., and assert one of them in the Task 3 released test).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/unit/routes/releaseRoutes.test.ts --config ./vitest.config.mts`
Expected: PASS (7 tests). Re-run Task 3's Python tests after the `skipped` extension: `cd event-processor && python -m pytest tests/test_applicant_release_handlers.py -v`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/marketing/releases event-processor/src/billie_servicing/handlers/applicant_release.py event-processor/tests/test_applicant_release_handlers.py tests/unit/routes/releaseRoutes.test.ts
git commit -m "feat(releases): release, preflight, revoke, detail and gate-status routes"
```

---

### Task 7: React Query hooks

**Files:**
- Create: `src/hooks/queries/useReleases.ts`, `src/hooks/queries/useGateStatus.ts`
- Create: `src/hooks/mutations/useReleaseCommands.ts`
- Modify: `src/hooks/index.ts` (barrel)
- Test: `tests/unit/hooks/useReleaseCommands.test.tsx`

**Interfaces:**
- Produces:
  - `useReleases(filters?: { page?: number })` → list with `derivedStatus`; `releasesQueryKey`
  - `useRelease(releaseId: string)` → `{ release, grants }`, polling 3s until the release lands then 30s (projection-lag pattern)
  - `useGateStatus()` → `{ mode, setBy, changedAt }`, 30s refetch
  - `useReleasePreflight()` — a `useMutation` posting the draft command to `/preflight`, returning `{ counts, total }`
  - `useCreateRelease()` / `useRevokeRelease()` — 202 mutations with `invalidateWithLag`-style re-invalidation (import the helper if exported; otherwise replicate the 2-retry pattern locally) and `recordMarketingFailure` capture

- [ ] **Step 1: Write the failing hook test**

```tsx
// tests/unit/hooks/useReleaseCommands.test.tsx
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/stores/failed-actions', () => ({
  useFailedActionsStore: { getState: () => ({ addFailedAction: vi.fn() }) },
}))

import { useCreateRelease } from '@/hooks/mutations/useReleaseCommands'

const fetchMock = vi.fn()
global.fetch = fetchMock as never

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => fetchMock.mockReset())

describe('useCreateRelease', () => {
  test('POSTs the command and resolves the 202 body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ releaseId: 'rel_1', eventId: 'e-1' }),
    })
    const { result } = renderHook(() => useCreateRelease(), { wrapper })
    result.current.mutate({
      releaseId: 'rel_12345678', name: 'Wave', type: 'waitlist',
      count: 10, expiryDays: 14, sendInviteSms: false,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/marketing/releases')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).releaseId).toBe('rel_12345678')
  })

  test('surfaces command failure as error', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 503,
      json: async () => ({ error: { code: 'EVENT_PUBLISH_FAILED', message: 'try again' } }),
    })
    const { result } = renderHook(() => useCreateRelease(), { wrapper })
    result.current.mutate({
      releaseId: 'rel_12345678', name: 'Wave', type: 'waitlist',
      count: 10, expiryDays: 14, sendInviteSms: false,
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toContain('try again')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/unit/hooks/useReleaseCommands.test.tsx --config ./vitest.config.mts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hooks**

`src/hooks/queries/useReleases.ts`:

```ts
'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReleaseBatch, ReleaseGrant } from '@/payload-types'

export type ReleaseWithDerived = ReleaseBatch & { derivedStatus?: string | null }

export interface ReleasesResponse {
  docs: ReleaseWithDerived[]
  totalDocs: number
  totalPages: number
  page: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export const releasesQueryKey = (filters: { page?: number } = {}) =>
  ['marketing-releases', 'list', filters] as const

async function fetchReleases(filters: { page?: number }): Promise<ReleasesResponse> {
  const qs = filters.page ? `?page=${filters.page}` : ''
  const res = await fetch(`/api/marketing/releases${qs}`, { credentials: 'include' })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Releases fetch failed: ${res.status}`)
  }
  return res.json()
}

export function useReleases(filters: { page?: number } = {}) {
  return useQuery({
    queryKey: releasesQueryKey(filters),
    queryFn: () => fetchReleases(filters),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  })
}

export interface ReleaseDetailResponse {
  release: ReleaseWithDerived | null
  grants: { docs: ReleaseGrant[]; totalDocs: number; totalPages: number; page: number }
}

export const releaseDetailQueryKey = (releaseId: string, page: number) =>
  ['marketing-releases', 'detail', releaseId, page] as const

/** Polls fast until the just-created projection lands (campaign-detail pattern). */
export function useRelease(releaseId: string, page = 1) {
  return useQuery({
    queryKey: releaseDetailQueryKey(releaseId, page),
    queryFn: async (): Promise<ReleaseDetailResponse> => {
      const res = await fetch(`/api/marketing/releases/${encodeURIComponent(releaseId)}?page=${page}`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`Release fetch failed: ${res.status}`)
      return res.json()
    },
    enabled: !!releaseId,
    refetchInterval: (query) => (query.state.data?.release ? 30_000 : 3_000),
  })
}
```

`src/hooks/queries/useGateStatus.ts`:

```ts
'use client'

import { useQuery } from '@tanstack/react-query'

export interface GateStatus {
  mode: 'open' | 'gated'
  setBy: string | null
  changedAt: string | null
}

export const gateStatusQueryKey = ['marketing-releases', 'gate-status'] as const

export function useGateStatus() {
  return useQuery({
    queryKey: gateStatusQueryKey,
    queryFn: async (): Promise<GateStatus> => {
      const res = await fetch('/api/marketing/releases/gate-status', { credentials: 'include' })
      if (!res.ok) throw new Error(`Gate status fetch failed: ${res.status}`)
      return res.json()
    },
    refetchInterval: 30_000,
  })
}
```

`src/hooks/mutations/useReleaseCommands.ts`:

```ts
'use client'

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { CreateReleaseCommand } from '@/lib/schemas/releases'
import type { ReleaseBucket } from '@/lib/releases'
import { recordMarketingFailure } from '@/hooks/mutations/useMarketingCommands'

const LAG_RETRIES_MS = [1500, 4000]

function invalidateWithLag(qc: QueryClient, keys: string[][]) {
  const run = () => keys.forEach((queryKey) => qc.invalidateQueries({ queryKey }))
  run()
  LAG_RETRIES_MS.forEach((ms) => setTimeout(run, ms))
}

async function postCommand<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Command failed: ${res.status}`)
  }
  return res.json()
}

export interface ReleasePreflightResult {
  counts: Record<ReleaseBucket, number>
  total: number
}

/** Fresh partition each time the confirm step opens — the numbers ARE the decision. */
export function useReleasePreflight() {
  return useMutation({
    mutationFn: (command: CreateReleaseCommand) =>
      postCommand<ReleasePreflightResult>('/api/marketing/releases/preflight', command),
  })
}

export function useCreateRelease() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (command: CreateReleaseCommand) =>
      postCommand<{ releaseId: string; eventId: string }>('/api/marketing/releases', command),
    onSuccess: () => {
      toast.success('Release published')
      invalidateWithLag(qc, [['marketing-releases']])
    },
    onError: (e: Error, command) => {
      toast.error('Failed to publish release', { description: e.message })
      recordMarketingFailure(
        `Release "${command.name}"`,
        command.releaseId,
        '/api/marketing/releases',
        command,
        e,
      )
    },
  })
}

export function useRevokeRelease() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { releaseId: string; reason?: string }) =>
      postCommand<{ releaseId: string; eventId: string }>(
        `/api/marketing/releases/${encodeURIComponent(vars.releaseId)}/revoke`,
        { reason: vars.reason },
      ),
    onSuccess: () => {
      toast.success('Release revoked — remaining grants cancelled')
      invalidateWithLag(qc, [['marketing-releases']])
    },
    onError: (e: Error, vars) => {
      toast.error('Failed to revoke release', { description: e.message })
      recordMarketingFailure(
        `Revoke release ${vars.releaseId}`,
        vars.releaseId,
        `/api/marketing/releases/${vars.releaseId}/revoke`,
        vars,
        e,
      )
    },
  })
}
```

Barrel exports in `src/hooks/index.ts` (matching the existing pair style):

```ts
export { useReleases, useRelease, releasesQueryKey, releaseDetailQueryKey } from './queries/useReleases'
export type { ReleasesResponse, ReleaseDetailResponse, ReleaseWithDerived } from './queries/useReleases'
export { useGateStatus, gateStatusQueryKey } from './queries/useGateStatus'
export type { GateStatus } from './queries/useGateStatus'
export { useCreateRelease, useRevokeRelease, useReleasePreflight } from './mutations/useReleaseCommands'
export type { ReleasePreflightResult } from './mutations/useReleaseCommands'
```

(Check that `recordMarketingFailure` is exported from `useMarketingCommands.ts` — it is, at `:545`.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/unit/hooks/useReleaseCommands.test.tsx --config ./vitest.config.mts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/queries/useReleases.ts src/hooks/queries/useGateStatus.ts src/hooks/mutations/useReleaseCommands.ts src/hooks/index.ts tests/unit/hooks/useReleaseCommands.test.tsx
git commit -m "feat(releases): React Query hooks for releases, preflight, gate status"
```

---

### Task 8: Releases UI

**Files:**
- Modify: `src/components/MarketingView/MarketingSubnav.tsx` (Releases tab), `src/components/MarketingView/MarketingView.tsx` + `MarketingViewWithTemplate.tsx` (segment dispatch)
- Create: `src/components/MarketingView/ReleasesView.tsx`, `NewReleaseModal.tsx`, `ReleaseDetail.tsx`
- Test: `tests/unit/components/ReleasesView.test.tsx`, `tests/unit/components/NewReleaseModal.test.tsx`

**Interfaces:**
- Consumes: hooks (Task 7), `Modal` (existing, `{ title, onClose, children, footer?, wide? }`), `styles.module.css` classes (`subnav*`, `table`, `row`, `badge*`, `btnCancel`, `btnSubmit`, `formGroup`, `formLabel`, `formInput`, `formHint`, `errorMessage`, `warningMessage`, `preflightRow`, `preflightValue`, `preflightHighlight`, `statsStrip`, `statChip*`), `formatDateShort` from `@/lib/formatters`, `nanoid` for releaseId minting.
- Produces: routes `/admin/marketing/releases` (list) and `/admin/marketing/releases/:releaseId` (detail). Props: `ReleasesView` (none), `ReleaseDetail { releaseId: string }`, `NewReleaseModal { onClose(): void; onSuccess(releaseId: string): void }`.

- [ ] **Step 1: Write the failing component tests**

```tsx
// tests/unit/components/ReleasesView.test.tsx
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/admin/marketing/releases' }))
vi.mock('next/link', () => ({ default: ({ children, href }: never) => <a href={href}>{children}</a> }))

const hooks = vi.hoisted(() => ({
  useReleases: vi.fn(),
  useGateStatus: vi.fn(),
}))
vi.mock('@/hooks', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return { ...original, useReleases: hooks.useReleases, useGateStatus: hooks.useGateStatus }
})

import { ReleasesView } from '@/components/MarketingView/ReleasesView'

const release = {
  id: '1', releaseId: 'rel-1', name: 'August wave 2', type: 'waitlist',
  status: 'active', derivedStatus: 'active', grantedCount: 150, claimedCount: 113,
  quotaCount: null, expiresAt: '2026-08-15T00:00:00Z', releasedAt: '2026-08-01T00:00:00Z',
}

describe('ReleasesView', () => {
  test('shows gate-off banner when mode is open', () => {
    hooks.useReleases.mockReturnValue({ data: { docs: [release], totalDocs: 1, totalPages: 1, page: 1 }, isLoading: false, isError: false })
    hooks.useGateStatus.mockReturnValue({ data: { mode: 'open', setBy: null, changedAt: null } })
    render(<ReleasesView />)
    expect(screen.getByText(/gate is OFF/i)).toBeTruthy()
    expect(screen.getByText('August wave 2')).toBeTruthy()
  })

  test('no banner when gated; capacity summary shows unclaimed grants', () => {
    hooks.useReleases.mockReturnValue({ data: { docs: [release], totalDocs: 1, totalPages: 1, page: 1 }, isLoading: false, isError: false })
    hooks.useGateStatus.mockReturnValue({ data: { mode: 'gated', setBy: 'ops', changedAt: null } })
    render(<ReleasesView />)
    expect(screen.queryByText(/gate is OFF/i)).toBeNull()
    expect(screen.getByText(/37/)).toBeTruthy() // 150 granted − 113 claimed
  })
})
```

```tsx
// tests/unit/components/NewReleaseModal.test.tsx
import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: null }) }))

const mutations = vi.hoisted(() => ({
  preflight: { mutate: vi.fn(), data: undefined as unknown, isPending: false, isError: false, reset: vi.fn() },
  create: { mutate: vi.fn(), isPending: false, isError: false, error: null },
}))
vi.mock('@/hooks', () => ({
  useReleasePreflight: () => mutations.preflight,
  useCreateRelease: () => mutations.create,
}))

import { NewReleaseModal } from '@/components/MarketingView/NewReleaseModal'

describe('NewReleaseModal', () => {
  test('step 1 renders three type cards; SMS checkbox disabled for open quota', () => {
    render(<NewReleaseModal onClose={() => {}} onSuccess={() => {}} />)
    expect(screen.getByText('Waitlist')).toBeTruthy()
    expect(screen.getByText('Phone list')).toBeTruthy()
    expect(screen.getByText('Open quota')).toBeTruthy()
    fireEvent.click(screen.getByText('Open quota'))
    const sms = screen.getByLabelText(/send invite sms/i) as HTMLInputElement
    expect(sms.disabled).toBe(true)
  })

  test('continue runs preflight and shows the partition', async () => {
    mutations.preflight.mutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: (d: unknown) => void }) =>
      opts?.onSuccess?.({
        counts: {
          granted_sms: 131, granted_no_sms: 9, skipped_already_customer: 6,
          skipped_already_released: 3, skipped_needs_review: 1, skipped_invalid_number: 0,
        },
        total: 150,
      }),
    )
    render(<NewReleaseModal onClose={() => {}} onSuccess={() => {}} />)
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'August wave 3' } })
    fireEvent.change(screen.getByLabelText(/count/i), { target: { value: '150' } })
    fireEvent.click(screen.getByText(/continue/i))
    await waitFor(() => expect(screen.getByText(/131/)).toBeTruthy())
    expect(screen.getByText(/release 140 grants/i)).toBeTruthy() // 131 + 9
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/unit/components/ReleasesView.test.tsx tests/unit/components/NewReleaseModal.test.tsx --config ./vitest.config.mts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the components**

`ReleasesView.tsx` (structure — follow `CampaignsView.tsx` styling classes exactly):

```tsx
'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useGateStatus, useReleases } from '@/hooks'
import { formatDateShort } from '@/lib/formatters'
import { NewReleaseModal } from './NewReleaseModal'
import styles from './styles.module.css'

const TYPE_LABELS: Record<string, string> = {
  waitlist: 'Waitlist next-N',
  phone_list: 'Phone list',
  open_quota: 'Open quota',
}

export const ReleasesView: React.FC = () => {
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [showNew, setShowNew] = useState(false)
  const { data, isLoading, isError } = useReleases({ page })
  const { data: gate } = useGateStatus()
  const docs = data?.docs ?? []

  const active = docs.filter((d) => d.derivedStatus === 'active')
  const unclaimedGrants = active
    .filter((d) => d.type !== 'open_quota')
    .reduce((sum, d) => sum + Math.max((d.grantedCount ?? 0) - (d.claimedCount ?? 0), 0), 0)
  const quotaSlots = active
    .filter((d) => d.type === 'open_quota')
    .reduce((sum, d) => sum + Math.max((d.quotaCount ?? 0) - (d.claimedCount ?? 0), 0), 0)

  return (
    <div>
      {gate?.mode === 'open' && (
        <div className={styles.warningMessage} role="status">
          Application gate is OFF — releases are not being enforced. Turn it on with the gate
          CLI before relying on release volumes.
        </div>
      )}
      <div className={styles.statsStrip}>
        <div className={styles.statChip}>
          <span className={styles.statValue}>{unclaimedGrants.toLocaleString('en-AU')}</span>
          <span className={styles.statLabel}>Unclaimed grants</span>
        </div>
        <div className={styles.statChip}>
          <span className={styles.statValue}>{quotaSlots.toLocaleString('en-AU')}</span>
          <span className={styles.statLabel}>Open quota slots</span>
        </div>
        <button type="button" className={styles.btnSubmit} onClick={() => setShowNew(true)}>
          + New release
        </button>
      </div>
      <div className={styles.tableWrapper}>
        {isError ? (
          <div className={styles.emptyState}>Failed to load releases. Please retry.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th><th>Type</th><th>Status</th><th>Released</th>
                <th>Granted</th><th>Claimed</th><th>Remaining</th><th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && docs.length === 0 ? (
                <tr><td colSpan={8} className={styles.emptyCell}>Loading releases…</td></tr>
              ) : docs.length === 0 ? (
                <tr><td colSpan={8} className={styles.emptyCell}>No releases yet.</td></tr>
              ) : (
                docs.map((r) => {
                  const isQuota = r.type === 'open_quota'
                  const remaining = isQuota
                    ? `${Math.max((r.quotaCount ?? 0) - (r.claimedCount ?? 0), 0)} / ${r.quotaCount ?? 0}`
                    : String(Math.max((r.grantedCount ?? 0) - (r.claimedCount ?? 0), 0))
                  return (
                    <tr key={r.id} className={styles.row}
                        onClick={() => router.push(`/admin/marketing/releases/${r.releaseId}`)}>
                      <td>
                        <Link href={`/admin/marketing/releases/${r.releaseId}`}
                              className={styles.nameLink} onClick={(e) => e.stopPropagation()}>
                          {r.name ?? r.releaseId}
                        </Link>
                      </td>
                      <td>{TYPE_LABELS[r.type ?? ''] ?? r.type}</td>
                      <td><span className={styles.badge}>{r.derivedStatus}</span></td>
                      <td>{r.releasedAt ? formatDateShort(r.releasedAt) : '—'}</td>
                      <td>{isQuota ? '—' : (r.grantedCount ?? 0)}</td>
                      <td>{r.claimedCount ?? 0}</td>
                      <td>{r.derivedStatus === 'active' ? remaining : '0'}</td>
                      <td>{r.expiresAt ? formatDateShort(r.expiresAt) : '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>
      {showNew && (
        <NewReleaseModal
          onClose={() => setShowNew(false)}
          onSuccess={(releaseId) => {
            setShowNew(false)
            router.push(`/admin/marketing/releases/${releaseId}`)
          }}
        />
      )}
    </div>
  )
}

export default ReleasesView
```

`NewReleaseModal.tsx` — two-step modal (define → preflight/confirm), releaseId minted once with `nanoid()` on mount:

```tsx
'use client'

import React, { useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import { useCreateRelease, useReleasePreflight } from '@/hooks'
import type { CreateReleaseCommand } from '@/lib/schemas/releases'
import type { ReleasePreflightResult } from '@/hooks'
import { Modal } from './Modal'
import styles from './styles.module.css'

interface NewReleaseModalProps {
  onClose: () => void
  onSuccess: (releaseId: string) => void
}

type ReleaseTypeChoice = 'waitlist' | 'phone_list' | 'open_quota'

export const NewReleaseModal: React.FC<NewReleaseModalProps> = ({ onClose, onSuccess }) => {
  const releaseId = useMemo(() => `rel_${nanoid(12)}`, [])
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [type, setType] = useState<ReleaseTypeChoice>('waitlist')
  const [count, setCount] = useState('')
  const [mobilesRaw, setMobilesRaw] = useState('')
  const [expiryDays, setExpiryDays] = useState('14')
  const [sendInviteSms, setSendInviteSms] = useState(false)
  const [partition, setPartition] = useState<ReleasePreflightResult | null>(null)

  const preflight = useReleasePreflight()
  const create = useCreateRelease()

  const command = (): CreateReleaseCommand => ({
    releaseId,
    name: name.trim(),
    type,
    count: type === 'phone_list' ? undefined : Number(count),
    mobiles:
      type === 'phone_list'
        ? mobilesRaw.split('\n').map((l) => l.trim()).filter(Boolean)
        : undefined,
    expiryDays: Number(expiryDays) || 14,
    sendInviteSms: type === 'open_quota' ? false : sendInviteSms,
  })

  const canContinue =
    !!name.trim() &&
    (type === 'phone_list' ? mobilesRaw.trim().length > 0 : Number(count) >= 1) &&
    !preflight.isPending

  const handleContinue = () => {
    if (!canContinue) return
    preflight.mutate(command(), {
      onSuccess: (data) => {
        setPartition(data)
        setStep(2)
      },
    })
  }

  const grantedTotal = partition
    ? partition.counts.granted_sms + partition.counts.granted_no_sms
    : 0

  const handleRelease = () => {
    if (create.isPending) return
    create.mutate(command(), { onSuccess: (res) => onSuccess(res.releaseId) })
  }

  return (
    <Modal title={step === 1 ? 'New release — define' : 'New release — preflight & confirm'} onClose={onClose} wide>
      {step === 1 ? (
        <form onSubmit={(e) => { e.preventDefault(); handleContinue() }}>
          <div className={styles.modalBody}>
            {preflight.isError && (
              <div className={styles.errorMessage}>Could not compute the preflight. Try again.</div>
            )}
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="rel-name">Name</label>
              <input id="rel-name" autoFocus className={styles.formInput} value={name}
                     onChange={(e) => setName(e.target.value)} placeholder="e.g. August wave 3" />
            </div>
            <div className={styles.formGroup}>
              <span className={styles.formLabel}>Type</span>
              <div role="radiogroup" style={{ display: 'flex', gap: '0.5rem' }}>
                {([['waitlist', 'Waitlist'], ['phone_list', 'Phone list'], ['open_quota', 'Open quota']] as const).map(
                  ([value, label]) => (
                    <button key={value} type="button" role="radio" aria-checked={type === value}
                            className={type === value ? styles.btnSubmit : styles.btnCancel}
                            onClick={() => setType(value)}>
                      {label}
                    </button>
                  ),
                )}
              </div>
            </div>
            {type === 'phone_list' ? (
              <div className={styles.formGroup}>
                <label className={styles.formLabel} htmlFor="rel-mobiles">Mobile numbers (one per line)</label>
                <textarea id="rel-mobiles" className={styles.formInput} rows={6} value={mobilesRaw}
                          onChange={(e) => setMobilesRaw(e.target.value)} placeholder={'0400 000 001\n0400 000 002'} />
              </div>
            ) : (
              <div className={styles.formGroup}>
                <label className={styles.formLabel} htmlFor="rel-count">Count</label>
                <input id="rel-count" type="number" min={1} className={styles.formInput}
                       value={count} onChange={(e) => setCount(e.target.value)} />
              </div>
            )}
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="rel-expiry">Grant validity (days)</label>
              <input id="rel-expiry" type="number" min={1} max={90} className={styles.formInput}
                     value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="rel-sms">
                <input id="rel-sms" type="checkbox" checked={type !== 'open_quota' && sendInviteSms}
                       disabled={type === 'open_quota'}
                       onChange={(e) => setSendInviteSms(e.target.checked)} />{' '}
                Send invite SMS
              </label>
              <p className={styles.formHint}>
                Only contacts with marketing consent receive the SMS — the preflight shows who is
                excluded. Not available for open quota (no known recipients).
              </p>
            </div>
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnCancel} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.btnSubmit} disabled={!canContinue}>
              {preflight.isPending ? 'Checking…' : 'Continue → preflight'}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <div className={styles.modalBody}>
            {partition && (
              <>
                <div className={styles.preflightRow}>
                  <span>Will be granted and receive the invite SMS</span>
                  <span className={`${styles.preflightValue} ${styles.preflightHighlight}`}>
                    {partition.counts.granted_sms.toLocaleString('en-AU')}
                  </span>
                </div>
                <div className={styles.preflightRow}>
                  <span>Granted, no SMS (no marketing consent)</span>
                  <span className={styles.preflightValue}>{partition.counts.granted_no_sms.toLocaleString('en-AU')}</span>
                </div>
                <div className={styles.preflightRow}>
                  <span>Skipped — already a customer</span>
                  <span className={styles.preflightValue}>{partition.counts.skipped_already_customer.toLocaleString('en-AU')}</span>
                </div>
                <div className={styles.preflightRow}>
                  <span>Skipped — already in an active release</span>
                  <span className={styles.preflightValue}>{partition.counts.skipped_already_released.toLocaleString('en-AU')}</span>
                </div>
                <div className={styles.preflightRow}>
                  <span>Skipped — needs review</span>
                  <span className={styles.preflightValue}>{partition.counts.skipped_needs_review.toLocaleString('en-AU')}</span>
                </div>
                <div className={styles.preflightRow}>
                  <span>Skipped — invalid number</span>
                  <span className={styles.preflightValue}>{partition.counts.skipped_invalid_number.toLocaleString('en-AU')}</span>
                </div>
                {grantedTotal === 0 && (
                  <div className={styles.warningMessage} style={{ marginTop: '0.75rem' }}>
                    Nobody would be granted by this release.
                  </div>
                )}
                <p className={styles.formHint}>
                  Release {grantedTotal.toLocaleString('en-AU')} grants?
                  {command().sendInviteSms
                    ? ` This sends ${partition.counts.granted_sms.toLocaleString('en-AU')} SMS immediately.`
                    : ' No SMS will be sent.'}
                </p>
              </>
            )}
            {create.isError && (
              <div className={styles.errorMessage}>
                {create.error instanceof Error ? create.error.message : 'Failed to publish release'}
              </div>
            )}
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnCancel} onClick={() => setStep(1)}>← Back</button>
            <button type="button" className={styles.btnSubmit} onClick={handleRelease}
                    disabled={create.isPending || grantedTotal === 0 && type !== 'open_quota'}>
              {create.isPending ? 'Releasing…' : `Release ${grantedTotal ? `${grantedTotal} grants` : 'now'}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default NewReleaseModal
```

`ReleaseDetail.tsx` — stat tiles + grants table + typed-confirmation revoke (footer-prop Modal), masked mobiles NOT masked here (staff view; contacts grid already shows full mobiles). Structure mirrors `CampaignDetail.tsx`: header row (name, status badge, audit line, `Revoke release…` button), five `statChip`s (Granted / Claimed / Unclaimed / SMS sent / SMS failed — quota releases show Granted `—`), table (Mobile / Contact / Source / Status / SMS / Claimed) with pagination, syncing empty-state while `!release`. The revoke modal requires typing the release name to enable the confirm button (ux-standards irreversible-action pattern) and calls `useRevokeRelease().mutate({ releaseId, reason })`.

Wire the navigation:

- `MarketingSubnav.tsx` — add after Campaigns: `{ href: '/admin/marketing/releases', label: 'Releases', active: pathname.startsWith('/admin/marketing/releases') }`.
- `MarketingViewWithTemplate.tsx` — add `const releases = segments?.[1] === 'releases'` and `const releaseId = releases ? (segments?.[2] ?? '') : ''`; pass both to `<MarketingView releases={releases} releaseId={releaseId} … />`.
- `MarketingView.tsx` — extend props and dispatch before the campaigns branch: `if (releaseId) return <ReleaseDetail releaseId={releaseId} />` / `if (releases) return <ReleasesView />` (keep `MarketingSubnav` rendering consistent with how the campaigns branch does it).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run tests/unit/components/ReleasesView.test.tsx tests/unit/components/NewReleaseModal.test.tsx --config ./vitest.config.mts`
Expected: PASS (4 tests). Then `pnpm lint` and fix any prettier/eslint complaints.

- [ ] **Step 5: Commit**

```bash
git add src/components/MarketingView tests/unit/components
git commit -m "feat(releases): Releases tab — list, two-step release modal, detail with revoke"
```

---

### Task 9: Playwright happy path

**Files:**
- Test: `tests/e2e/releases.e2e.spec.ts`

**Interfaces:** consumes the running app; API responses stubbed via `page.route` so the e2e run needs no live Redis/billieChat.

- [ ] **Step 1: Write the e2e test**

Open an existing spec in `tests/e2e/` first and copy its login/bootstrap helper verbatim (auth setup differs per project). Then:

```ts
// tests/e2e/releases.e2e.spec.ts
import { test, expect } from '@playwright/test'
// + the repo's existing login helper import

test('marketing staff can walk the release flow to the preflight confirm', async ({ page }) => {
  // login as admin via the repo's existing helper …

  await page.route('**/api/marketing/releases/gate-status', (route) =>
    route.fulfill({ json: { mode: 'gated', setBy: 'ops', changedAt: null } }),
  )
  await page.route('**/api/marketing/releases?page=1', (route) =>
    route.fulfill({ json: { docs: [], totalDocs: 0, totalPages: 1, page: 1, hasNextPage: false, hasPrevPage: false } }),
  )
  await page.route('**/api/marketing/releases/preflight', (route) =>
    route.fulfill({
      json: {
        counts: {
          granted_sms: 131, granted_no_sms: 9, skipped_already_customer: 6,
          skipped_already_released: 3, skipped_needs_review: 1, skipped_invalid_number: 0,
        },
        total: 150,
      },
    }),
  )

  await page.goto('/admin/marketing/releases')
  await expect(page.getByRole('link', { name: 'Releases' })).toBeVisible()

  await page.getByRole('button', { name: '+ New release' }).click()
  await page.getByLabel('Name').fill('August wave 3')
  await page.getByLabel('Count').fill('150')
  await page.getByRole('button', { name: /continue/i }).click()

  await expect(page.getByText('131')).toBeVisible()
  await expect(page.getByRole('button', { name: /release 140 grants/i })).toBeVisible()
})
```

- [ ] **Step 2: Run it**

Run: `pnpm exec playwright test tests/e2e/releases.e2e.spec.ts`
Expected: PASS (against the dev server the e2e config boots).

- [ ] **Step 3: Full suite + commit**

Run: `pnpm test:int` (full unit+int) and `cd event-processor && python -m pytest -v`.
Expected: all green.

```bash
git add tests/e2e/releases.e2e.spec.ts
git commit -m "test(releases): e2e happy path through the release preflight"
```

---

## Self-review checklist (run after Task 9)

1. **Spec coverage:** contracts (T1), projections + natural key + migration (T2), all five inbound/own-event handlers (T3), dual publish (T4), one shared partition for preflight + release (T5), routes incl. gate-status (T6), hooks with lag tolerance + failed-action capture (T7), Releases tab + modal + detail + gate-off banner (T8), e2e (T9), bare-4 normalisation fix (T1).
2. **Cross-plan contract check:** payload field names in T1/T6 (`release_id`, `mobile_e164`, `send_sms`, `quota_count`, `expires_at`, `skipped.*`) must match the billieChat Pydantic models in the companion plan — they do; the `skipped` object is CRM-only and ignored by billieChat.
3. **Type consistency:** `ReleaseBucket` names used in T5/T6/T7/T8 match; grant `source` maps `quota` (wire) → `quota_claim` (projection) in T3 only.
4. **Deliberate scope cuts:** no maker-checker approval on releases (canMarketing suffices per spec); no per-release edit after publish (revoke + new release instead); `release-gate-status` row is written only from facts (CLI lives in billieChat).
