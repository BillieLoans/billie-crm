# Cancellation & Offer-Expiry Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every customer decline, offer expiry and customer-requested cancellation visible in the CRM, so a conversation the customer walked away from stops reading `Approved` forever — without ever masking a fraud stop.

**Architecture:** billieChat's `routes.json` gains rules so `customer_cancelled` (sender `chatbot`) and `offer_cancelled` (sender `contract`) reach `billie-crm`, and so `conversation.kill.requested.v1` reaches `contract` to clear the offer-expiry timer. The CRM event processor gains a shared handler that maps a cancellation reason onto two new terminal `conversations.status` values (`cancelled`, `expired`) plus a `cancellation_record` JSONB blob, with every terminal write — including the existing kill projection — passing through one precedence ladder so a weaker terminal state can never overwrite a stronger one. The kill reason `compliance` splits into `compliance` + `customer_request`, and `customer_request` projects as `cancelled`. A backfill replays the 11 cancellation events still in the retained `chatLedger`.

**Tech Stack:** Payload CMS v3.85 (Next.js 16) + Postgres (`@payloadcms/db-postgres`), Python 3 event processor (`asyncpg`, `structlog`, `pytest`), Redis Streams, vitest + Testing Library, Fly.io.

**Spec:** `docs/superpowers/specs/2026-08-28-cancellation-projection-design.md`

## Global Constraints

- **Deploy order is load-bearing.** `Processor._process_message` ACKs and discards events with no registered handler. The CRM (Tasks 1–8) MUST be deployed before the billieChat routes (Task 9), or every cancellation in the window is permanently lost.
- **Two repos.** CRM work: `/Users/rohansharp/workspace/billie-crm` (on `main`, clean apart from untracked `.claude/`). billieChat work: `/Users/rohansharp/workspace/billieChat` — **currently on `feat/btb-304-income-frame` with uncommitted changes**. Do billieChat work in a git worktree off `main`; never commit onto that branch. Re-verify `git rev-parse --abbrev-ref HEAD` before any `git add` in either repo.
- **Fraud auto-stop is enforcing in prod, not shadow.** Conversations `0283068c` and `8bd3d09f` are already `hard_end` via `system:fraudRiskAgent`. Anything that can downgrade `hard_end` masks a live fraud control.
- **Migrations must use `idType: 'uuid'`.** A single serial id in locked-docs rels 500s every admin detail view.
- **Payload conventions:** pnpm; `@/*` → `./src/*`; Prettier single quotes, no semicolons, trailing commas, 100 char width.
- **Generated files:** run `pnpm generate:types` after changing collections. Never hand-edit `src/payload-types.ts`.
- **Read-only projections:** conversations/applications are written only by the Python event processor. Do not add Payload hooks or API routes that mutate them.
- **UI tests must mock `@payloadcms/ui`** (`vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: null }) }))`) or react-image-crop's CSS import fails collection in isolation.
- **UI conformance floor:** `docs/ux-standards.md` (WCAG 2.2 AA).
- **Locale:** en-AU, AUD. Use `src/lib/formatters.ts`.

### Terminal-state precedence ladder (used in Tasks 4, 5)

| Rank | Status | Meaning |
|---|---|---|
| 3 | `hard_end` | Killed — operator or fraud agent |
| 2 | `cancelled` | The customer said no (in chat, or by request to an operator) |
| 1 | `expired` | System expiry or abandonment |
| 0 | anything else | `active`, `paused`, `soft_end`, `approved`, `declined` |

A terminal write lands when the incoming rank is **greater** than the stored rank, or **equal** to it with no record of that kind yet (first-of-equal-rank wins). Otherwise it is skipped and logged.

### Reason → category → status map (used verbatim in Tasks 4, 5, 7, 8)

| Source event | Reason | Category | Status |
|---|---|---|---|
| `customer_cancelled` | `attestation_declined` | `customer_declined` | `cancelled` |
| `customer_cancelled` | `preliminary_approval_cancelled` | `customer_declined` | `cancelled` |
| `customer_cancelled` | `statement_consent_declined` | `customer_declined` | `cancelled` |
| `customer_cancelled` | `final_offer_declined` | `customer_declined` | `cancelled` |
| `offer_cancelled` | `browser_close` | `abandoned` | `expired` |
| `offer_cancelled` | `session_timeout` | `system_expired` | `expired` |
| `offer_cancelled` | `cutover_exhausted` | `system_expired` | `expired` |
| `conversation.killed.v1` | `customer_request` | `customer_declined` | `cancelled` |
| `conversation.killed.v1` | `fraud_abuse` / `operational` / `compliance` | — | `hard_end` |

Unknown reason falls back on source event: `customer_cancelled` → `customer_declined`/`cancelled`; `offer_cancelled` → `system_expired`/`expired`; `conversation.killed.v1` → `hard_end`.

---

## File Structure

**billie-crm — create:**
- `src/migrations/20260828_140000_conversation_cancellation.ts`
- `event-processor/src/billie_servicing/handlers/cancellation.py` — reason map, `terminal_rank`, both handlers
- `event-processor/tests/test_cancellation_handlers.py`
- `event-processor/tests/test_terminal_precedence.py`
- `src/components/ConversationDetailView/CancellationBanner/index.tsx`
- `tests/unit/components/CancellationBanner.test.tsx`
- `scripts/backfill-cancellations.py`

**billie-crm — modify:**
- `src/collections/Conversations.ts:70` (status options), after `:476` (`cancellationRecord`)
- `event-processor/src/billie_servicing/handlers/conversation.py:705-786` (`handle_final_decision` + `handle_conversation_killed`)
- `event-processor/src/billie_servicing/handlers/__init__.py`, `event-processor/src/billie_servicing/main.py`
- `src/lib/schemas/conversations.ts`, `src/lib/events/schemas.ts:149`
- `src/app/api/conversations/[conversationId]/route.ts:164`
- `src/app/api/commands/conversation-kill/route.ts`
- `src/components/ApplicationsView/StatusBadge/index.tsx:10` + `styles.module.css`
- `src/components/ApplicationsView/FilterBar/index.tsx:66`
- `src/components/ConversationDetailView/EndConversation/index.tsx:19`
- `src/components/ConversationDetailView/index.tsx:153`
- `src/app/(frontend)/customer/[customerId]/page.tsx:105`

**billieChat — modify (worktree off `main`):**
- `backend/backend/src/routing/routes.json`
- `backend/backend/src/agents/contractAgent/contractAgent.py:242`
- `backend/tests/unit/routing/test_cancellation_routes.py` (create)
- `backend/tests/unit/agents/test_contract_agent_expiry_clear.py` (create)

---

### Task 1: Schema — status enum values and cancellation_record column

**Files:**
- Create: `src/migrations/20260828_140000_conversation_cancellation.ts`
- Modify: `src/collections/Conversations.ts:70-82` and after `:476`
- Modify: `src/migrations/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: DB enum `enum_conversations_status` accepts `'cancelled'` and `'expired'`; `conversations.cancellation_record` jsonb; Payload field `cancellationRecord` and two new `status` options.

- [ ] **Step 1: Write the migration**

Create `src/migrations/20260828_140000_conversation_cancellation.ts`:

```ts
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Terminal statuses for applications the customer did not take up, plus the
 * audit record behind them.
 *
 * `ALTER TYPE ... ADD VALUE` inside the migration transaction is fine here
 * because this migration only DEFINES the values — Postgres forbids using a
 * new enum value in the same transaction that adds it, not adding it.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_conversations_status" ADD VALUE IF NOT EXISTS 'cancelled';
  ALTER TYPE "public"."enum_conversations_status" ADD VALUE IF NOT EXISTS 'expired';
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "cancellation_record" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Enum values are not dropped: any row still holding them would break the
  // type. Dropping the column is the reversible half.
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "cancellation_record";`)
}
```

- [ ] **Step 2: Register the migration**

Add the import and array entry to `src/migrations/index.ts`, following the existing entries exactly (same import style, appended last).

- [ ] **Step 3: Add the status options**

In `src/collections/Conversations.ts`, replace the `status` options block at `:72-79`:

```ts
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Paused', value: 'paused' },
        { label: 'Soft End', value: 'soft_end' },
        { label: 'Hard End', value: 'hard_end' },
        { label: 'Approved', value: 'approved' },
        { label: 'Declined', value: 'declined' },
        { label: 'Cancelled', value: 'cancelled' },
        { label: 'Expired', value: 'expired' },
      ],
```

- [ ] **Step 4: Add the cancellationRecord field**

In `src/collections/Conversations.ts`, immediately after the `killRecord` field (ends `:476`):

```ts
    {
      name: 'cancellationRecord',
      type: 'json',
      admin: {
        readOnly: true,
        description:
          'Cancellation / expiry audit: {reason, category, cancelled_at, source_event, application_number}',
      },
    },
```

- [ ] **Step 5: Regenerate types**

Run: `pnpm generate:types`
Expected: the status union gains `| 'cancelled' | 'expired'` and `cancellationRecord` appears on the `Conversation` interface.

- [ ] **Step 6: Verify the migration applies against a throwaway Postgres**

```bash
docker run --rm -d --name pg-mig-check -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:16
DATABASE_URI="postgresql://postgres:pw@localhost:55432/postgres" pnpm payload migrate
docker rm -f pg-mig-check
```
Expected: migration runs without error and prints the new migration name.

- [ ] **Step 7: Commit**

```bash
git checkout -b feat/cancellation-projection
git add src/migrations/ src/collections/Conversations.ts src/payload-types.ts
git commit -m "feat(conversations): add cancelled/expired statuses and cancellation record"
```

---

### Task 2: Zod contract — statuses and CancellationRecordSchema

**Files:**
- Modify: `src/lib/schemas/conversations.ts:7-17` and the detail schema near `:197`
- Test: `tests/unit/lib/schemas/conversations.test.ts` (create if absent)

**Interfaces:**
- Consumes: Task 1's field names.
- Produces: `CONVERSATION_STATUSES` including `'cancelled'`/`'expired'`; exported `CancellationRecordSchema` with `reason`, `category`, `cancelled_at`, `source_event`, `application_number` (all `.nullable().optional()`); `cancellationRecord` on the detail schema.

- [ ] **Step 1: Write the failing test**

Create/extend `tests/unit/lib/schemas/conversations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CONVERSATION_STATUSES, CancellationRecordSchema } from '@/lib/schemas/conversations'

describe('conversation cancellation contract', () => {
  it('accepts the two new terminal statuses', () => {
    expect(CONVERSATION_STATUSES).toContain('cancelled')
    expect(CONVERSATION_STATUSES).toContain('expired')
  })

  it('parses a full cancellation record', () => {
    const parsed = CancellationRecordSchema.parse({
      reason: 'final_offer_declined',
      category: 'customer_declined',
      cancelled_at: '2026-08-28T01:37:30.993832+00:00',
      source_event: 'customer_cancelled',
      application_number: 'C6F7C8E6-77F',
    })
    expect(parsed.category).toBe('customer_declined')
  })

  it('tolerates a sparse record', () => {
    expect(() => CancellationRecordSchema.parse({ reason: 'session_timeout' })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/lib/schemas/conversations.test.ts --config ./vitest.config.mts`
Expected: FAIL — `CancellationRecordSchema` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/schemas/conversations.ts`, add `'cancelled'` and `'expired'` to `CONVERSATION_STATUSES`, and add next to `KillRecordSchema` (`:101-109`):

```ts
export const CancellationRecordSchema = z.object({
  reason: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  cancelled_at: z.string().nullable().optional(),
  source_event: z.string().nullable().optional(),
  application_number: z.string().nullable().optional(),
})
```

Attach it to the conversation detail schema alongside `killRecord` (`:197`):

```ts
  cancellationRecord: CancellationRecordSchema.nullable().optional(),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/lib/schemas/conversations.test.ts --config ./vitest.config.mts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas/conversations.ts tests/unit/lib/schemas/conversations.test.ts
git commit -m "feat(schemas): add cancellation record contract and terminal statuses"
```

---

### Task 3: Kill command contract — split compliance into customer_request

**Files:**
- Modify: `src/lib/events/schemas.ts:149`
- Modify: `src/app/api/commands/conversation-kill/route.ts:49` area
- Modify: `src/components/ConversationDetailView/EndConversation/index.tsx:19-23`
- Test: `tests/unit/components/EndConversation.test.tsx` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `ConversationKillCommandSchema.reasonCategory` enum `['fraud_abuse','operational','compliance','customer_request']`; the route rejecting `blockRequested: true` alongside `customer_request` with a 400; `REASON_OPTIONS` offering "Customer request".

Rationale: the existing `compliance` option is labelled "Compliance / customer request" — one option doing two jobs. Splitting it lets a customer who phones to cancel be projected as `cancelled` (Task 5) rather than `hard_end`, so decline reporting stops undercounting the phone path.

- [ ] **Step 1: Write the failing test**

Extend `tests/unit/components/EndConversation.test.tsx`:

```tsx
import { ConversationKillCommandSchema } from '@/lib/events/schemas'

describe('customer_request kill category', () => {
  it('accepts customer_request as a reason category', () => {
    const parsed = ConversationKillCommandSchema.safeParse({
      conversationId: 'c1',
      customerId: 'B81FC35E',
      reasonCategory: 'customer_request',
    })
    expect(parsed.success).toBe(true)
  })

  it('offers Customer request in the reason dropdown', () => {
    renderEndConversation({ status: 'active' })
    expect(screen.getByRole('option', { name: 'Customer request' })).toBeInTheDocument()
  })

  it('relabels the compliance option so it no longer claims customer request', () => {
    renderEndConversation({ status: 'active' })
    expect(screen.getByRole('option', { name: 'Compliance' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Compliance \/ customer request/ })).toBeNull()
  })
})
```

Reuse the existing render helper in that file; if it has none, build one mirroring how the neighbouring tests mount the component.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/components/EndConversation.test.tsx --config ./vitest.config.mts`
Expected: FAIL — the enum rejects `customer_request` and the option is absent.

- [ ] **Step 3: Widen the command schema**

In `src/lib/events/schemas.ts:149`:

```ts
  reasonCategory: z.enum(['fraud_abuse', 'operational', 'compliance', 'customer_request']),
```

Apply the same widening to the wire-shape enum in the same file (`n: z.enum([...])`) so the published event validates.

- [ ] **Step 4: Update the reason options**

In `src/components/ConversationDetailView/EndConversation/index.tsx:19-23`:

```ts
const REASON_OPTIONS: { value: ReasonCategory; label: string }[] = [
  { value: 'fraud_abuse', label: 'Fraud / abuse' },
  { value: 'operational', label: 'Operational cleanup' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'customer_request', label: 'Customer request' },
]
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/components/EndConversation.test.tsx --config ./vitest.config.mts`
Expected: PASS.

- [ ] **Step 6: Write the failing block-guard test**

A customer asking to cancel must never be blocked from reapplying.
`reapplicationBlock._handle_conversation_kill` raises a `MANUAL_ADMIN` block purely on
the `block_requested` boolean — it never inspects the reason category — so the guard
has to live here.

Add to `tests/unit/components/EndConversation.test.tsx`:

```tsx
it('forces the block checkbox off for a customer request', async () => {
  renderEndConversation({ status: 'active' })
  await userEvent.selectOptions(screen.getByLabelText(/reason/i), 'customer_request')
  const blockCheckbox = screen.getByRole('checkbox', { name: /block/i })
  expect(blockCheckbox).toBeDisabled()
  expect(blockCheckbox).not.toBeChecked()
})
```

And a route test in `tests/int/api/conversation-kill.int.spec.ts` (create if absent):

```ts
it('rejects a customer_request kill that also asks for a block', async () => {
  const res = await postKill({
    conversationId: 'c1',
    customerId: 'B81FC35E',
    reasonCategory: 'customer_request',
    blockRequested: true,
  })
  expect(res.status).toBe(400)
})
```

- [ ] **Step 7: Run both to verify they fail**

Run: `pnpm exec vitest run tests/unit/components/EndConversation.test.tsx tests/int/api/conversation-kill.int.spec.ts --config ./vitest.config.mts`
Expected: FAIL — the checkbox is enabled and the route returns 202.

- [ ] **Step 8: Implement both guards**

In `EndConversation/index.tsx`, disable and clear the block checkbox whenever the selected category is `customer_request`.

In `src/app/api/commands/conversation-kill/route.ts`, after `const cmd = parsed.data`:

```ts
    if (cmd.reasonCategory === 'customer_request' && cmd.blockRequested) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A customer-requested cancellation cannot also raise a reapplication block.',
          },
        },
        { status: 400 },
      )
    }
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/components/EndConversation.test.tsx tests/int/api/conversation-kill.int.spec.ts --config ./vitest.config.mts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/events/schemas.ts src/app/api/commands/conversation-kill/ src/components/ConversationDetailView/EndConversation/ tests/
git commit -m "feat(kill): split compliance into compliance + customer_request"
```

---

### Task 4: Event-processor — precedence ladder and the cancellation handlers

**Files:**
- Create: `event-processor/src/billie_servicing/handlers/cancellation.py`
- Test: `event-processor/tests/test_cancellation_handlers.py`
- Test: `event-processor/tests/test_terminal_precedence.py`

**Interfaces:**
- Consumes: Task 1's column and status values; existing `billie_servicing.db` helpers `parse_payload`, `safe_str`.
- Produces: `handle_customer_cancelled(pool, event)`, `handle_offer_cancelled(pool, event)`, `terminal_rank(status) -> int`, `TERMINAL_RANK: dict[str, int]`, `REASON_MAP: dict[str, tuple[str, str]]`, `CUSTOMER_DECLINED = 'customer_declined'`.

All commands below run from `/Users/rohansharp/workspace/billie-crm/event-processor`.

- [ ] **Step 1: Write the failing precedence test**

Create `event-processor/tests/test_terminal_precedence.py`:

```python
"""The terminal-state ladder: hard_end > cancelled > expired.

Prod 2026-08-28: conversation 2cf3919d took a customer decline at 01:37 and a
system session_timeout for the SAME application at 02:36, because the decline
path never cleared the offer-expiry timer. The same hazard applies to a killed
conversation with a live offer — and there, a downgrade would mask a fraud stop
(fraud auto-stop is ENFORCING in prod: 0283068c, 8bd3d09f).
"""
import pytest

from billie_servicing.handlers.cancellation import terminal_rank


class TestTerminalRank:
    def test_ladder_order(self):
        assert terminal_rank("hard_end") > terminal_rank("cancelled")
        assert terminal_rank("cancelled") > terminal_rank("expired")
        assert terminal_rank("expired") > terminal_rank("approved")

    @pytest.mark.parametrize(
        "status", ["active", "paused", "soft_end", "approved", "declined", None, ""]
    )
    def test_non_terminal_statuses_rank_zero(self, status):
        assert terminal_rank(status) == 0
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pytest tests/test_terminal_precedence.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'billie_servicing.handlers.cancellation'`

> In a worktree, set `PYTHONPATH=<worktree>/event-processor/src` — `billie_servicing` editable-installs from the main repo.

- [ ] **Step 3: Write the failing handler test**

Create `event-processor/tests/test_cancellation_handlers.py`:

```python
"""Tests for customer_cancelled / offer_cancelled projection."""
import json

import pytest

from billie_servicing.handlers.cancellation import (
    handle_customer_cancelled,
    handle_offer_cancelled,
)

CONV = "2cf3919d-a94e-4995-bd02-1865b9d755a4"
APP = "C6F7C8E6-77F"


def _event(typ, reason):
    return {
        "typ": typ,
        "conv": CONV,
        "usr": "B81FC35E",
        "payload": {
            "application_number": APP,
            "cancellation_reason": reason,
            "cancelled_at": "2026-08-28T01:37:30.993832+00:00",
        },
    }


def _row(status=None, record=None):
    return {"status": status, "cancellation_record": json.dumps(record) if record else None}


class TestReasonMapping:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "reason",
        [
            "attestation_declined",
            "preliminary_approval_cancelled",
            "statement_consent_declined",
            "final_offer_declined",
        ],
    )
    async def test_customer_reasons_map_to_cancelled(self, mock_pool, reason):
        mock_pool.set_fetchrow(_row(status="approved"))
        await handle_customer_cancelled(mock_pool, _event("customer_cancelled", reason))
        update = mock_pool.last_update("conversations")
        assert update["status"] == "cancelled"
        record = json.loads(update["cancellation_record"])
        assert record["category"] == "customer_declined"
        assert record["reason"] == reason
        assert record["source_event"] == "customer_cancelled"
        assert record["application_number"] == APP

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "reason,category",
        [
            ("session_timeout", "system_expired"),
            ("cutover_exhausted", "system_expired"),
            ("browser_close", "abandoned"),
        ],
    )
    async def test_offer_reasons_map_to_expired(self, mock_pool, reason, category):
        mock_pool.set_fetchrow(_row(status="approved"))
        await handle_offer_cancelled(mock_pool, _event("offer_cancelled", reason))
        update = mock_pool.last_update("conversations")
        assert update["status"] == "expired"
        assert json.loads(update["cancellation_record"])["category"] == category

    @pytest.mark.asyncio
    async def test_unknown_reason_falls_back_on_source_event(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="approved"))
        await handle_customer_cancelled(mock_pool, _event("customer_cancelled", "brand_new"))
        update = mock_pool.last_update("conversations")
        assert update["status"] == "cancelled"
        record = json.loads(update["cancellation_record"])
        assert record["category"] == "customer_declined"
        assert record["reason"] == "brand_new"

    @pytest.mark.asyncio
    async def test_unknown_offer_reason_falls_back_to_expired(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="approved"))
        await handle_offer_cancelled(mock_pool, _event("offer_cancelled", "brand_new"))
        assert mock_pool.last_update("conversations")["status"] == "expired"


class TestPrecedenceGuard:
    @pytest.mark.asyncio
    async def test_system_expiry_does_not_overwrite_customer_decline(self, mock_pool):
        """The prod repro: decline at 01:37, session_timeout at 02:36."""
        mock_pool.set_fetchrow(
            _row(status="cancelled", record={"category": "customer_declined"})
        )
        await handle_offer_cancelled(mock_pool, _event("offer_cancelled", "session_timeout"))
        assert mock_pool.last_update("conversations") is None

    @pytest.mark.asyncio
    async def test_customer_decline_overrides_earlier_system_expiry(self, mock_pool):
        """Reverse order: the expiry landed first, the decline still wins."""
        mock_pool.set_fetchrow(_row(status="expired", record={"category": "system_expired"}))
        await handle_customer_cancelled(
            mock_pool, _event("customer_cancelled", "final_offer_declined")
        )
        update = mock_pool.last_update("conversations")
        assert update["status"] == "cancelled"
        assert json.loads(update["cancellation_record"])["category"] == "customer_declined"

    @pytest.mark.asyncio
    async def test_second_system_expiry_keeps_the_first_reason(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="expired", record={"category": "system_expired"}))
        await handle_offer_cancelled(mock_pool, _event("offer_cancelled", "cutover_exhausted"))
        assert mock_pool.last_update("conversations") is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize("typ", ["customer_cancelled", "offer_cancelled"])
    async def test_nothing_downgrades_a_killed_conversation(self, mock_pool, typ):
        """A fraud stop must never be masked as cancelled or expired."""
        mock_pool.set_fetchrow(_row(status="hard_end"))
        handler = handle_customer_cancelled if typ == "customer_cancelled" else handle_offer_cancelled
        await handler(mock_pool, _event(typ, "session_timeout"))
        assert mock_pool.last_update("conversations") is None


class TestApplicationOutcome:
    @pytest.mark.asyncio
    async def test_sets_application_outcome_withdrawn(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="approved"))
        await handle_customer_cancelled(
            mock_pool, _event("customer_cancelled", "final_offer_declined")
        )
        assert mock_pool.last_update("applications")["application_outcome"] == "withdrawn"

    @pytest.mark.asyncio
    async def test_no_application_number_skips_applications_write(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="approved"))
        event = _event("customer_cancelled", "final_offer_declined")
        event["payload"].pop("application_number")
        await handle_customer_cancelled(mock_pool, event)
        assert not mock_pool.updates_to("applications")


class TestGuards:
    @pytest.mark.asyncio
    async def test_missing_conversation_id_skips(self, mock_pool):
        await handle_customer_cancelled(
            mock_pool, {"typ": "customer_cancelled", "payload": {}}
        )
        assert not mock_pool.calls

    @pytest.mark.asyncio
    async def test_unknown_conversation_is_update_only(self, mock_pool):
        mock_pool.set_fetchrow(None)
        await handle_offer_cancelled(mock_pool, _event("offer_cancelled", "session_timeout"))
        assert not mock_pool.inserts_into("conversations")
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pytest tests/test_cancellation_handlers.py -v`
Expected: FAIL — module does not exist.

- [ ] **Step 5: Write the implementation**

Create `event-processor/src/billie_servicing/handlers/cancellation.py`:

```python
"""Projection for customer_cancelled / offer_cancelled, and the terminal ladder.

billieChat emits two cancellation events. ``customer_cancelled`` (sender
``chatbot``) fires when the customer confirms an in-card decline at any stage;
``offer_cancelled`` (sender ``contract``) fires when the offer expiry poller or
the browser-close beacon retires an un-accepted offer. Neither reached the CRM
before 2026-08-28 — the (chatbot, customer_cancelled) pair had no route at all,
and neither routed rule targeted billie-crm.

The credit decision is deliberately left alone: a customer walking away must not
restate Billie's approval as a decline, so ``decision_status`` and
``final_decision`` are untouched and only the lifecycle ``status`` moves.

``terminal_rank`` is the single ordering every terminal write consults — see
handlers/conversation.py, which uses it for the kill and final-decision paths.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog

from ..db import parse_payload, safe_str

logger = structlog.get_logger(__name__)

CUSTOMER_DECLINED = "customer_declined"

# Terminal-state ladder. A weaker terminal state must never overwrite a stronger
# one: a stale session_timeout landing an hour after a fraud kill would otherwise
# flip the row to `expired` and mask a live fraud control.
TERMINAL_RANK: dict[str, int] = {"expired": 1, "cancelled": 2, "hard_end": 3}


def terminal_rank(status: str | None) -> int:
    """Rank of a conversation status on the terminal ladder (0 = not terminal)."""
    return TERMINAL_RANK.get(status or "", 0)


# reason -> (category, conversations.status)
REASON_MAP: dict[str, tuple[str, str]] = {
    "attestation_declined": (CUSTOMER_DECLINED, "cancelled"),
    "preliminary_approval_cancelled": (CUSTOMER_DECLINED, "cancelled"),
    "statement_consent_declined": (CUSTOMER_DECLINED, "cancelled"),
    "final_offer_declined": (CUSTOMER_DECLINED, "cancelled"),
    "browser_close": ("abandoned", "expired"),
    "session_timeout": ("system_expired", "expired"),
    "cutover_exhausted": ("system_expired", "expired"),
}

# Fallback when billieChat introduces a reason we don't know yet: trust the
# event type rather than dropping the cancellation.
_SOURCE_DEFAULT: dict[str, tuple[str, str]] = {
    "customer_cancelled": (CUSTOMER_DECLINED, "cancelled"),
    "offer_cancelled": ("system_expired", "expired"),
}


async def _project(pool: asyncpg.Pool, event: dict[str, Any], source_event: str) -> None:
    payload = parse_payload(event)
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or payload.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id, source_event=source_event)
    if not conversation_id:
        log.warning("cancellation event without conversation id — skipping")
        return

    reason = payload.get("cancellation_reason") or payload.get("reason") or ""
    category, status = REASON_MAP.get(reason, _SOURCE_DEFAULT[source_event])

    row = await pool.fetchrow(
        "SELECT status, cancellation_record FROM conversations WHERE conversation_id = $1",
        conversation_id,
    )
    if row is None:
        log.warning("cancellation for unknown conversation — skipping")
        return

    incoming = terminal_rank(status)
    current = terminal_rank(row["status"])
    # Strictly stronger always wins. Equal strength wins only if nothing is
    # recorded yet, so the FIRST reason at a given strength is the one kept.
    if incoming < current or (incoming == current and row["cancellation_record"]):
        log.info(
            "terminal state already at least as strong — skipping",
            current_status=row["status"],
            incoming_status=status,
        )
        return

    application_number = safe_str(
        payload.get("application_number") or event.get("application_number"),
        "application_number",
    )
    record = {
        "reason": reason,
        "category": category,
        "cancelled_at": payload.get("cancelled_at") or datetime.now(UTC).isoformat(),
        "source_event": source_event,
        "application_number": application_number or None,
    }

    await pool.execute(
        "UPDATE conversations SET status = $1, cancellation_record = $2::jsonb, "
        "updated_at = NOW(), version = COALESCE(version, 1) + 1 "
        "WHERE conversation_id = $3",
        status,
        json.dumps(record),
        conversation_id,
    )

    if application_number:
        await pool.execute(
            "UPDATE applications SET application_outcome = $1, updated_at = NOW() "
            "WHERE application_number = $2",
            "withdrawn",
            application_number,
        )

    log.info("cancellation projected", status=status, category=category, reason=reason)


async def handle_customer_cancelled(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Project customer_cancelled — a customer-confirmed decline at any stage."""
    await _project(pool, event, "customer_cancelled")


async def handle_offer_cancelled(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Project offer_cancelled — offer expiry or browser-close abandonment."""
    await _project(pool, event, "offer_cancelled")
```

- [ ] **Step 6: Run both test files to verify they pass**

Run: `pytest tests/test_terminal_precedence.py tests/test_cancellation_handlers.py -v`
Expected: PASS — 21 tests.

- [ ] **Step 7: Lint**

Run: `ruff check src/billie_servicing/handlers/cancellation.py`
Expected: no findings.

- [ ] **Step 8: Commit**

```bash
git add event-processor/src/billie_servicing/handlers/cancellation.py event-processor/tests/test_cancellation_handlers.py event-processor/tests/test_terminal_precedence.py
git commit -m "feat(event-processor): project cancellations behind a terminal-state ladder"
```

---

### Task 5: Apply the ladder to the kill and final-decision projections

**Files:**
- Modify: `event-processor/src/billie_servicing/handlers/conversation.py:705-786`
- Modify: `event-processor/src/billie_servicing/handlers/__init__.py:43` and `:135`
- Modify: `event-processor/src/billie_servicing/main.py:57` and `:192` area
- Test: `event-processor/tests/test_terminal_precedence.py` (extend)

**Interfaces:**
- Consumes: Task 4's `terminal_rank`, `CUSTOMER_DECLINED`.
- Produces: `handle_conversation_killed` mapping `reason_category == 'customer_request'` → status `cancelled` + a cancellation record, everything else → `hard_end`, both ladder-guarded; `handle_final_decision` not overwriting a terminal status; both cancellation handlers registered.

- [ ] **Step 1: Write the failing tests**

Append to `event-processor/tests/test_terminal_precedence.py`:

```python
import json

from billie_servicing.handlers.conversation import (
    handle_conversation_killed,
    handle_final_decision,
)

CONV = "9a1fe3c2-0d6b-4091-8a3a-6c148a4c4142"


def _kill_event(reason_category):
    return {
        "typ": "conversation.killed.v1",
        "conv": CONV,
        "usr": "CUST1",
        "payload": {
            "request_id": "req-9",
            "conversation_id": CONV,
            "application_number": "APP-1",
            "reason_category": reason_category,
            "note": "n",
            "actor": "user:42",
            "killed_at": "2026-08-28T05:00:00+00:00",
        },
    }


def _row(status=None, record=None):
    return {"status": status, "cancellation_record": json.dumps(record) if record else None}


class TestKillProjection:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("category", ["fraud_abuse", "operational", "compliance"])
    async def test_operator_and_fraud_kills_stay_hard_end(self, mock_pool, category):
        mock_pool.set_fetchrow(_row(status="active"))
        await handle_conversation_killed(mock_pool, _kill_event(category))
        update = mock_pool.last_update("conversations")
        assert update["status"] == "hard_end"
        assert "cancellation_record" not in update

    @pytest.mark.asyncio
    async def test_customer_request_projects_as_cancelled(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="active"))
        await handle_conversation_killed(mock_pool, _kill_event("customer_request"))
        update = mock_pool.last_update("conversations")
        assert update["status"] == "cancelled"
        record = json.loads(update["cancellation_record"])
        assert record["category"] == "customer_declined"
        assert record["reason"] == "customer_request"
        assert record["source_event"] == "conversation.killed.v1"

    @pytest.mark.asyncio
    async def test_customer_request_still_writes_the_kill_record(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="active"))
        await handle_conversation_killed(mock_pool, _kill_event("customer_request"))
        record = json.loads(mock_pool.last_update("conversations")["kill_record"])
        assert record["actor"] == "user:42"

    @pytest.mark.asyncio
    async def test_customer_request_does_not_downgrade_a_fraud_kill(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="hard_end"))
        await handle_conversation_killed(mock_pool, _kill_event("customer_request"))
        assert mock_pool.last_update("conversations") is None

    @pytest.mark.asyncio
    async def test_fraud_kill_overrides_an_earlier_cancellation(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="cancelled", record={"category": "customer_declined"}))
        await handle_conversation_killed(mock_pool, _kill_event("fraud_abuse"))
        assert mock_pool.last_update("conversations")["status"] == "hard_end"


class TestFinalDecisionDoesNotClobber:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("terminal", ["cancelled", "expired", "hard_end"])
    async def test_redelivered_decision_keeps_terminal_status(self, mock_pool, terminal):
        """At-least-once redelivery must not reset a terminal conversation to
        approved — that is the original bug, and for hard_end it would unmask a
        fraud stop."""
        mock_pool.set_fetchrow(_row(status=terminal))
        await handle_final_decision(
            mock_pool,
            {"typ": "final_credit_decision", "conv": CONV, "payload": {"decision": "APPROVED"}},
        )
        written = mock_pool.last_upsert("conversations")
        assert "status" not in written
        assert written["decision_status"] == "approved"
        assert written["final_decision"] == "APPROVED"

    @pytest.mark.asyncio
    async def test_decision_sets_status_when_not_terminal(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="active"))
        await handle_final_decision(
            mock_pool,
            {"typ": "final_credit_decision", "conv": CONV, "payload": {"decision": "APPROVED"}},
        )
        assert mock_pool.last_upsert("conversations")["status"] == "approved"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pytest tests/test_terminal_precedence.py -v`
Expected: FAIL — the kill handler ignores `reason_category` and `handle_final_decision` writes `status` unconditionally.

- [ ] **Step 3: Make handle_conversation_killed ladder-aware**

In `event-processor/src/billie_servicing/handlers/conversation.py`, import the ladder at the top of the file:

```python
from .cancellation import CUSTOMER_DECLINED, terminal_rank
```

Replace the body of `handle_conversation_killed` after `kill_record` is built (`:772-786`) with:

```python
    reason_category = payload.get("reason_category") or ""
    # A customer who phones to cancel is a cancellation, not an operator kill —
    # otherwise decline reporting undercounts the phone path (the old
    # `compliance` option was labelled "Compliance / customer request").
    is_customer_request = reason_category == "customer_request"
    status = "cancelled" if is_customer_request else "hard_end"

    row = await pool.fetchrow(
        "SELECT status, cancellation_record FROM conversations WHERE conversation_id = $1",
        conversation_id,
    )
    if row is None:
        log.warning("kill for unknown conversation — skipping")
        return

    incoming = terminal_rank(status)
    current = terminal_rank(row["status"])
    if incoming < current or (incoming == current and row["cancellation_record"]):
        log.info(
            "terminal state already at least as strong — skipping kill status write",
            current_status=row["status"],
            incoming_status=status,
        )
        return

    if is_customer_request:
        cancellation_record = {
            "reason": "customer_request",
            "category": CUSTOMER_DECLINED,
            "cancelled_at": payload.get("killed_at"),
            "source_event": "conversation.killed.v1",
            "application_number": payload.get("application_number") or None,
        }
        await pool.execute(
            "UPDATE conversations SET status = $1, kill_record = $2::jsonb, "
            "cancellation_record = $3::jsonb, updated_at = NOW(), "
            "version = COALESCE(version, 1) + 1 WHERE conversation_id = $4",
            status,
            json.dumps(kill_record),
            json.dumps(cancellation_record),
            conversation_id,
        )
    else:
        await pool.execute(
            "UPDATE conversations SET status = $1, kill_record = $2::jsonb, "
            "updated_at = NOW(), version = COALESCE(version, 1) + 1 "
            "WHERE conversation_id = $3",
            status,
            json.dumps(kill_record),
            conversation_id,
        )
    log.info("conversation kill projected", actor=payload.get("actor"), status=status)
```

- [ ] **Step 4: Guard handle_final_decision**

In the same file, replace the `set_values` construction in `handle_final_decision` (`:726-730`) with:

```python
    set_values: dict[str, Any] = {
        "final_decision": decision,
        "decision_status": decision_status,
    }

    # A terminal conversation stays terminal. final_credit_decision is delivered
    # at-least-once, so a redelivery after a cancellation or a kill would
    # otherwise reset the row to `approved`, re-hiding the cancellation or
    # unmasking a fraud stop. The decision facts stay safe to re-apply.
    row = await pool.fetchrow(
        "SELECT status FROM conversations WHERE conversation_id = $1", conversation_id
    )
    if row is not None and terminal_rank(row["status"]):
        log.info("conversation already terminal — not overwriting status",
                 current_status=row["status"])
    else:
        set_values["status"] = status
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pytest tests/test_terminal_precedence.py tests/test_conversation_kill.py -v`
Expected: PASS. `test_conversation_kill.py` predates the ladder — its cases now need `mock_pool.set_fetchrow({"status": "active", "cancellation_record": None})`. Add that line to those tests rather than weakening the guard.

- [ ] **Step 6: Re-export and register the handlers**

In `event-processor/src/billie_servicing/handlers/__init__.py`, add to the imports and to `__all__`:

```python
from .cancellation import handle_customer_cancelled, handle_offer_cancelled
```

```python
    "handle_customer_cancelled",
    "handle_offer_cancelled",
```

In `event-processor/src/billie_servicing/main.py`, add both names to the `from .handlers import (...)` block and register them next to the `conversation.killed.v1` line (`:192`):

```python
    processor.register_handler("customer_cancelled", handle_customer_cancelled)
    processor.register_handler("offer_cancelled", handle_offer_cancelled)
```

- [ ] **Step 7: Verify the export guard and full suite**

Run: `pytest -q && ruff check .`
Expected: all green, including `test_handler_exports.py`.

- [ ] **Step 8: Commit**

```bash
git add event-processor/src/billie_servicing/ event-processor/tests/
git commit -m "feat(event-processor): rank terminal states; project customer_request kills as cancelled"
```

---

### Task 6: API — return cancellationRecord on the conversation detail

**Files:**
- Modify: `src/app/api/conversations/[conversationId]/route.ts:117` area and `:164-168`
- Test: `tests/int/api/conversation-detail.int.spec.ts` (extend)

**Interfaces:**
- Consumes: Task 1's field, Task 2's `CancellationRecordSchema`.
- Produces: `cancellationRecord` on the detail response, or `null`.

- [ ] **Step 1: Write the failing test**

```ts
it('returns the cancellation record when the conversation was cancelled', async () => {
  const res = await fetchConversationDetail(cancelledConversationId)
  expect(res.cancellationRecord).toMatchObject({
    reason: 'final_offer_declined',
    category: 'customer_declined',
  })
})

it('returns null for a conversation that was never cancelled', async () => {
  const res = await fetchConversationDetail(activeConversationId)
  expect(res.cancellationRecord ?? null).toBeNull()
})

it('returns both records for a customer-request kill', async () => {
  const res = await fetchConversationDetail(customerRequestKillConversationId)
  expect(res.killRecord).toBeTruthy()
  expect(res.cancellationRecord).toMatchObject({ reason: 'customer_request' })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/int/api/conversation-detail.int.spec.ts --config ./vitest.config.mts`
Expected: FAIL — `cancellationRecord` is `undefined`.

- [ ] **Step 3: Implement**

In `src/app/api/conversations/[conversationId]/route.ts`, read the field alongside `killRecord` (near `:117`):

```ts
  const cancellationRecord = doc.cancellationRecord ?? null
```

and add it to the response object near `:168`, on the base object — not inside `supervisorOnlyFields`, matching how `killRecord` is exposed to all lending roles:

```ts
    cancellationRecord,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/int/api/conversation-detail.int.spec.ts --config ./vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/conversations/ tests/int/api/conversation-detail.int.spec.ts
git commit -m "feat(api): expose cancellationRecord on conversation detail"
```

---

### Task 7: UI — status badge, filter bar, and the second colour map

**Files:**
- Modify: `src/components/ApplicationsView/StatusBadge/index.tsx:10-18` + `styles.module.css`
- Modify: `src/components/ApplicationsView/FilterBar/index.tsx:66-79`
- Modify: `src/app/(frontend)/customer/[customerId]/page.tsx:105-118`
- Test: `tests/unit/components/StatusBadge.test.tsx` (create)

**Interfaces:**
- Consumes: Task 1's status values.
- Produces: `STATUS_CONFIG` entries for `cancelled` and `expired`; both selectable in the monitoring-grid status filter.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/StatusBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: null }) }))

import StatusBadge from '@/components/ApplicationsView/StatusBadge'

describe('StatusBadge', () => {
  it('renders the cancelled status with its own label', () => {
    render(<StatusBadge status="cancelled" />)
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })

  it('renders the expired status with its own label', () => {
    render(<StatusBadge status="expired" />)
    expect(screen.getByText('Expired')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/unit/components/StatusBadge.test.tsx --config ./vitest.config.mts`
Expected: FAIL — the raw string renders via the unknown-value fallback at `index.tsx:32`.

- [ ] **Step 3: Add the STATUS_CONFIG entries**

```ts
  cancelled: { label: 'Cancelled', cssClass: 'cancelled' },
  expired: { label: 'Expired', cssClass: 'expired' },
```

- [ ] **Step 4: Add the CSS classes**

In `src/components/ApplicationsView/StatusBadge/styles.module.css`, add `.cancelled` and `.expired` following the shape of the existing `.declined` / `.hard_end` rules. Both are terminal non-approval states — use the muted/neutral treatment rather than the alarm red reserved for `.declined`, and verify contrast meets WCAG 2.2 AA.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/components/StatusBadge.test.tsx --config ./vitest.config.mts`
Expected: PASS.

- [ ] **Step 6: Add both to the filter dropdown**

In `src/components/ApplicationsView/FilterBar/index.tsx`, inside the status `<select>` (`:66-79`):

```tsx
          <option value="cancelled">Conversation: Cancelled</option>
          <option value="expired">Conversation: Expired</option>
```

- [ ] **Step 7: Add both to the customer-page colour map**

In `src/app/(frontend)/customer/[customerId]/page.tsx`, add cases to `getStatusColor()` (`:105-118`) for `cancelled` and `expired` so they don't fall through to grey.

- [ ] **Step 8: Run lint and the component suite**

Run: `pnpm lint && pnpm exec vitest run tests/unit/components --config ./vitest.config.mts`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/components/ApplicationsView/ src/app/\(frontend\)/customer/ tests/unit/components/StatusBadge.test.tsx
git commit -m "feat(ui): render and filter cancelled/expired conversation statuses"
```

---

### Task 8: UI — CancellationBanner on the conversation detail

**Files:**
- Create: `src/components/ConversationDetailView/CancellationBanner/index.tsx`
- Modify: `src/components/ConversationDetailView/index.tsx:153` area, `styles.module.css`
- Test: `tests/unit/components/CancellationBanner.test.tsx`

**Interfaces:**
- Consumes: Task 6's `cancellationRecord` field.
- Produces: `<CancellationBanner cancellationRecord={record} />`, `data-testid="cancellation-banner"`.

Model this on `KillBanner` (`EndConversation/index.tsx:248-302`): a fixed one-line clickable summary opening a `ContextDrawer` with label/value rows. Per the `fixed-layout-over-adaptive` preference the banner keeps its slot regardless of which fields are populated.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: null }) }))

import CancellationBanner from '@/components/ConversationDetailView/CancellationBanner'

const RECORD = {
  reason: 'final_offer_declined',
  category: 'customer_declined',
  cancelled_at: '2026-08-28T01:37:30.993832+00:00',
  source_event: 'customer_cancelled',
  application_number: 'C6F7C8E6-77F',
}

describe('CancellationBanner', () => {
  it('summarises a customer decline in one line', () => {
    render(<CancellationBanner cancellationRecord={RECORD} />)
    const banner = screen.getByTestId('cancellation-banner')
    expect(banner).toHaveTextContent('Declined by customer')
    expect(banner).toHaveTextContent('Final offer declined')
  })

  it('summarises a system expiry differently', () => {
    render(
      <CancellationBanner
        cancellationRecord={{ ...RECORD, category: 'system_expired', reason: 'session_timeout' }}
      />,
    )
    expect(screen.getByTestId('cancellation-banner')).toHaveTextContent('Offer expired')
  })

  it('labels a customer-requested cancellation taken by an operator', () => {
    render(
      <CancellationBanner
        cancellationRecord={{ ...RECORD, reason: 'customer_request', source_event: 'conversation.killed.v1' }}
      />,
    )
    expect(screen.getByTestId('cancellation-banner')).toHaveTextContent('Customer requested cancellation')
  })

  it('falls back to the raw reason for an unmapped value', () => {
    render(<CancellationBanner cancellationRecord={{ ...RECORD, reason: 'brand_new' }} />)
    expect(screen.getByTestId('cancellation-banner')).toHaveTextContent('brand_new')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/unit/components/CancellationBanner.test.tsx --config ./vitest.config.mts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the banner**

Create `src/components/ConversationDetailView/CancellationBanner/index.tsx`, following `KillBanner`'s structure: a `useState` drawer toggle, a summary button carrying `data-testid="cancellation-banner"`, and a `ContextDrawer` titled "Application not taken up" with rows for Outcome, Reason, Application and Cancelled at. Label lookups mirror `reasonLabel()` — raw value when unmapped, `'—'` when null:

```tsx
const CATEGORY_LABELS: Record<string, string> = {
  customer_declined: 'Declined by customer',
  system_expired: 'Offer expired',
  abandoned: 'Abandoned',
}

const REASON_LABELS: Record<string, string> = {
  attestation_declined: 'Attestation declined',
  preliminary_approval_cancelled: 'Preliminary approval declined',
  statement_consent_declined: 'Bank-statement consent declined',
  final_offer_declined: 'Final offer declined',
  browser_close: 'Browser closed',
  session_timeout: 'Offer window elapsed',
  cutover_exhausted: 'Offer refresh exhausted',
  customer_request: 'Customer requested cancellation',
}
```

Format `cancelled_at` with the shared en-AU helper from `src/lib/formatters.ts` that `KillBanner` uses for `killed_at`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/components/CancellationBanner.test.tsx --config ./vitest.config.mts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Mount it**

In `src/components/ConversationDetailView/index.tsx`, directly below the `KillBanner` mount (`:153`):

```tsx
      {conversation?.cancellationRecord && (
        <CancellationBanner cancellationRecord={conversation.cancellationRecord} />
      )}
```

A customer-request cancellation shows both banners — the kill banner says who ended it, the cancellation banner says why. That is intended.

- [ ] **Step 6: Add styles**

Add the banner classes to `src/components/ConversationDetailView/styles.module.css`, reusing the `killBanner*` / `killDrawer*` shapes. Confirm WCAG 2.2 AA contrast and that the summary is a real `<button>` with an accessible name.

- [ ] **Step 7: Run lint and the full unit suite**

Run: `pnpm lint && pnpm test:int`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/components/ConversationDetailView/ tests/unit/components/CancellationBanner.test.tsx
git commit -m "feat(ui): surface cancellation detail on the conversation view"
```

---

### Task 9: billieChat — routes and the stale expiry timer

**Files:**
- Modify: `backend/backend/src/routing/routes.json`
- Modify: `backend/backend/src/agents/contractAgent/contractAgent.py:242` area
- Create: `backend/tests/unit/routing/test_cancellation_routes.py`
- Create: `backend/tests/unit/agents/test_contract_agent_expiry_clear.py`

**Interfaces:**
- Consumes: nothing from the CRM tasks — but MUST NOT be deployed before Tasks 1–8 are live (see Global Constraints).
- Produces: `customer_cancelled` from `chatbot` resolving to the applicationState, billie-crm and contract inboxes; `offer_cancelled` and contract-sent `customer_cancelled` additionally resolving to billie-crm; `conversation.kill.requested.v1` from both `fraudRisk` and `billie-crm` additionally resolving to contract.

- [ ] **Step 1: Create an isolated worktree**

`feat/btb-304-income-frame` is checked out with uncommitted work — do not disturb it.

```bash
cd /Users/rohansharp/workspace/billieChat
git worktree add ../billieChat-cancellation-routes -b fix/cancellation-routes main
cd ../billieChat-cancellation-routes
```

- [ ] **Step 2: Write the failing routing test**

Create `backend/tests/unit/routing/test_cancellation_routes.py`:

```python
"""routes.json must fan cancellations out to the CRM, and kills to contract.

Prod 2026-08-28 (conversation 2cf3919d, application C6F7C8E6-77F): the customer
declined the final offer, `dispatch_cancel_application` published
`customer_cancelled` as agt="chatbot", and the router returned zero targets —
there was no (chatbot, customer_cancelled) rule. The event reached chatLedger
and nothing else, so the CRM kept showing the conversation as Approved.

contractAgent owns OFFER_EXPIRY_SORTED_SET but hears about neither a decline nor
a kill, so it later publishes a phantom offer_cancelled(session_timeout) for an
application that is already finished. For a killed conversation that would mask
a fraud stop as `expired` in the CRM.
"""

from __future__ import annotations

from backend.src.config import config
from backend.src.models.ledger import LedgerMessage
from backend.src.routing import router


def setup_function() -> None:
    router.load_routes.cache_clear()


def _msg(agt_key: str, typ_key: str, cls: str = "msg") -> LedgerMessage:
    return LedgerMessage(
        conv="c1",
        agt=config.get(agt_key),
        usr="B81FC35E",
        seq=1,
        cls=cls,
        typ=config.get(typ_key),
        payload={"application_number": "C6F7C8E6-77F"},
    )


def test_chatbot_customer_cancelled_reaches_crm() -> None:
    inboxes = router.resolve(_msg("agent_chatbot", "msg_type_customer_cancelled"))
    assert config.get("inbox_billie-crm") in inboxes


def test_chatbot_customer_cancelled_still_reaches_application_state() -> None:
    inboxes = router.resolve(_msg("agent_chatbot", "msg_type_customer_cancelled"))
    assert config.get("inbox_applicationStateService") in inboxes


def test_chatbot_customer_cancelled_reaches_contract_to_clear_the_timer() -> None:
    inboxes = router.resolve(_msg("agent_chatbot", "msg_type_customer_cancelled"))
    assert config.get("inbox_contract") in inboxes


def test_contract_offer_cancelled_reaches_crm() -> None:
    inboxes = router.resolve(_msg("agent_contract", "msg_type_offer_cancelled"))
    assert config.get("inbox_billie-crm") in inboxes


def test_contract_customer_cancelled_reaches_crm() -> None:
    inboxes = router.resolve(_msg("agent_contract", "msg_type_customer_cancelled"))
    assert config.get("inbox_billie-crm") in inboxes


def test_fraud_kill_request_reaches_contract() -> None:
    inboxes = router.resolve(
        _msg("agent_fraudRisk", "msg_type_conversation_kill_requested", cls="cmd")
    )
    assert config.get("inbox_contract") in inboxes


def test_crm_kill_request_reaches_contract() -> None:
    inboxes = router.resolve(
        _msg("agent_billie-crm", "msg_type_conversation_kill_requested", cls="cmd")
    )
    assert config.get("inbox_contract") in inboxes


def test_kill_request_still_reaches_its_existing_targets() -> None:
    """Regression: adding contract must not displace the original consumers."""
    inboxes = router.resolve(
        _msg("agent_fraudRisk", "msg_type_conversation_kill_requested", cls="cmd")
    )
    assert config.get("inbox_applicationStateService") in inboxes
    assert config.get("inbox_reapplicationBlock") in inboxes
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && pytest tests/unit/routing/test_cancellation_routes.py -v`
Expected: FAIL on all but the last assertion.

- [ ] **Step 4: Add the routes**

In `backend/backend/src/routing/routes.json`, append to the `"${agent_chatbot}"` rule array:

```json
      {
        "condition": {
          "typ": "${msg_type_customer_cancelled}"
        },
        "targetAgent": [
          "${service_applicationState}",
          "${agent_billie-crm}",
          "${agent_contract}"
        ]
      }
```

In the `"${agent_contract}"` rule array, add `"${agent_billie-crm}"` to the `targetAgent` list of both the existing `${msg_type_offer_cancelled}` and `${msg_type_customer_cancelled}` rules.

In the `"${agent_fraudRisk}"` and `"${agent_billie-crm}"` rule arrays, add `"${agent_contract}"` to the `targetAgent` list of each existing `${msg_type_conversation_kill_requested}` rule.

- [ ] **Step 5: Run the routing tests to verify they pass**

Run: `pytest tests/unit/routing/test_cancellation_routes.py -v`
Expected: PASS — 8 tests.

- [ ] **Step 6: Write the failing expiry-timer test**

Create `backend/tests/unit/agents/test_contract_agent_expiry_clear.py`:

```python
"""A finished application must leave the offer-expiry sorted set.

Prod 2026-08-28: the customer declined C6F7C8E6-77F at 01:37 and the expiry
poller published offer_cancelled(session_timeout) for the SAME application at
02:36, because dispatch_cancel_application never removed it from
OFFER_EXPIRY_SORTED_SET — only _handle_cancel_offer_command did. The kill path
has the same hole, and there the phantom would mask a fraud stop.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from backend.src.agents.contractAgent.contractAgent import OFFER_EXPIRY_SORTED_SET


@pytest.mark.asyncio
async def test_customer_cancelled_removes_offer_from_expiry_set(contract_agent):
    contract_agent.redis.zrem = AsyncMock(return_value=1)
    await contract_agent._clear_offer_expiry(
        {"application_number": "C6F7C8E6-77F"}, "customer_cancelled"
    )
    contract_agent.redis.zrem.assert_awaited_once_with(
        OFFER_EXPIRY_SORTED_SET, "C6F7C8E6-77F"
    )


@pytest.mark.asyncio
async def test_kill_request_removes_offer_from_expiry_set(contract_agent):
    contract_agent.redis.zrem = AsyncMock(return_value=1)
    await contract_agent._clear_offer_expiry(
        {"application_number": "6A2ACCDF-A9E"}, "conversation.kill.requested.v1"
    )
    contract_agent.redis.zrem.assert_awaited_once_with(
        OFFER_EXPIRY_SORTED_SET, "6A2ACCDF-A9E"
    )


@pytest.mark.asyncio
async def test_missing_application_number_is_a_no_op(contract_agent):
    contract_agent.redis.zrem = AsyncMock(return_value=0)
    await contract_agent._clear_offer_expiry({}, "customer_cancelled")
    contract_agent.redis.zrem.assert_not_awaited()
```

Reuse the existing `contract_agent` fixture if `backend/tests/unit/agents/` defines one; otherwise add a `conftest.py` there constructing `ContractAgent({})` with `redis` replaced by an `AsyncMock`, mirroring the neighbouring agent tests.

- [ ] **Step 7: Run it to verify it fails**

Run: `pytest tests/unit/agents/test_contract_agent_expiry_clear.py -v`
Expected: FAIL — `AttributeError: 'ContractAgent' object has no attribute '_clear_offer_expiry'`

- [ ] **Step 8: Implement the shared helper and both branches**

In `backend/backend/src/agents/contractAgent/contractAgent.py`, add two dispatch branches immediately after the `msg_type_offer_cancelled` branch (`:242-245`):

```python
            elif message_type == config.get("msg_type_customer_cancelled"):
                await self._clear_offer_expiry(payload, "customer_cancelled")
            elif message_type == config.get("msg_type_conversation_kill_requested"):
                await self._clear_offer_expiry(payload, "conversation.kill.requested.v1")
```

and the method next to `_handle_cancel_offer_command`:

```python
    async def _clear_offer_expiry(self, payload, source: str):
        """Retire the expiry timer for an application that is already finished.

        Without this the poller later publishes a spurious
        ``offer_cancelled(session_timeout)`` for an application the customer had
        already declined (prod 2026-08-28, C6F7C8E6-77F) or that was killed —
        and for a kill the CRM would project that as `expired`, masking the stop.
        """
        application_number = payload.get("application_number")
        if not application_number:
            logger.warning("%s: %s without application_number", self.agent_name, source)
            return
        await self._remove_offer_expiry(application_number)
        logger.info(
            "%s: cleared offer expiry for %s (%s)",
            self.agent_name,
            application_number,
            source,
        )
```

- [ ] **Step 9: Run both test files to verify they pass**

Run: `pytest tests/unit/routing/test_cancellation_routes.py tests/unit/agents/test_contract_agent_expiry_clear.py -v`
Expected: PASS — 11 tests.

- [ ] **Step 10: Run the routing and contract-agent regression suites**

Run: `pytest tests/unit/routing/ tests/unit/agents/ -v`
Expected: PASS — in particular `test_platform_sender_coverage.py` and `test_router.py` still pass with the new rules.

- [ ] **Step 11: Commit**

```bash
git add backend/backend/src/routing/routes.json backend/backend/src/agents/contractAgent/contractAgent.py backend/tests/unit/
git commit -m "fix(routing): fan cancellations to billie-crm; clear expiry timer on decline and kill"
```

---

### Task 10: Backfill script

**Files:**
- Create: `event-processor/src/billie_servicing/scripts/backfill_cancellations.py` (ships in the image — /app/scripts does not)

**Interfaces:**
- Consumes: Tasks 1–9 deployed. Reads `chatLedger`, writes `inbox:billie-servicing`.
- Produces: a `--dry-run` default and an explicit `--apply` flag; one printed line per event.

- [ ] **Step 1: Write the script**

Create `scripts/backfill-cancellations.py`:

```python
"""Replay retained cancellation events into the CRM inbox.

The 11 customer_cancelled / offer_cancelled events between 2026-06-28 and
2026-08-28 were written to chatLedger but never routed to inbox:billie-servicing
(see docs/superpowers/specs/2026-08-28-cancellation-projection-design.md).
The events are still in the ledger, so the repair is a replay.

Replayed entries get fresh stream IDs, so the processor's dedup key does not
suppress them; idempotency comes from the terminal-state ladder, which also
makes this script safe to run more than once.

Run AFTER the CRM handlers are deployed, or the processor will ACK and discard.

  python scripts/backfill-cancellations.py                # dry run
  python scripts/backfill-cancellations.py --apply        # write
"""

from __future__ import annotations

import argparse
import asyncio
import os

import redis.asyncio as aioredis

LEDGER = "chatLedger"
INBOX = "inbox:billie-servicing"
TARGET_TYPES = {"customer_cancelled", "offer_cancelled"}


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="actually write to the inbox")
    args = parser.parse_args()

    r = aioredis.from_url(os.environ["REDIS_URL"], decode_responses=True)

    entries = await r.xrange(LEDGER, "-", "+")
    hits = [(sid, f) for sid, f in entries if f.get("typ") in TARGET_TYPES]

    print(f"{len(hits)} cancellation events found in {LEDGER}")
    for sid, fields in hits:
        print(
            f"  {sid}  {fields.get('typ'):<19} conv={fields.get('conv','')[:8]} "
            f"payload={fields.get('payload','')[:110]}"
        )
        if args.apply:
            await r.xadd(INBOX, fields)

    print("replayed" if args.apply else "dry run — nothing written; pass --apply")
    await r.aclose()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Dry-run it against prod**

```bash
fly ssh console -a billie-crm-prod -C 'python3 -m billie_servicing.scripts.backfill_cancellations'
```
Expected: exactly 11 events — 9 `session_timeout`, 1 `final_offer_declined`, 1 duplicate `session_timeout` for C6F7C8E6-77F — and nothing written.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-cancellations.py
git commit -m "chore(scripts): add cancellation backfill replay"
```

---

### Task 11: Deploy and verify

**Files:** none — deployment and verification only.

- [ ] **Step 1: Deploy the CRM to demo**

```bash
make -C infra/fly deploy ENV=demo GITHUB_TOKEN="..." IMAGE_LABEL="cancellation-$(git rev-parse --short HEAD)"
```

Pass an explicit `IMAGE_LABEL` — without one the HEAD-derived tag is reused and the machine can silently keep the old digest while the deploy reports success. `deploy` applies pending migrations first.

- [ ] **Step 2: Confirm the migration landed**

```bash
fly ssh console -a billie-crm-demo -C 'sh -c "psql \"$DATABASE_URI\" -c \"SELECT unnest(enum_range(NULL::enum_conversations_status));\""'
```
Expected: output includes `cancelled` and `expired`.

- [ ] **Step 3: Deploy billieChat to demo**

```bash
make -C infra/fly/backend deploy ENV=demo CONFIRM=1
```

Deploys are manual — the GitHub tag workflows never succeed (no env secrets). Verify with `fly image show -a billie-chat-backend-demo`.

- [ ] **Step 4: End-to-end check — customer decline**

Run an application to the final offer, click DECLINE and confirm.

```bash
fly ssh console -a billie-crm-demo -C 'sh -c "psql \"$DATABASE_URI\" -c \"SELECT conversation_id, status, decision_status, cancellation_record FROM conversations ORDER BY updated_at DESC LIMIT 1;\""'
```
Expected: `status = cancelled`, `decision_status = approved` (unchanged), `cancellation_record.category = customer_declined`. Grid shows the **Cancelled** badge; detail view shows the cancellation banner.

- [ ] **Step 5: End-to-end check — customer-request cancellation**

On a live conversation, use End Conversation with reason **Customer request**.
Expected: `status = cancelled`, both `kill_record` and `cancellation_record` populated, `cancellation_record.reason = customer_request`, and **no** reapplication block raised on the customer.

- [ ] **Step 6: End-to-end check — the fraud/kill regression**

Kill a conversation that already has a live offer (reason **Fraud / abuse**), then wait past the offer expiry window.

```bash
fly ssh console -a billie-crm-demo -C 'sh -c "psql \"$DATABASE_URI\" -c \"SELECT conversation_id, status, kill_record->>'"'"'reason_category'"'"' AS kill_reason, cancellation_record FROM conversations WHERE kill_record IS NOT NULL ORDER BY updated_at DESC LIMIT 1;\""'
```
Expected: `status` is still `hard_end` and `cancellation_record` is still NULL — the timer fix means no `offer_cancelled` is emitted, and the ladder means it would be harmless if one were. **This is the check that proves the fraud stop cannot be masked.**

- [ ] **Step 7: Promote to prod**

Repeat Steps 1 and 3 with `ENV=prod`, CRM first.

- [ ] **Step 8: Backfill prod**

```bash
fly ssh console -a billie-crm-prod -C 'python3 -m billie_servicing.scripts.backfill_cancellations'          # dry run first
fly ssh console -a billie-crm-prod -C 'python3 -m billie_servicing.scripts.backfill_cancellations --apply'
```

- [ ] **Step 9: Verify the backfill**

```bash
fly ssh console -a billie-crm-prod -C 'sh -c "psql \"$DATABASE_URI\" -c \"SELECT application_number, status, decision_status, cancellation_record->>'"'"'category'"'"' AS category FROM conversations WHERE cancellation_record IS NOT NULL ORDER BY updated_at DESC;\""'
```

Expected: 10 rows. `C6F7C8E6-77F` shows `cancelled` / `customer_declined` (**not** `expired` — the ladder must have rejected the duplicate `session_timeout`). `73E21E42-EF7` and the other eight show `expired` / `system_expired`. Every row keeps its original `decision_status`.

- [ ] **Step 10: Verify the two prod fraud kills were untouched**

```bash
fly ssh console -a billie-crm-prod -C 'sh -c "psql \"$DATABASE_URI\" -c \"SELECT LEFT(conversation_id,8) AS conv, status, cancellation_record FROM conversations WHERE conversation_id LIKE '"'"'8bd3d09f%'"'"' OR conversation_id LIKE '"'"'0283068c%'"'"';\""'
```
Expected: both still `hard_end` with `cancellation_record` NULL.

- [ ] **Step 11: Re-run the backfill to prove idempotency**

```bash
fly ssh console -a billie-crm-prod -C 'python3 -m billie_servicing.scripts.backfill_cancellations --apply'
```
Then re-run Step 9's query.
Expected: identical rows — the ladder rejects every replayed event the second time.

---

## Self-Review Notes

**Spec coverage:** routing gap → Task 9; missing CRM handler → Tasks 4–5; status model D1/D2 → Tasks 1, 7, 8; precedence ladder D5 → Tasks 4, 5; kill-reason split D6 → Tasks 3, 5, 8; timer fix D4 → Task 9; `handle_final_decision` clobber risk → Task 5; backfill D3 → Tasks 10–11; all UI touch points from the spec table → Tasks 1, 2, 3, 6, 7, 8; sequencing risk → Global Constraints + Task 11 ordering; the deliberately-rejected server-side status gate is recorded in the spec and has no task, by design.

**Naming consistency:** `cancellation_record` (DB/Python) ↔ `cancellationRecord` (Payload/TS/API); `terminal_rank` / `TERMINAL_RANK` defined in Task 4 and imported by Task 5; `CUSTOMER_DECLINED` shared across the reason map, the guard and the kill handler; `_clear_offer_expiry` (billieChat, Task 9) is the single helper both new dispatch branches call; `customer_request` is the reason value everywhere (Tasks 3, 5, 8).

**Known follow-ups, not in scope:** the pre-existing `ended` phantom status (in `CONVERSATION_STATUSES` and the FilterBar, absent from the DB enum); surfacing `applications.applicationOutcome` in a custom view.
