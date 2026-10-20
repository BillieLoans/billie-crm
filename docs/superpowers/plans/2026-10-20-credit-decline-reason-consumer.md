# Credit Decline Reason — Consumer (billie-crm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The CRM decision banner always answers "why was this declined?": a human-readable label for every reason code the chat now emits, the supporting evidence from `decision_metadata`, and an explicit "reason not recorded" for rows that predate the producer change.

**Architecture:** The event processor already projects `final_credit_decision.reason` into `decision_detail_reason`. This plan adds one jsonb column (`decision_metadata`) written with `merge_jsonb` so redeliveries are additive, exposes it through the Payload collection, the API route and the Zod schema, and adds a small `decisionReason` lib (label map + evidence rows) that the `DecisionBanner` renders. A structured warning fires when a `DECLINED` event arrives with no reason.

**Tech Stack:** Next.js / Payload CMS (Postgres), TypeScript, Zod, vitest + testing-library; event processor is Python 3.12 + asyncpg + pytest.

**Spec:** `/Users/rohansharp/workspace/billieChat/docs/superpowers/specs/2026-08-14-credit-decision-metadata-design.md` — read the "Consumer design" section and the 2026-10-20 addendum (items 7 and 8). Producer plan: `/Users/rohansharp/workspace/billieChat/docs/superpowers/plans/2026-10-20-credit-decline-reason-producer.md`.

Note: per spec addendum item 9, `decision_metadata` carries no free-text rationale; evidence rows are account labels, institutions, classifier id, failed components and incident details.

**Tracking:** Jira BTB-462.

## Global Constraints

- Paths are relative to `/Users/rohansharp/workspace/billie-crm`.
- Frontend tests: `pnpm exec vitest run --config ./vitest.config.mts <file>`; typecheck: `pnpm run typecheck`; lint: `pnpm run lint`. Event processor tests: `event-processor/venv/bin/python -m pytest event-processor/tests/<file> -v` (run from the repo root; `event-processor/pyproject.toml` sets `testpaths`).
- `decision_metadata` is written only with `merge_jsonb` (`event-processor/src/billie_servicing/db.py:179`), **after** `upsert_conversation`, so a first event for a conversation never updates a missing row and a legacy redelivery never wipes detail.
- Never render `accountHolder` or any free-text error message; the producer does not send them, and the banner must not grow a generic "dump the JSON" fallback that would if a future field did.
- Unknown reason codes render as the raw code (same fallback rule as `formatBlockReason`).
- Branch: `feat/btb-462-decline-reason-consumer` off `main`.
- Commit messages end with the attribution lines in the session's system reminder.

## Review Focus

1. A `DECLINED` event whose `reason` is `REAPPLICATION_BLOCK:*` must keep today's rich block rendering and must not also render the new generic evidence rows (Task 5).
2. A `DECLINED` row with `decision_detail_reason` null (projected before the producer shipped) must read "✗ Declined · reason not recorded", never a bare "✗ Declined" (Task 5).
3. A redelivered legacy `final_credit_decision` without `decision_metadata` must not null out metadata already stored (Task 1).
4. A `decision_metadata.account_names` list containing `null` entries (an account with no product name) must render without crashing and without printing "null" (Task 4).
5. An `APPROVED` event must write nothing to `decision_metadata` and emit no warning (Task 1).

---

### Task 1: Event processor projects `decision_metadata` and warns on reasonless declines

**Files:**
- Modify: `event-processor/src/billie_servicing/handlers/conversation.py` (`handle_final_decision`, roughly lines 783–845)
- Test: `event-processor/tests/test_final_decision_metadata.py`

**Interfaces:**
- Consumes: `merge_jsonb(target, table, *, column, key_column, key_value, patch, bump_version=False)` from `..db` (already imported in this module); `MockPool.jsonb_merges(table, column)` and `MockPool.last_insert(table)` from `event-processor/tests/conftest.py`.
- Produces: column `conversations.decision_metadata jsonb` (DDL lands in Task 2; the handler test uses the mock pool so it does not need the column to exist).

- [ ] **Step 1: Write the failing tests**

```python
"""final_credit_decision → decision_metadata projection + reasonless-decline warning (BTB-462)."""

import json

import pytest
import structlog
from structlog.testing import capture_logs

from billie_servicing.handlers.conversation import handle_final_decision


def _event(payload: dict) -> dict:
    return {"cid": "CONV-META-001", "payload": payload}


@pytest.mark.asyncio
async def test_decline_with_metadata_merges_jsonb(mock_pool):
    """Metadata lands in decision_metadata via merge_jsonb (additive)."""
    await handle_final_decision(
        mock_pool,
        _event(
            {
                "application_number": "40089601-594",
                "decision": "DECLINED",
                "reason": "BUSINESS_ACCOUNT",
                "retry_eligible": True,
                "incident_ref": None,
                "decision_metadata": {
                    "component": "personal_account_check",
                    "account_names": ["Business Trans Acct"],
                },
            }
        ),
    )
    doc = mock_pool.last_insert("conversations")
    assert doc["decision_detail_reason"] == "BUSINESS_ACCOUNT"
    assert doc["decision_detail_retry_eligible"] is True
    merges = mock_pool.jsonb_merges("conversations", "decision_metadata")
    assert merges == [
        {
            "component": "personal_account_check",
            "account_names": ["Business Trans Acct"],
        }
    ]


@pytest.mark.asyncio
async def test_metadata_written_after_upsert(mock_pool):
    """Review focus 3 / ordering: the row must exist before the plain UPDATE merge."""
    await handle_final_decision(
        mock_pool,
        _event({"decision": "DECLINED", "reason": "X", "decision_metadata": {"a": 1}}),
    )
    ops = [c.op for c in mock_pool.calls_against("conversations")]
    assert ops.index("INSERT") < ops.index("UPDATE")


@pytest.mark.asyncio
async def test_legacy_redelivery_does_not_touch_metadata(mock_pool):
    """Review focus 3: no decision_metadata in payload → no merge call at all."""
    await handle_final_decision(mock_pool, _event({"decision": "DECLINED", "reason": "X"}))
    assert mock_pool.jsonb_merges("conversations", "decision_metadata") == []


@pytest.mark.asyncio
async def test_empty_metadata_object_is_not_written(mock_pool):
    """An empty dict is treated as absent (keeps NULL meaning 'nothing recorded')."""
    await handle_final_decision(
        mock_pool, _event({"decision": "DECLINED", "reason": "X", "decision_metadata": {}})
    )
    assert mock_pool.jsonb_merges("conversations", "decision_metadata") == []


@pytest.mark.asyncio
async def test_approved_writes_no_metadata_and_no_warning(mock_pool):
    """Review focus 5."""
    with capture_logs() as logs:
        await handle_final_decision(mock_pool, _event({"decision": "APPROVED"}))
    assert mock_pool.jsonb_merges("conversations", "decision_metadata") == []
    assert not [l for l in logs if l.get("event") == "final_credit_decision DECLINED without reason"]


@pytest.mark.asyncio
async def test_reasonless_decline_logs_structured_warning(mock_pool):
    """Observability: a reasonless DECLINED is a producer contract breach — warn loudly."""
    with capture_logs() as logs:
        await handle_final_decision(
            mock_pool, _event({"application_number": "APP-1", "decision": "DECLINED"})
        )
    warnings = [l for l in logs if l.get("event") == "final_credit_decision DECLINED without reason"]
    assert len(warnings) == 1
    assert warnings[0]["log_level"] == "warning"
    assert warnings[0]["conversation_id"] == "CONV-META-001"
    assert warnings[0]["application_number"] == "APP-1"
```

If `capture_logs` does not see the module logger because the test config binds a non-structlog logger, check how `event-processor/tests/test_reapplication_and_identity_verification.py` or `conftest.py` asserts on logs and mirror that. The assertion that matters is: exactly one warning with that event name.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `event-processor/venv/bin/python -m pytest event-processor/tests/test_final_decision_metadata.py -v`
Expected: `test_decline_with_metadata_merges_jsonb`, `test_metadata_written_after_upsert`, `test_reasonless_decline_logs_structured_warning` FAIL; the "no write" tests pass trivially.

- [ ] **Step 3: Implement**

In `handle_final_decision`, after the existing `await upsert_conversation(...)` call and before the final `log.info("Final decision recorded", status=status)`:

```python
    # BTB-462: non-PII evidence for the decision. merge_jsonb is additive, so
    # a legacy redelivery (no metadata) cannot wipe what an earlier event
    # stored. It is a plain UPDATE, so it MUST follow upsert_conversation.
    metadata = payload_dict.get("decision_metadata")
    if isinstance(metadata, dict) and metadata:
        await merge_jsonb(
            pool,
            "conversations",
            column="decision_metadata",
            key_column="conversation_id",
            key_value=conversation_id,
            patch=metadata,
            bump_version=True,
        )

    if decision == "DECLINED" and not reason:
        # Producer contract breach (every DECLINED carries a reason since
        # BTB-462). Warn so it is visible in Logfire rather than discovered
        # by a staff member looking at a bare "Declined".
        log.warning(
            "final_credit_decision DECLINED without reason",
            application_number=payload_dict.get("application_number"),
        )
```

`reason` is the local already assigned a few lines above (`reason = payload_dict.get("reason")`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `event-processor/venv/bin/python -m pytest event-processor/tests/test_final_decision_metadata.py event-processor/tests/test_reapplication_and_identity_verification.py -v`
Expected: all pass (the existing `TestFinalDecisionDetail` tests must be unaffected).

- [ ] **Step 5: Commit**

```bash
git add event-processor/src/billie_servicing/handlers/conversation.py event-processor/tests/test_final_decision_metadata.py
git commit -m "feat(event-processor): project decision_metadata and warn on reasonless declines (BTB-462)"
```

---

### Task 2: Column, Payload field, migration

**Files:**
- Modify: `src/collections/Conversations.ts` (insert after the `decisionDetail` group, around line 277–305)
- Create: `src/migrations/20261020_090000_conversation_decision_metadata.ts`
- Modify: `src/migrations/index.ts` (import + array entry at the end)
- Modify: `src/payload-types.ts` (regenerate)

**Interfaces:**
- Produces: `conversations.decision_metadata jsonb` column; Payload field `decisionMetadata` (type `json`, read-only) on the `conversations` collection; `doc.decisionMetadata` available to the API route in Task 3.

- [ ] **Step 1: Add the collection field**

Immediately after the `decisionDetail` group object in `src/collections/Conversations.ts`:

```ts
    {
      // BTB-462: non-PII evidence behind a decline, keyed by `component`
      // (e.g. personal_account_check → account_names, institutions,
      // classifier; serviceability → reason_code, decided_at, detail_location;
      // system failures → error_type / missing_components). Written by the
      // event processor with an additive jsonb merge.
      name: 'decisionMetadata',
      type: 'json',
      admin: {
        readOnly: true,
        description: 'Decline evidence from final_credit_decision.decision_metadata (BTB-462)',
      },
    },
```

- [ ] **Step 2: Write the migration**

`src/migrations/20261020_090000_conversation_decision_metadata.ts`:

```ts
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * BTB-462: decision_metadata — non-PII evidence behind a credit decline,
 * projected from final_credit_decision.decision_metadata by the event
 * processor (additive jsonb merge).
 *
 * Mirrors the DDL Payload's push generates for the collection config.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "decision_metadata" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "decision_metadata";`)
}
```

- [ ] **Step 3: Register it**

In `src/migrations/index.ts` add the import next to the others:

```ts
import * as migration_20261020_090000_conversation_decision_metadata from './20261020_090000_conversation_decision_metadata';
```

and append to the exported array (after the `20261006_090000_conversation_network` entry):

```ts
  {
    up: migration_20261020_090000_conversation_decision_metadata.up,
    down: migration_20261020_090000_conversation_decision_metadata.down,
    name: '20261020_090000_conversation_decision_metadata',
  },
```

- [ ] **Step 4: Regenerate types and typecheck**

Run: `pnpm exec payload generate:types && pnpm run typecheck`
Expected: `src/payload-types.ts` gains `decisionMetadata?: ... | null` on the `Conversation` interface; typecheck clean. (If the generate script has a different name in `package.json`, use `rg -n "generate:types" package.json` to find it.)

- [ ] **Step 5: Commit**

```bash
git add src/collections/Conversations.ts src/migrations/20261020_090000_conversation_decision_metadata.ts src/migrations/index.ts src/payload-types.ts
git commit -m "feat(crm): decision_metadata column + Payload field (BTB-462)"
```

---

### Task 3: API route and Zod schema expose `decisionMetadata`

**Files:**
- Modify: `src/lib/schemas/conversations.ts` (`DecisionDetailSchema` at ~98 and `ConversationDetailSchema` at ~321)
- Modify: `src/app/api/conversations/[conversationId]/route.ts` (~120 and ~188)
- Test: `tests/unit/lib/conversation-schema.test.ts`

**Interfaces:**
- Produces: `ConversationDetail.decisionMetadata?: Record<string, unknown> | null` and `DecisionMetadataSchema`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/conversation-schema.test.ts
import { describe, it, expect } from 'vitest'
import { ConversationDetailSchema } from '@/lib/schemas/conversations'

// `conversationId` is the schema's only required field.
const base = { conversationId: 'conv-1' }

describe('ConversationDetailSchema.decisionMetadata', () => {
  it('accepts an open evidence object', () => {
    const parsed = ConversationDetailSchema.parse({
      ...base,
      finalDecision: 'DECLINED',
      decisionDetail: { reason: 'BUSINESS_ACCOUNT' },
      decisionMetadata: {
        component: 'personal_account_check',
        account_names: ['Business Trans Acct', null],
      },
    })
    expect(parsed.decisionMetadata?.component).toBe('personal_account_check')
  })

  it('accepts null and absent', () => {
    expect(ConversationDetailSchema.parse({ ...base, decisionMetadata: null }).decisionMetadata).toBeNull()
    expect(ConversationDetailSchema.parse(base).decisionMetadata).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/unit/lib/conversation-schema.test.ts`
Expected: FAIL — `decisionMetadata` is stripped (Zod drops unknown keys), so `parsed.decisionMetadata` is `undefined`.

- [ ] **Step 3: Add the schema and wire the route**

In `src/lib/schemas/conversations.ts`, after `DecisionDetailSchema`:

```ts
/** Non-PII evidence behind a decline (final_credit_decision.decision_metadata, BTB-462). */
export const DecisionMetadataSchema = z.record(z.string(), z.unknown())
export type DecisionMetadata = z.infer<typeof DecisionMetadataSchema>
```

and in `ConversationDetailSchema`, after `decisionDetail`:

```ts
  decisionMetadata: DecisionMetadataSchema.nullable().optional(),
```

In the route, next to the `decisionDetail` read (~line 120):

```ts
    const decisionMetadata = (doc.decisionMetadata as Record<string, unknown> | null | undefined) ?? null
```

and in the response object after `decisionDetail: decisionDetail ?? null,`:

```ts
      decisionMetadata,
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/unit/lib/conversation-schema.test.ts && pnpm run typecheck`
Expected: 2 passed; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas/conversations.ts "src/app/api/conversations/[conversationId]/route.ts" tests/unit/lib/conversation-schema.test.ts
git commit -m "feat(crm): expose decisionMetadata on the conversation detail API (BTB-462)"
```

---

### Task 4: `decisionReason` lib — labels and evidence rows

**Files:**
- Create: `src/lib/decisionReason.ts`
- Test: `tests/unit/lib/decision-reason.test.ts`

**Interfaces:**
- Produces:
  - `formatDecisionReason(code: string | null | undefined): string` — staff label; `'reason not recorded'` for null/empty; raw code for unknown.
  - `decisionEvidenceRows(metadata: Record<string, unknown> | null | undefined): Array<{ label: string; value: string }>` — ordered, human rows; empty array when nothing renderable.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/lib/decision-reason.test.ts
import { describe, it, expect } from 'vitest'
import { formatDecisionReason, decisionEvidenceRows } from '@/lib/decisionReason'

describe('formatDecisionReason', () => {
  it('labels the fixed codes', () => {
    expect(formatDecisionReason('BUSINESS_ACCOUNT')).toBe('Business account detected')
    expect(formatDecisionReason('PERSONAL_CHECK_FAILED')).toBe('Personal-account check failed (system)')
    expect(formatDecisionReason('NO_PERSONAL_ACCOUNT')).toBe('No personal account shared')
    expect(formatDecisionReason('CREDIT_ASSESSMENT:FINAL_RULE')).toBe('Final decision rule')
  })

  it('labels the prefixed families', () => {
    expect(formatDecisionReason('CREDIT_ASSESSMENT:SERVICEABILITY')).toBe('Serviceability')
    expect(formatDecisionReason('CREDIT_ASSESSMENT:ACCOUNT_CONDUCT')).toBe('Account conduct')
    expect(formatDecisionReason('CREDIT_ASSESSMENT:IDENTITYRISK_ASSESSMENT')).toBe('Identity risk')
    expect(formatDecisionReason('CREDIT_ASSESSMENT:POST_IDENTITY_RISK_CHECKS')).toBe('Post-IDV checks')
    expect(formatDecisionReason('SYSTEM_FAILURE:account_conduct')).toBe('System failure · account conduct')
    expect(formatDecisionReason('G5_TIMEOUT:serviceability,account_conduct')).toBe(
      'Assessment timed out · serviceability, account conduct',
    )
    expect(formatDecisionReason('REAPPLICATION_BLOCK:ID_VERIFICATION')).toBe('Re-application block')
  })

  it('falls back to the raw code and to "reason not recorded"', () => {
    expect(formatDecisionReason('SOMETHING_NEW')).toBe('SOMETHING_NEW')
    expect(formatDecisionReason('CREDIT_ASSESSMENT:NEW_THING')).toBe('NEW_THING')
    expect(formatDecisionReason(null)).toBe('reason not recorded')
    expect(formatDecisionReason('')).toBe('reason not recorded')
  })
})

describe('decisionEvidenceRows', () => {
  it('renders personal-account-check evidence, skipping null names', () => {
    expect(
      decisionEvidenceRows({
        component: 'personal_account_check',
        account_names: ['Business Trans Acct', null, 'Everyday'],
        institutions: ['CBA', null],
        classifier: 'gpt-5.6-luna',
      }),
    ).toEqual([
      { label: 'Accounts', value: 'Business Trans Acct, Everyday' },
      { label: 'Institutions', value: 'CBA' },
      { label: 'Classifier', value: 'gpt-5.6-luna' },
    ])
  })

  it('renders per-account labels from the gate v2 metadata', () => {
    expect(
      decisionEvidenceRows({
        component: 'personal_account_check',
        gate: 'v2',
        accounts: [
          { product: 'ANZ Business Essentials', label: 'business', rule: 'product_name', matched: 'business' },
        ],
      }),
    ).toEqual([{ label: 'Account', value: 'ANZ Business Essentials — business (product name)' }])
  })

  it('renders a fail-closed personal check', () => {
    expect(
      decisionEvidenceRows({
        component: 'personal_account_check',
        failure_mode: 'empty_accounts',
        detected_format: 'BASIQ',
      }),
    ).toEqual([
      { label: 'Failure', value: 'empty_accounts' },
      { label: 'Report format', value: 'BASIQ' },
    ])
  })

  it('renders credit-assessment evidence', () => {
    expect(
      decisionEvidenceRows({
        component: 'serviceability',
        reason_code: 'SERVICEABILITY',
        decided_at: '2026-10-19T04:46:12+00:00',
        detail_location: 's3://bucket/serviceability.json',
        declined_components: ['serviceability', 'account_conduct'],
      }),
    ).toEqual([
      { label: 'Failed checks', value: 'serviceability, account conduct' },
      { label: 'Decided', value: '2026-10-19T04:46:12+00:00' },
    ])
  })

  it('renders system-failure and timeout evidence', () => {
    expect(
      decisionEvidenceRows({ component: 'account_conduct', error_type: 'TimeoutError' }),
    ).toEqual([{ label: 'Error', value: 'TimeoutError' }])
    expect(
      decisionEvidenceRows({ component: 'g5_timeout_guard', missing_components: ['serviceability'] }),
    ).toEqual([{ label: 'Missing', value: 'serviceability' }])
  })

  it('returns no rows for null, empty or unknown shapes', () => {
    expect(decisionEvidenceRows(null)).toEqual([])
    expect(decisionEvidenceRows({})).toEqual([])
    expect(decisionEvidenceRows({ component: 'mystery', secret: 'x' })).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/unit/lib/decision-reason.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/decisionReason.ts
/**
 * Decline-reason helpers (BTB-462).
 *
 * `final_credit_decision.reason` is one of a small set of fixed codes or a
 * prefixed family (`CREDIT_ASSESSMENT:*`, `SYSTEM_FAILURE:*`, `G5_TIMEOUT:*`,
 * `REAPPLICATION_BLOCK:*`). Block-declines keep their own rich rendering
 * (see DecisionBanner / reapplicationBlock.ts); this module labels everything
 * and turns `decision_metadata` into staff-readable rows.
 *
 * Evidence rows are an allow-list keyed by `component`. Never dump unknown
 * keys: the metadata contract forbids PII, but a renderer that printed
 * arbitrary fields would make a future producer slip visible to staff.
 */

const FIXED_LABELS: Record<string, string> = {
  BUSINESS_ACCOUNT: 'Business account detected',
  PERSONAL_CHECK_FAILED: 'Personal-account check failed (system)',
  NO_PERSONAL_ACCOUNT: 'No personal account shared',
  'CREDIT_ASSESSMENT:FINAL_RULE': 'Final decision rule',
}

const COMPONENT_LABELS: Record<string, string> = {
  SERVICEABILITY: 'Serviceability',
  ACCOUNT_CONDUCT: 'Account conduct',
  IDENTITYRISK_ASSESSMENT: 'Identity risk',
  POST_IDENTITY_RISK_CHECKS: 'Post-IDV checks',
}

export const REASON_NOT_RECORDED = 'reason not recorded'

function humaniseComponent(name: string): string {
  return name.replace(/_/g, ' ')
}

export function formatDecisionReason(code: string | null | undefined): string {
  if (!code) return REASON_NOT_RECORDED
  if (FIXED_LABELS[code]) return FIXED_LABELS[code]
  if (code.startsWith('REAPPLICATION_BLOCK:')) return 'Re-application block'
  if (code.startsWith('CREDIT_ASSESSMENT:')) {
    const key = code.slice('CREDIT_ASSESSMENT:'.length)
    return COMPONENT_LABELS[key] ?? key
  }
  if (code.startsWith('SYSTEM_FAILURE:')) {
    return `System failure · ${humaniseComponent(code.slice('SYSTEM_FAILURE:'.length))}`
  }
  if (code.startsWith('G5_TIMEOUT:')) {
    const parts = code
      .slice('G5_TIMEOUT:'.length)
      .split(',')
      .filter(Boolean)
      .map(humaniseComponent)
    return `Assessment timed out · ${parts.join(', ')}`
  }
  return code
}

export interface EvidenceRow {
  label: string
  value: string
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function decisionEvidenceRows(
  metadata: Record<string, unknown> | null | undefined,
): EvidenceRow[] {
  if (!metadata) return []
  const rows: EvidenceRow[] = []
  const push = (label: string, value: string | null) => {
    if (value) rows.push({ label, value })
  }

  const component = str(metadata.component)
  if (component === 'personal_account_check') {
    const names = strings(metadata.account_names)
    const institutions = strings(metadata.institutions)
    // Gate v2: one row per labelled account (BTB-498); skip non-object entries.
    if (Array.isArray(metadata.accounts)) {
      for (const a of metadata.accounts) {
        if (!a || typeof a !== 'object') continue
        const acc = a as Record<string, unknown>
        push(
          'Account',
          `${acc.product ?? '—'} — ${acc.label}${acc.rule ? ` (${String(acc.rule).replace(/_/g, ' ')})` : ''}`,
        )
      }
    }
    push('Accounts', names.length ? names.join(', ') : null)
    push('Institutions', institutions.length ? institutions.join(', ') : null)
    push('Classifier', str(metadata.classifier))
    push('Failure', str(metadata.failure_mode))
    push('Report format', str(metadata.detected_format))
    push('Error', str(metadata.error_type))
    return rows
  }

  if (component === 'g5_timeout_guard') {
    const missing = strings(metadata.missing_components).map(humaniseComponent)
    push('Missing', missing.length ? missing.join(', ') : null)
    return rows
  }

  if (component === 'final_decision_rule') {
    const decisions = metadata.component_decisions
    if (decisions && typeof decisions === 'object') {
      const pairs = Object.entries(decisions as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => `${humaniseComponent(k)}: ${String(v).toLowerCase()}`)
      push('Component results', pairs.length ? pairs.join(' · ') : null)
    }
    return rows
  }

  if (component) {
    // CREDIT_ASSESSMENT:* and SYSTEM_FAILURE:* share the component-keyed shape.
    const failed = strings(metadata.declined_components).map(humaniseComponent)
    push('Failed checks', failed.length ? failed.join(', ') : null)
    push('Decided', str(metadata.decided_at))
    push('Error', str(metadata.error_type))
    return rows
  }

  return rows
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/unit/lib/decision-reason.test.ts`
Expected: all pass. The `detail_location` S3 key is deliberately not rendered (staff cannot open it from the browser; the serviceability drawer already links the full report).

- [ ] **Step 5: Commit**

```bash
git add src/lib/decisionReason.ts tests/unit/lib/decision-reason.test.ts
git commit -m "feat(crm): decline reason labels and evidence rows (BTB-462)"
```

---

### Task 5: `DecisionBanner` always shows a reason

**Files:**
- Modify: `src/components/ConversationDetailView/DecisionBanner/index.tsx` (the `// DECLINED — answer "why?"` block near the end of `DecisionBanner`)
- Modify: `tests/unit/ui/decision-banner.test.tsx`

**Interfaces:**
- Consumes: `formatDecisionReason`, `decisionEvidenceRows` (Task 4); `conversation.decisionMetadata` (Task 3).
- Produces: headline `✗ Declined · <label>`; for a legacy row `✗ Declined · reason not recorded`; an evidence block with `data-testid="decision-evidence"` when rows exist. Block-declines are unchanged.

- [ ] **Step 1: Update the existing test and add new ones**

In `tests/unit/ui/decision-banner.test.tsx`, replace the test `legacy decline (no reason) renders the banner only` with:

```tsx
  test('legacy decline (no reason) says the reason was not recorded', () => {
    render(<DecisionBanner conversation={createConversation({ finalDecision: 'DECLINED' })} />)
    expect(screen.getByText('✗ Declined · reason not recorded')).toBeInTheDocument()
    expect(screen.queryByTestId('decision-evidence')).not.toBeInTheDocument()
  })
```

replace `assessment-based decline shows the raw reason in the headline` with:

```tsx
  test('credit-assessment decline shows the staff label', () => {
    render(
      <DecisionBanner
        conversation={createConversation({
          finalDecision: 'DECLINED',
          decisionDetail: { reason: 'CREDIT_ASSESSMENT:SERVICEABILITY' },
          decisionMetadata: {
            component: 'serviceability',
            declined_components: ['serviceability'],
            decided_at: '2026-10-19T04:46:12+00:00',
          },
        })}
      />,
    )
    expect(screen.getByText('✗ Declined · Serviceability')).toBeInTheDocument()
    const evidence = screen.getByTestId('decision-evidence')
    expect(evidence).toHaveTextContent('Failed checks')
    expect(evidence).toHaveTextContent('serviceability')
  })

  test('business-account decline shows the classifier evidence', () => {
    render(
      <DecisionBanner
        conversation={createConversation({
          finalDecision: 'DECLINED',
          decisionDetail: { reason: 'BUSINESS_ACCOUNT', retryEligible: true },
          decisionMetadata: {
            component: 'personal_account_check',
            account_names: ['Business Trans Acct', null],
            institutions: ['CBA'],
                classifier: 'gpt-5.6-luna',
          },
        })}
      />,
    )
    expect(screen.getByText('✗ Declined · Business account detected')).toBeInTheDocument()
    const evidence = screen.getByTestId('decision-evidence')
    expect(evidence).toHaveTextContent('Business Trans Acct')
    expect(evidence).not.toHaveTextContent('null')
    expect(evidence).toHaveTextContent('CBA')
    expect(screen.getByText('Customer may re-apply with a personal account')).toBeInTheDocument()
  })

  test('no-personal-account decline shows the re-apply hint', () => {
    render(
      <DecisionBanner
        conversation={createConversation({
          finalDecision: 'DECLINED',
          decisionDetail: { reason: 'NO_PERSONAL_ACCOUNT', retryEligible: true },
        })}
      />,
    )
    expect(screen.getByText('✗ Declined · No personal account shared')).toBeInTheDocument()
    expect(screen.getByText('Customer may re-apply with a personal account')).toBeInTheDocument()
  })

  test('unknown code falls back to the raw code', () => {
    render(
      <DecisionBanner
        conversation={createConversation({
          finalDecision: 'DECLINED',
          decisionDetail: { reason: 'SOMETHING_NEW' },
        })}
      />,
    )
    expect(screen.getByText('✗ Declined · SOMETHING_NEW')).toBeInTheDocument()
  })
```

Then in the existing test `renders block headline and humanized reason` (around line 96, inside the block-decline `describe`) add one assertion at the end:

```tsx
    expect(screen.queryByTestId('decision-evidence')).not.toBeInTheDocument()
```

(Review focus 1: block-declines keep their own detail and must not grow the generic evidence block.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/unit/ui/decision-banner.test.tsx`
Expected: the four new/changed tests FAIL (`✗ Declined` rendered bare, no evidence block, raw code in headline).

- [ ] **Step 3: Implement**

Add the import at the top of `DecisionBanner/index.tsx`:

```tsx
import { decisionEvidenceRows, formatDecisionReason } from '@/lib/decisionReason'
```

Replace the `// DECLINED — answer "why?"` block to the end of the `DecisionBanner` function:

```tsx
  // DECLINED — answer "why?". Block-declines keep their rich detail; every
  // other decline shows the staff label for its reason code, the evidence the
  // chat attached, and an explicit "reason not recorded" for rows projected
  // before the producer carried a reason (BTB-462).
  const headline = isBlockDecline
    ? '✗ Declined · Re-application block'
    : `✗ Declined · ${formatDecisionReason(decisionDetail?.reason)}`
  const evidence = isBlockDecline ? [] : decisionEvidenceRows(conversation.decisionMetadata)
  const retryHint =
    !isBlockDecline &&
    (decisionDetail?.reason === 'BUSINESS_ACCOUNT' ||
      decisionDetail?.reason === 'NO_PERSONAL_ACCOUNT') &&
    decisionDetail.retryEligible
      ? 'Customer may re-apply with a personal account'
      : !isBlockDecline && decisionDetail?.retryEligible
        ? 'System fault — customer may be retried'
        : null

  return (
    <div className={`${styles.banner} ${styles.declined}`} data-testid="decision-banner">
      <span className={styles.headline}>{headline}</span>
      {retryHint && <span className={styles.subhead}>{retryHint}</span>}
      {evidence.length > 0 && (
        <div className={styles.detail} data-testid="decision-evidence">
          {evidence.map((row, i) => (
            <div key={`${row.label}-${i}`} className={styles.detailRow}>
              <span className={styles.detailLabel}>{row.label}</span>
              <span className={styles.detailValue}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
      {isBlockDecline && <BlockDetail conversation={conversation} block={block} />}
      {isBlockDecline && (
        <ClearBlockButton
          block={block}
          conversationId={conversation.conversationId}
          customerName={conversation.customer?.fullName ?? undefined}
        />
      )}
    </div>
  )
}
```

Update the component docstring's `DECLINED` bullet to: "red, with the decline reason label; non-block declines also render `decisionMetadata` evidence rows, and a row with no recorded reason reads 'reason not recorded'."

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm exec vitest run --config ./vitest.config.mts tests/unit/ui/decision-banner.test.tsx tests/unit/lib/decision-reason.test.ts tests/unit/lib/reapplication-block.test.ts && pnpm run typecheck && pnpm run lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/components/ConversationDetailView/DecisionBanner/index.tsx tests/unit/ui/decision-banner.test.tsx
git commit -m "feat(crm): decision banner always shows a decline reason + evidence (BTB-462)"
```

---

### Task 6: Finish the branch

- [ ] **Step 1: Full verification**

```bash
pnpm run lint && pnpm run typecheck && pnpm run test:int && pnpm run test:int:check-count
event-processor/venv/bin/python -m pytest event-processor/tests -q
```
Expected: all green. If `test:int:check-count` fails because the expected test count moved, follow the message in `scripts/check-test-count.mjs` to bump the floor (the suite gained tests; it must never lose them).

- [ ] **Step 2: Open the PR**

Push `feat/btb-462-decline-reason-consumer` and open a PR against `main` titled `feat(crm): always show a credit decline reason in the decision banner (BTB-462)`. Body: link the spec and the producer plan/PR; include before/after wording for the three banner states (block, credit decline with evidence, legacy "reason not recorded"); note the migration. End the body with the attribution lines from the session's system reminder.

- [ ] **Step 3: Deploy order and check**

Deploy after the billieChat producer is on the same environment (demo first). Run the migration as part of the normal CRM deploy. Then open the demo CRM record for a freshly declined business-account journey and confirm the banner reads `✗ Declined · Business account detected` with the account product labels; open prod application `40089601-594` and confirm it reads `✗ Declined · reason not recorded` (its event predates the producer change and is not backfilled).
