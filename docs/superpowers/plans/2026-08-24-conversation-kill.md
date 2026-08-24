# Conversation Kill (CRM "End conversation" button) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Staff (admin/supervisor) end a live billieChat conversation from the CRM — neutral stop message to the customer, zombie-safe session close, CRM audit record, optional manual re-application block.

**Architecture:** CRM publishes `conversation.kill.requested.v1` (cls `cmd`) onto `chatLedger`; billieChat's Broker fans it out to the applicationState service (terminates the conversation, emits `conversation.killed.v1` back to the CRM) and the reapplicationBlock service (raises a `MANUAL_ADMIN` block when `block_requested`). The CRM event-processor projects `killed.v1` into `conversations.status='hard_end'` + a `kill_record` JSONB.

**Tech Stack:** Python 3.11/3.12 (billieChat: pydantic, fakeredis, pytest; billie-crm event-processor: asyncpg, MockPool) · TypeScript / Payload 3 / Next 16 / React 19 (pnpm, Zod, React Query, Vitest).

**Spec:** `docs/superpowers/specs/2026-08-24-conversation-kill-design.md` (billie-crm repo). Related ticket: BTB-295 (future FraudRiskAgent adoption — NOT in this plan).

## Global Constraints

- **Two repos.** Part A and C tasks run in `/Users/rohansharp/workspace/billieChat`; Part B tasks in `/Users/rohansharp/workspace/billie-crm`. Every task names its repo. Commit in the repo you changed.
- **billieChat tests:** run from `backend/`: `python -m pytest tests/unit/services/applicationState tests/unit/services/reapplicationBlock -v`. Do NOT run the full suite — it has known pre-existing failures/hangs unrelated to this work; scope to the listed dirs.
- **billie-crm Python tests:** run from `event-processor/`: `python3 -m pytest tests/<file> -v` (MockPool fixture, no real DB).
- **billie-crm TS:** Prettier (single quotes, no semicolons, trailing commas, 100 col). Vitest needs Docker: `pnpm exec vitest run <file> --config ./vitest.config.mts`. globalSetup can stall intermittently ("module-runner stall") — rerun clears it. After collection changes: `pnpm generate:types`.
- **Customer-facing stop message (exact copy, everywhere):** `This conversation has been ended by our team. If you have any questions, please contact our support team.`
- **Event names (exact):** `conversation.kill.requested.v1`, `conversation.killed.v1`. **Reason vocabulary (exact):** `fraud_abuse`, `operational`, `compliance`. **Actor format:** `user:<staff-id>` (later `system:fraudRiskAgent` — BTB-295).
- **routes.json is a silent-drop allowlist** — a typ without a route entry for its sender vanishes. Task 1 adds the entries; nothing works without them.
- Feature flags: billieChat `ENABLE_CONVERSATION_KILL` (Part A) and `ENABLE_MANUAL_KILL_BLOCK` (Part C) via `backend.src.config.feature_flag` (env var overrides `feature_flags` block in `config.<env>.json`). CRM checkbox gated by `NEXT_PUBLIC_ENABLE_KILL_BLOCK`.

---

## Part A — billieChat: kill command plumbing + handler (Phase 1)

### Task 1: Config keys + broker routes

**Repo:** `/Users/rohansharp/workspace/billieChat`

**Files:**
- Modify: `backend/backend/src/config.dev.json`, `config.demo.json`, `config.prod.json`, `config.test.json`
- Modify: `backend/backend/src/routing/routes.json`
- Test: `backend/tests/unit/services/applicationState/test_conversation_kill_config.py`

**Interfaces:**
- Produces: config keys `msg_type_conversation_kill_requested`, `msg_type_conversation_killed`, `conversationKill_stop_message`, feature flag `ENABLE_CONVERSATION_KILL`; broker routes for both events. Tasks 2 and 12 depend on these exact keys.

- [ ] **Step 1: Write the failing config test** (mirror `tests/unit/services/reapplicationBlock/test_block_clear_config.py`):

```python
"""The conversation-kill message types are configured in the active env."""

from __future__ import annotations

from backend.src.config import config


def test_kill_message_types_present() -> None:
    assert config.get("msg_type_conversation_kill_requested") == (
        "conversation.kill.requested.v1"
    )
    assert config.get("msg_type_conversation_killed") == "conversation.killed.v1"


def test_kill_stop_message_configured() -> None:
    msg = config.get("conversationKill_stop_message", "")
    assert "ended by our team" in msg
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/rohansharp/workspace/billieChat/backend && python -m pytest tests/unit/services/applicationState/test_conversation_kill_config.py -v`
Expected: FAIL (config.get returns None / empty).

- [ ] **Step 3: Add config keys to all four config.<env>.json** — alongside the existing `msg_type_*` keys (search for `msg_type_reapplication_block_clear_authorized` and add adjacent):

```json
  "msg_type_conversation_kill_requested": "conversation.kill.requested.v1",
  "msg_type_conversation_killed": "conversation.killed.v1",
  "conversationKill_stop_message": "This conversation has been ended by our team. If you have any questions, please contact our support team.",
```

and in each file's `"feature_flags"` block: `"ENABLE_CONVERSATION_KILL": true` for dev/demo/test, `false` for prod (flipped at rollout via config change or `fly secrets set ENABLE_CONVERSATION_KILL=true`).

- [ ] **Step 4: Add broker routes** in `backend/backend/src/routing/routes.json`:

(a) Append a condition to the existing `"${agent_billie-crm}"` sender array (after the `feedback.submit.requested.v1` entry):

```json
      {
        "condition": {
          "typ": "${msg_type_conversation_kill_requested}"
        },
        "targetAgent": [
          "${service_applicationState}",
          "${service_reapplicationBlock}"
        ]
      }
```

(b) Add a NEW top-level sender block (the applicationState service has no sender block today — verify with grep first; place it beside the other sender blocks inside `"routes"`):

```json
    "${service_applicationState}": [
      {
        "condition": {
          "typ": "${msg_type_conversation_killed}"
        },
        "targetAgent": [
          "${agent_billie-crm}"
        ]
      }
    ],
```

`${service_applicationState}`, `${service_reapplicationBlock}`, `${agent_billie-crm}` already resolve (used elsewhere in the file); the agent→inbox map at the bottom already contains them.

- [ ] **Step 5: Run test to verify pass** — same command as Step 2. Expected: PASS. Also run `python -c "import json; json.load(open('backend/src/routing/routes.json'))"` from `backend/` to prove the JSON still parses.

- [ ] **Step 6: Commit**

```bash
cd /Users/rohansharp/workspace/billieChat
git add backend/backend/src/config.*.json backend/backend/src/routing/routes.json backend/tests/unit/services/applicationState/test_conversation_kill_config.py
git commit -m "feat(kill): conversation-kill config keys + broker routes"
```

### Task 2: applicationState kill handler

**Repo:** `/Users/rohansharp/workspace/billieChat`

**Files:**
- Modify: `backend/backend/src/services/applicationState/application_state_service.py`
- Test: `backend/tests/unit/services/applicationState/test_conversation_kill.py`

**Interfaces:**
- Consumes: Task 1 config keys; `post_to_noticeboard` (`backend.src.utils.noticeboardUtils`); `push_to_ledger` (`backend.src.utils.ledgerUtils`); `LedgerMessage` (`backend.src.models.ledger`); `feature_flag` (`backend.src.config`).
- Produces: `_handle_conversation_kill(event_data, payload)` registered for `conversation.kill.requested.v1`; emits `conversation.killed.v1` with payload `{request_id, conversation_id, application_number, customer_id, reason_category, note, actor, killed_at}` — Task 7's CRM handler consumes exactly these keys.

- [ ] **Step 1: Write the failing tests** (fixture pattern mirrors `tests/unit/services/reapplicationBlock/test_service_state_events.py` — fakeredis + monkeypatched capture):

```python
"""conversation.kill.requested.v1 — operator-commanded conversation termination."""

from __future__ import annotations

import json

import fakeredis.aioredis as fakeredis_aio
import pytest

from backend.src.services.applicationState.application_state_service import (
    ApplicationStateService,
)

KILL_TYP = "conversation.kill.requested.v1"
KILLED_TYP = "conversation.killed.v1"
CONV = "c-kill-1"
APP = "APP-KILL-1"


@pytest.fixture(autouse=True)
def _flag_on(monkeypatch):
    monkeypatch.setenv("ENABLE_CONVERSATION_KILL", "true")


@pytest.fixture
def noticeboard_posts(monkeypatch):
    posts: list[dict] = []

    async def _capture(**kwargs):
        posts.append(kwargs)

    monkeypatch.setattr(
        "backend.src.services.applicationState.application_state_service.post_to_noticeboard",
        _capture,
    )
    return posts


@pytest.fixture
def emitted(monkeypatch):
    msgs: list = []

    async def _capture(entries):
        msgs.extend(entries)

    monkeypatch.setattr(
        "backend.src.services.applicationState.application_state_service.push_to_ledger",
        _capture,
    )
    return msgs


@pytest.fixture
def service():
    svc = ApplicationStateService(shared_data={})
    svc.redis = fakeredis_aio.FakeRedis(decode_responses=True)
    return svc


def _kill_event(request_id="req-1", **payload_overrides):
    payload = {
        "request_id": request_id,
        "conversation_id": CONV,
        "application_number": APP,
        "customer_id": "CUST1",
        "reason_category": "operational",
        "note": "stuck session",
        "actor": "user:42",
        "block_requested": False,
        "requested_at": "2026-08-24T05:00:00+00:00",
    }
    payload.update(payload_overrides)
    return {
        "typ": KILL_TYP,
        "conv": CONV,
        "usr": "CUST1",
        "seq": "1",
        "payload": json.dumps(payload),
    }


@pytest.mark.asyncio
async def test_kill_posts_stop_and_closes_session(service, noticeboard_posts, emitted):
    await service.process_message("evt-1", _kill_event())
    assert len(noticeboard_posts) == 1
    post = noticeboard_posts[0]
    assert post["end_conversation"] is True
    assert post["force_turn"] is True
    assert "ended by our team" in post["end_conversation_text"]
    assert post["conversation_id"] == CONV
    closed = await service.redis.hget(f"noticeboard:{APP}", "data::conversation")
    assert closed is not None and CONV in closed
    killed = [m for m in emitted if m.typ == KILLED_TYP]
    assert len(killed) == 1
    body = killed[0].payload if isinstance(killed[0].payload, dict) else json.loads(killed[0].payload)
    assert body["request_id"] == "req-1"
    assert body["actor"] == "user:42"
    assert body["reason_category"] == "operational"
    assert body["killed_at"]


@pytest.mark.asyncio
async def test_duplicate_request_id_noop(service, noticeboard_posts, emitted):
    await service.process_message("evt-1", _kill_event())
    await service.process_message("evt-2", _kill_event())
    assert len(noticeboard_posts) == 1
    assert len([m for m in emitted if m.typ == KILLED_TYP]) == 1


@pytest.mark.asyncio
async def test_flag_off_noop(service, noticeboard_posts, emitted, monkeypatch):
    monkeypatch.setenv("ENABLE_CONVERSATION_KILL", "false")
    await service.process_message("evt-1", _kill_event())
    assert not noticeboard_posts and not emitted


@pytest.mark.asyncio
async def test_missing_request_id_noop(service, noticeboard_posts, emitted):
    await service.process_message("evt-1", _kill_event(request_id=None))
    assert not noticeboard_posts and not emitted


@pytest.mark.asyncio
async def test_missing_application_number_still_kills_and_emits(
    service, noticeboard_posts, emitted
):
    await service.process_message("evt-1", _kill_event(application_number=None))
    assert len(noticeboard_posts) == 1
    assert len([m for m in emitted if m.typ == KILLED_TYP]) == 1


@pytest.mark.asyncio
async def test_failed_post_releases_idempotency_claim(service, emitted, monkeypatch):
    async def _boom(**kwargs):
        raise RuntimeError("noticeboard down")

    monkeypatch.setattr(
        "backend.src.services.applicationState.application_state_service.post_to_noticeboard",
        _boom,
    )
    # BaseAgent.process_message catches exceptions; call the handler directly to
    # assert the claim release semantics.
    event = _kill_event()
    with pytest.raises(RuntimeError):
        await service._handle_conversation_kill(event, json.loads(event["payload"]))
    assert await service.redis.get("kill:req-1") is None
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/rohansharp/workspace/billieChat/backend && python -m pytest tests/unit/services/applicationState/test_conversation_kill.py -v`
Expected: FAIL — `AttributeError: ... has no attribute '_handle_conversation_kill'` / no handler registered.

NOTE: `ApplicationStateService.process_message` swallows generic exceptions (logs + returns). If the dispatch tests fail because of that catch, keep the assertions but call `service._handle_conversation_kill(event_data, payload)` directly for the failure-path test only (as written above); the happy-path tests must go through `process_message` to prove registration.

- [ ] **Step 3: Implement the handler** in `application_state_service.py`:

Add imports at the top (beside the existing ones):

```python
from backend.src.config import config, feature_flag
from backend.src.models.ledger import LedgerMessage
from backend.src.utils.ledgerUtils import push_to_ledger
from backend.src.utils.noticeboardUtils import post_to_noticeboard
```

(the module already imports `config`; extend that import line rather than duplicating it)

Add to the `self._handlers` dict in `__init__`:

```python
            config.get(
                "msg_type_conversation_kill_requested",
                "conversation.kill.requested.v1",
            ): self._handle_conversation_kill,
```

Add module-level constant and the handler:

```python
KILL_IDEMPOTENCY_TTL_SECONDS = 86400


    async def _handle_conversation_kill(
        self, event_data: Dict[str, Any], payload: Dict[str, Any]
    ):
        """Operator-commanded conversation termination (spec: conversation-kill design).

        Neutral stop message + zombie-safe session close + killed audit event.
        Fire-once per request_id; the claim is released on failure so BaseAgent
        redelivery can re-attempt (mirrors the fraudRiskAgent halt claim).
        """
        if not feature_flag("ENABLE_CONVERSATION_KILL"):
            return
        request_id = payload.get("request_id")
        conversation_id = payload.get("conversation_id") or event_data.get("conv")
        if not (request_id and conversation_id):
            logger.warning(
                f"{self.agent_name}: conversation.kill.requested.v1 missing "
                f"request_id/conversation_id — dropping"
            )
            return
        customer_id = payload.get("customer_id") or event_data.get("usr") or ""
        application_number = self._extract_application_number(event_data, payload)

        claim_key = f"kill:{request_id}"
        claimed = await self.redis.set(
            claim_key, "1", nx=True, ex=KILL_IDEMPOTENCY_TTL_SECONDS
        )
        if not claimed:
            logger.info(f"{self.agent_name}: duplicate kill {request_id} — skipping")
            return

        try:
            stop_message = config.get(
                "conversationKill_stop_message",
                "This conversation has been ended by our team. "
                "If you have any questions, please contact our support team.",
            )
            await post_to_noticeboard(
                agent_name="conversationKill",
                post_content=stop_message,
                conversation_id=conversation_id,
                customer_id=customer_id,
                seq=0,
                post_type="conversationKill",
                application_number=application_number or "",
                force_turn=True,
                end_conversation=True,
                end_conversation_text=stop_message,
            )
            if application_number:
                # Zombie-safe close — mirrors the CLA directive handler's
                # loan-agreement close (data::conversation → closed).
                await self.redis.hset(
                    f"noticeboard:{application_number}",
                    "data::conversation",
                    json.dumps(
                        {
                            conversation_id: {
                                "conversation_status": config.get(
                                    "conversation_status_closed"
                                )
                            }
                        }
                    ),
                )
            else:
                logger.warning(
                    f"{self.agent_name}: kill {request_id} without "
                    f"application_number — session hash not closed"
                )
            await push_to_ledger(
                [
                    LedgerMessage(
                        conv=conversation_id,
                        agt=self.agent_name,
                        usr=customer_id or "system",
                        seq=int(event_data.get("seq") or 0) + 1,
                        cls="msg",
                        typ=config.get(
                            "msg_type_conversation_killed", "conversation.killed.v1"
                        ),
                        payload={
                            "request_id": request_id,
                            "conversation_id": conversation_id,
                            "application_number": application_number or "",
                            "customer_id": customer_id,
                            "reason_category": payload.get("reason_category", ""),
                            "note": payload.get("note", ""),
                            "actor": payload.get("actor", ""),
                            "killed_at": datetime.now(timezone.utc).isoformat(),
                        },
                    )
                ]
            )
            logger.warning(
                f"{self.agent_name}: conversation {conversation_id} killed "
                f"(request {request_id}, actor {payload.get('actor', '?')})"
            )
        except Exception:
            # The fire-once claim only means something if the kill went out.
            await self.redis.delete(claim_key)
            raise
```

(`datetime`/`timezone` and `json` are already imported at the top of the module.)

If `LedgerMessage` rejects a dict payload (pydantic type is `str` in this repo's model), wrap it: `payload=json.dumps({...})` — mirror whatever `_emit_clear_event` in `reapplication_block_service.py` does; it passes a dict.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /Users/rohansharp/workspace/billieChat/backend && python -m pytest tests/unit/services/applicationState/ -v`
Expected: all PASS (new + pre-existing applicationState tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/rohansharp/workspace/billieChat
git add backend/backend/src/services/applicationState/application_state_service.py backend/tests/unit/services/applicationState/test_conversation_kill.py
git commit -m "feat(kill): applicationState conversation-kill handler — stop post, session close, killed event"
```

### Task 3: Part A verification

**Repo:** `/Users/rohansharp/workspace/billieChat`

- [ ] **Step 1:** `cd /Users/rohansharp/workspace/billieChat/backend && python -m pytest tests/unit/services/applicationState tests/unit/services/reapplicationBlock tests/unit/routing -v` — Expected: PASS (pre-existing failures outside these dirs are out of scope; do not chase).
- [ ] **Step 2:** `cd /Users/rohansharp/workspace/billieChat && git add -A && git commit -m "chore(kill): part A verification fixes" || echo "nothing to commit"`

---

## Part B — billie-crm: publisher, API, UI, projection (Phase 1)

### Task 4: Event types, schema, chatLedger publisher

**Repo:** `/Users/rohansharp/workspace/billie-crm`

**Files:**
- Modify: `src/lib/events/config.ts`, `src/lib/events/types.ts`, `src/lib/events/schemas.ts`
- Modify: `src/server/chatledger-publisher.ts`

**Interfaces:**
- Produces: `EVENT_TYPE_CONVERSATION_KILL_REQUESTED`; `ConversationKillCommandSchema` (zod) + `ConversationKillCommand` type; `ConversationKillPayload` type; `publishConversationKill(payload: ConversationKillPayload): Promise<{ eventId: string }>`. Task 5 consumes all of these.

- [ ] **Step 1: Add the event type** to `src/lib/events/config.ts` (beside the other `EVENT_TYPE_*` exports):

```ts
/**
 * Command: operator-initiated conversation termination (spec 2026-08-24).
 */
export const EVENT_TYPE_CONVERSATION_KILL_REQUESTED =
  process.env.EVENT_TYPE_CONVERSATION_KILL_REQUESTED ?? 'conversation.kill.requested.v1'
```

- [ ] **Step 2: Add the payload type** to `src/lib/events/types.ts`:

```ts
/**
 * conversation.kill.requested.v1 — payload published to chatLedger.
 * Consumed by billieChat applicationState (kill) and reapplicationBlock
 * (manual block when block_requested).
 */
export interface ConversationKillPayload {
  request_id: string
  conversation_id: string
  application_number: string
  customer_id: string
  reason_category: 'fraud_abuse' | 'operational' | 'compliance'
  note: string
  actor: string // "user:<staff-id>" | "system:<agent>"
  block_requested: boolean
  requested_at: string
}
```

- [ ] **Step 3: Add the command schema** to `src/lib/events/schemas.ts` (beside `BlockClearRequestCommandSchema`):

```ts
/**
 * Schema for the conversation kill command (input from client).
 */
export const ConversationKillCommandSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
  applicationNumber: z.string().optional(),
  customerId: z.string().min(1, 'Customer ID is required'),
  reasonCategory: z.enum(['fraud_abuse', 'operational', 'compliance']),
  note: z.string().max(500).optional(),
  blockRequested: z.boolean().optional(),
})

export type ConversationKillCommand = z.infer<typeof ConversationKillCommandSchema>
```

- [ ] **Step 4: Add `publishConversationKill`** to `src/server/chatledger-publisher.ts` — copy `publishClearAuthorized` verbatim and adjust (same lazyConnect + retry loop):

```ts
/**
 * Publish a conversation.kill.requested.v1 command to chatLedger.
 *
 * Routed by billieChat's Broker to applicationState (kill) and
 * reapplicationBlock (optional manual block). Uses the REAL conversation id
 * as `conv` — the kill applies to a live customer conversation.
 */
export async function publishConversationKill(
  payload: ConversationKillPayload,
): Promise<{ eventId: string }> {
  const eventId = nanoid()
  const fields: Record<string, string> = {
    conv: payload.conversation_id,
    agt: CRM_AGENT_ID,
    usr: payload.customer_id,
    seq: '1',
    cls: 'cmd',
    typ: EVENT_TYPE_CONVERSATION_KILL_REQUESTED,
    cause: eventId,
    payload: JSON.stringify(payload),
  }
  const redis = getChatLedgerRedisClient()
  let lastError: Error | undefined
  for (let attempt = 0; attempt < PUBLISH_MAX_RETRIES; attempt++) {
    try {
      if (redis.status === 'wait') {
        await redis.connect()
      }
      await redis.xadd(CHATLEDGER_STREAM, '*', ...Object.entries(fields).flat())
      return { eventId }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.warn(
        `[ChatLedgerPublisher] Attempt ${attempt + 1}/${PUBLISH_MAX_RETRIES} failed:`,
        lastError.message,
      )
      if (attempt < PUBLISH_MAX_RETRIES - 1) {
        await sleep(PUBLISH_BACKOFF_MS[attempt] ?? 400)
      }
    }
  }
  throw new EventPublishError('Failed to publish conversation kill after retries', {
    attempts: PUBLISH_MAX_RETRIES,
    cause: lastError,
  })
}
```

Import `EVENT_TYPE_CONVERSATION_KILL_REQUESTED` in the config import block and `ConversationKillPayload` in the types import block of that file.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec prettier --write src/lib/events src/server/chatledger-publisher.ts && pnpm lint`
Expected: 0 errors.

```bash
git add src/lib/events src/server/chatledger-publisher.ts
git commit -m "feat(kill): conversation-kill event type, schema, chatLedger publisher"
```

(Tested through Task 5's route tests — the publisher is IO glue, same as the untested `publishClearAuthorized` precedent.)

### Task 5: API route `POST /api/commands/conversation-kill`

**Repo:** `/Users/rohansharp/workspace/billie-crm`

**Files:**
- Create: `src/app/api/commands/conversation-kill/route.ts`
- Test: `tests/unit/routes/conversationKill.test.ts`

**Interfaces:**
- Consumes: Task 4's `ConversationKillCommandSchema`, `publishConversationKill`; `requireAuth`/`canService` (`@/lib/auth`, `@/lib/access`), `hasApprovalAuthority` (`@/lib/access`).
- Produces: 202 `{ eventId, requestId, status: 'accepted' }`; 403 for non-approvers. Task 9's mutation hook consumes this contract.

- [ ] **Step 1: Write the failing tests.** Read `tests/unit/routes/reappBlockClearRequest.test.ts` FIRST and copy its mocking setup exactly (how it mocks `@/lib/auth` and the publisher module). The cases to cover:

```ts
// tests/unit/routes/conversationKill.test.ts — follow the mock harness of
// reappBlockClearRequest.test.ts verbatim; the assertions below are the contract.

// 1. supervisor/admin + valid body → 202, publishConversationKill called once with
//    payload containing conversation_id, actor `user:<id>`, reason_category,
//    block_requested false when omitted, and a non-empty request_id
// 2. operations-role user → 403, publisher NOT called
// 3. invalid body (missing conversationId / bad reasonCategory) → 400 VALIDATION_ERROR
// 4. publisher throws EventPublishError → 503 EVENT_PUBLISH_FAILED
```

Each numbered case is one `it(...)` with real assertions (`expect(res.status).toBe(202)` etc.) — no pseudo-tests.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/unit/routes/conversationKill.test.ts --config ./vitest.config.mts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route** — mirror `src/app/api/commands/reapp-block-clear/request/route.ts` structure:

```ts
/**
 * API Route: POST /api/commands/conversation-kill
 *
 * End a live billieChat conversation (admin/supervisor only). Publishes
 * conversation.kill.requested.v1 to chatLedger; billieChat terminates the
 * conversation and emits conversation.killed.v1 back for the projection.
 * Fires immediately (confirm-modal ceremony — no approval round-trip).
 * Returns 202 Accepted.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { requireAuth } from '@/lib/auth'
import { canService, hasApprovalAuthority } from '@/lib/access'
import { ConversationKillCommandSchema } from '@/lib/events/schemas'
import { EventPublishError } from '@/server/event-publisher'
import { publishConversationKill } from '@/server/chatledger-publisher'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user } = auth
    if (!hasApprovalAuthority(user)) {
      return NextResponse.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Ending a conversation requires supervisor or admin authority.',
          },
        },
        { status: 403 },
      )
    }

    const parsed = ConversationKillCommandSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      )
    }
    const cmd = parsed.data

    const requestId = nanoid()
    const { eventId } = await publishConversationKill({
      request_id: requestId,
      conversation_id: cmd.conversationId,
      application_number: cmd.applicationNumber ?? '',
      customer_id: cmd.customerId,
      reason_category: cmd.reasonCategory,
      note: cmd.note ?? '',
      actor: `user:${user.id}`,
      block_requested: cmd.blockRequested ?? false,
      requested_at: new Date().toISOString(),
    })
    return NextResponse.json(
      { eventId, requestId, status: 'accepted', message: 'Conversation kill submitted' },
      { status: 202 },
    )
  } catch (error) {
    console.error('[ConversationKill] Error:', error)
    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'Failed to submit. Please try again.',
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

- [ ] **Step 4: Run tests to verify pass** — same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/commands/conversation-kill tests/unit/routes/conversationKill.test.ts
git commit -m "feat(kill): conversation-kill command route (supervisor/admin, 202)"
```

### Task 6: `killRecord` field on Conversations + migration

**Repo:** `/Users/rohansharp/workspace/billie-crm`

**Files:**
- Modify: `src/collections/Conversations.ts`
- Create: `src/migrations/<YYYYMMDD_HHMMSS>_conversation_kill_record.ts` (+ register in `src/migrations/index.ts` if the generator doesn't)
- Modify (generated): `src/payload-types.ts`

**Interfaces:**
- Produces: column `conversations.kill_record` (jsonb) + `Conversation['killRecord']` type. Tasks 7 and 8 consume the column/field.

- [ ] **Step 1: Add the field** in `src/collections/Conversations.ts`, as a sibling AFTER the `assessments` group (search `name: 'assessments'`, add after that group's closing brace):

```ts
    {
      name: 'killRecord',
      type: 'json',
      admin: {
        readOnly: true,
        description:
          'Operator conversation-kill audit: {request_id, actor, reason_category, note, killed_at}',
      },
    },
```

- [ ] **Step 2: Create the migration.** Preferred: `make -C infra/fly pg-migrate-create ENV=dev NAME=conversation_kill_record` against a local throwaway Postgres (see `docs/` migration recipe — branch must be on latest main or the generator drops others' migrations). If no local Postgres, hand-author (match `src/migrations/20260822_121203_reapplication_block_state_version.ts` format):

```ts
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "kill_record" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "conversations" DROP COLUMN IF EXISTS "kill_record";`)
}
```

- [ ] **Step 3:** `pnpm generate:types` — Expected: `killRecord` appears on the `Conversation` interface in `src/payload-types.ts`.

- [ ] **Step 4:** `pnpm lint` — Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/collections/Conversations.ts src/migrations src/payload-types.ts
git commit -m "feat(kill): conversations.killRecord field + migration"
```

### Task 7: Event-processor `handle_conversation_killed`

**Repo:** `/Users/rohansharp/workspace/billie-crm`

**Files:**
- Modify: `event-processor/src/billie_servicing/handlers/conversation.py`
- Modify: `event-processor/src/billie_servicing/handlers/__init__.py` (export)
- Modify: `event-processor/src/billie_servicing/main.py` (register)
- Test: `event-processor/tests/test_conversation_kill.py`

**Interfaces:**
- Consumes: `conversation.killed.v1` payload from Task 2 (`{request_id, conversation_id, application_number, customer_id, reason_category, note, actor, killed_at}`); Task 6's `kill_record` column.
- Produces: `async handle_conversation_killed(pool, event)` — sets `status='hard_end'`, writes `kill_record` jsonb, bumps version. Update-only.

- [ ] **Step 1: Write the failing tests** (MockPool conventions — see `tests/test_fraud_risk.py`):

```python
"""Tests for the conversation.killed.v1 projection handler."""
import json

import pytest

from billie_servicing.handlers.conversation import handle_conversation_killed

CONV = "9a1fe3c2-0d6b-4091-8a3a-6c148a4c4142"

KILLED_PAYLOAD = {
    "request_id": "req-9",
    "conversation_id": CONV,
    "application_number": "APP-1",
    "customer_id": "CUST1",
    "reason_category": "fraud_abuse",
    "note": "live abuse",
    "actor": "user:42",
    "killed_at": "2026-08-24T05:00:00+00:00",
}


def _event(payload=None):
    return {"typ": "conversation.killed.v1", "usr": "CUST1", "conv": CONV,
            "payload": dict(payload or KILLED_PAYLOAD)}


class TestConversationKilled:
    @pytest.mark.asyncio
    async def test_sets_hard_end_and_kill_record(self, mock_pool):
        await handle_conversation_killed(mock_pool, _event())
        updates = [c for c in mock_pool.calls_against("conversations")
                   if c.op == "UPDATE" and "kill_record" in c.values]
        assert len(updates) == 1
        call = updates[0]
        assert call.values["status"] == "hard_end"
        record = json.loads(call.args[1])
        assert record["actor"] == "user:42"
        assert record["reason_category"] == "fraud_abuse"
        assert record["request_id"] == "req-9"
        assert record["killed_at"] == "2026-08-24T05:00:00+00:00"
        assert call.where.get("conversation_id") == CONV

    @pytest.mark.asyncio
    async def test_update_only_and_version_bump(self, mock_pool):
        await handle_conversation_killed(mock_pool, _event())
        assert len(mock_pool.calls) == 1
        call = mock_pool.calls[0]
        assert call.op == "UPDATE"
        assert "version = COALESCE(version, 1) + 1" in call.sql

    @pytest.mark.asyncio
    async def test_missing_conversation_id_skips(self, mock_pool):
        payload = dict(KILLED_PAYLOAD)
        payload.pop("conversation_id")
        event = {"typ": "conversation.killed.v1", "payload": payload}
        await handle_conversation_killed(mock_pool, event)
        assert not mock_pool.calls
```

- [ ] **Step 2: Run to verify failure**

Run: `cd event-processor && python3 -m pytest tests/test_conversation_kill.py -v`
Expected: FAIL — ImportError (`handle_conversation_killed` not defined).

- [ ] **Step 3: Implement** in `handlers/conversation.py` (beside `handle_final_decision`):

```python
async def handle_conversation_killed(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Project conversation.killed.v1 — operator/system conversation kill.

    Sets the terminal status and stores the audit record. Update-only: a kill
    for an unknown conversation updates nothing.
    """
    payload = parse_payload(event)
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or payload.get("conversation_id"),
        "conversation_id",
    )
    log = logger.bind(conversation_id=conversation_id)
    if not conversation_id:
        log.warning("conversation.killed.v1 without conversation id — skipping")
        return

    kill_record = {
        "request_id": payload.get("request_id"),
        "actor": payload.get("actor"),
        "reason_category": payload.get("reason_category"),
        "note": payload.get("note"),
        "killed_at": payload.get("killed_at"),
    }
    await pool.execute(
        "UPDATE conversations SET status = $1, kill_record = $2::jsonb, "
        "updated_at = NOW(), version = COALESCE(version, 1) + 1 "
        "WHERE conversation_id = $3",
        "hard_end",
        json.dumps(kill_record),
        conversation_id,
    )
    log.info("conversation kill projected", actor=payload.get("actor"))
```

Note the test asserts `call.args[1]` is the JSON — keep the argument order `(status, kill_record, conversation_id)`.

Export it from `handlers/__init__.py` (add to the import block and `__all__`), and register in `main.py` beside the conversation handlers:

```python
    processor.register_handler("conversation.killed.v1", handle_conversation_killed)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd event-processor && python3 -m pytest tests/test_conversation_kill.py tests/test_handler_exports.py -v`
Expected: PASS (handler-exports test confirms `__init__`/`__all__` sync).

- [ ] **Step 5: Commit**

```bash
git add event-processor/
git commit -m "feat(kill): project conversation.killed.v1 — hard_end + killRecord audit"
```

### Task 8: Detail API + schema expose `killRecord`

**Repo:** `/Users/rohansharp/workspace/billie-crm`

**Files:**
- Modify: `src/app/api/conversations/[conversationId]/route.ts`
- Modify: `src/lib/schemas/conversations.ts`

**Interfaces:**
- Consumes: Task 6's `killRecord` Payload field.
- Produces: `ConversationDetail['killRecord']` — `{request_id?, actor?, reason_category?, note?, killed_at?} | null`. Task 9's UI consumes it.

- [ ] **Step 1: Schema.** In `src/lib/schemas/conversations.ts`, near `DecisionDetailSchema`, add:

```ts
export const KillRecordSchema = z.object({
  request_id: z.string().nullable().optional(),
  actor: z.string().nullable().optional(),
  reason_category: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  killed_at: z.string().nullable().optional(),
})
```

and add to the ConversationDetail schema (beside `decisionDetail`, ~line 186):

```ts
  killRecord: KillRecordSchema.nullable().optional(),
```

- [ ] **Step 2: Route.** In `src/app/api/conversations/[conversationId]/route.ts`, find where the response object maps `decisionDetail`/`finalDecision` from the Payload doc and add the sibling line:

```ts
    killRecord: (conversation.killRecord as ConversationDetail['killRecord']) ?? null,
```

(match the file's existing casting style — if neighbours don't cast, don't cast).

- [ ] **Step 3:** `pnpm lint` — 0 errors. There is no dedicated test for this route's field mapping (matches the `decisionDetail` precedent); Task 9's component tests cover the shape end-to-side.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/conversations src/lib/schemas/conversations.ts
git commit -m "feat(kill): expose killRecord on conversation detail API"
```

### Task 9: UI — button, modal, banner

**Repo:** `/Users/rohansharp/workspace/billie-crm`

**Files:**
- Create: `src/components/ConversationDetailView/EndConversation/index.tsx` (button + modal + banner in one focused module)
- Create: `src/hooks/mutations/useKillConversation.ts` (+ barrel export in `src/hooks/index.ts` — follow the existing mutation exports)
- Modify: `src/components/ConversationDetailView/index.tsx` (render button in header, banner above panels)
- Modify: `src/components/ConversationDetailView/styles.module.css` (banner + modal styles — reuse existing tokens/patterns from `src/components/BlockClear/ClearBlockModal.tsx`'s css approach)
- Test: `tests/unit/components/EndConversation.test.tsx`

**Interfaces:**
- Consumes: Task 5's route contract; Task 8's `killRecord`; `hasApprovalAuthority` (`@/lib/access`); `useAuth` (`@payloadcms/ui`).
- Produces: `<EndConversationButton conversation={...} conversationId={...} />` and `<KillBanner killRecord={...} />`.

- [ ] **Step 1: Write the failing tests.** Follow `tests/unit/ui/assessment-views.test.tsx` conventions — QueryClientProvider wrapper, and the MANDATORY `vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: mockUser }) }))` (without it the suite fails to collect on react-image-crop CSS). Cases:

```ts
// 1. supervisor user + status 'active' → button "End conversation" renders
// 2. operations user → button absent
// 3. status 'hard_end' → button absent
// 4. clicking button opens modal: shows the exact customer-facing copy
//    ("This conversation has been ended by our team…"), three reason radios,
//    note textarea; confirm disabled until a reason is selected
// 5. confirm posts to /api/commands/conversation-kill with
//    {conversationId, customerId, reasonCategory, note} (mock fetch; assert body)
// 6. killRecord present → banner renders "Ended by user:42 · fraud_abuse · <date>"
// 7. NEXT_PUBLIC_ENABLE_KILL_BLOCK unset → no block checkbox in the modal
```

Each numbered case is one `it(...)` with real render + assertions.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/unit/components/EndConversation.test.tsx --config ./vitest.config.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Mutation hook:

```ts
// src/hooks/mutations/useKillConversation.ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ConversationKillCommand } from '@/lib/events/schemas'

export function useKillConversation(conversationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (cmd: ConversationKillCommand) => {
      const res = await fetch('/api/commands/conversation-kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(cmd),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error?.message ?? 'Failed to end conversation')
      }
      return res.json() as Promise<{ eventId: string; requestId: string }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
    },
  })
}
```

(check `src/hooks/queries/useConversation.ts` for the exact query key it uses and invalidate THAT key.)

Component module `EndConversation/index.tsx`: `EndConversationButton` (guards: `hasApprovalAuthority(user)` from `useAuth()`, `['active', 'paused'].includes(conversation.status ?? '')`), modal with the reason radios / note / hidden-unless-flag checkbox (`process.env.NEXT_PUBLIC_ENABLE_KILL_BLOCK === 'true'`), confirm button disabled until a reason is chosen, pending state from the mutation, error rendered inline; `KillBanner` renders `Ended by {actor} · {reason_category} · {formatDateMedium(killed_at)}`. Model the modal markup/ARIA on `src/components/BlockClear/ClearBlockModal.tsx` (dialog role, focus handling, Escape close) — `docs/ux-standards.md` is the conformance floor.

Wire into `ConversationDetailView/index.tsx`: banner directly under the header `div`, button inside the header actions area (beside the breadcrumb/status region), passing `conversation` and `conversationId`.

- [ ] **Step 4: Run tests to verify pass** — Step 2 command plus `pnpm exec vitest run tests/unit/ui/assessment-views.test.tsx --config ./vitest.config.mts` (proves the detail view still renders). Expected: PASS.

- [ ] **Step 5:** `pnpm exec prettier --write src/components/ConversationDetailView src/hooks tests/unit/components/EndConversation.test.tsx && pnpm lint` — 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ConversationDetailView src/hooks tests/unit/components/EndConversation.test.tsx
git commit -m "feat(kill): End-conversation button, confirm modal, kill banner"
```

### Task 10: Part B verification

**Repo:** `/Users/rohansharp/workspace/billie-crm`

- [ ] **Step 1:** `cd event-processor && python3 -m pytest -q` — Expected: all pass.
- [ ] **Step 2:** `cd /Users/rohansharp/workspace/billie-crm && pnpm lint && pnpm test:int` — Expected: 0 lint errors; vitest suite passes (rerun once on the known globalSetup stall).
- [ ] **Step 3:** `git add -A && git commit -m "chore(kill): part B verification fixes" || echo "nothing to commit"`

---

## Part C — Optional manual block (Phase 2)

### Task 11: `MANUAL_ADMIN` block reason + state model + evaluation

**Repo:** `/Users/rohansharp/workspace/billieChat`

**Files:**
- Modify: `backend/backend/src/services/reapplicationBlock/enums.py`
- Modify: `backend/backend/src/services/reapplicationBlock/models.py`
- Modify: `backend/backend/src/services/reapplicationBlock/block_evaluation.py`
- Test: `backend/tests/unit/services/reapplicationBlock/test_manual_block.py`

**Interfaces:**
- Produces: `BlockReason.MANUAL_ADMIN`; `ManualBlock` pydantic model; `ReapplicationBlockState.manual_block: Optional[ManualBlock]`; `evaluate_block` returns a MANUAL_ADMIN block decision unless cleared. Task 12 consumes all of these.

- [ ] **Step 1: Write the failing tests:**

```python
"""MANUAL_ADMIN block: raised by conversation-kill, cleared via manual override."""

from __future__ import annotations

import pytest

from backend.src.services.reapplicationBlock.block_evaluation import evaluate_block
from backend.src.services.reapplicationBlock.enums import (
    BlockReason,
    CLEARABLE_REASONS,
    REASONS_REQUIRING_APPROVAL,
)
from backend.src.services.reapplicationBlock.models import (
    ManualBlock,
    ManualOverride,
    ReapplicationBlockState,
)


def _state(**kwargs) -> ReapplicationBlockState:
    return ReapplicationBlockState(canonical_customer_id="C1", **kwargs)


def _manual_block(blocked_at="2026-08-24T05:00:00+00:00") -> ManualBlock:
    return ManualBlock(
        blocked_at=blocked_at,
        reason_category="fraud_abuse",
        actor="user:42",
        note="",
        request_id="req-1",
    )


def test_manual_block_blocks() -> None:
    decision = evaluate_block(_state(manual_block=_manual_block()))
    assert decision.blocked is True
    assert decision.reason == BlockReason.MANUAL_ADMIN


def test_no_manual_block_no_block() -> None:
    assert evaluate_block(_state()).blocked is False


def test_manual_block_cleared_by_override() -> None:
    state = _state(
        manual_block=_manual_block(blocked_at="2026-08-24T05:00:00+00:00"),
        manual_override=ManualOverride(
            cleared_at="2026-08-25T00:00:00+00:00",
            cleared_reasons=[BlockReason.MANUAL_ADMIN.value],
            operator_id="op-2",
            justification="reviewed, false positive",
            request_id="clear-1",
        ),
    )
    assert evaluate_block(state).blocked is False


def test_newer_manual_block_survives_older_clear() -> None:
    state = _state(
        manual_block=_manual_block(blocked_at="2026-08-26T00:00:00+00:00"),
        manual_override=ManualOverride(
            cleared_at="2026-08-25T00:00:00+00:00",
            cleared_reasons=[BlockReason.MANUAL_ADMIN.value],
            operator_id="op-2",
            justification="cleared before re-block",
            request_id="clear-1",
        ),
    )
    assert evaluate_block(state).blocked is True


def test_manual_admin_clearable_with_approval() -> None:
    assert BlockReason.MANUAL_ADMIN.value in CLEARABLE_REASONS
    assert BlockReason.MANUAL_ADMIN.value in REASONS_REQUIRING_APPROVAL
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/rohansharp/workspace/billieChat/backend && python -m pytest tests/unit/services/reapplicationBlock/test_manual_block.py -v`
Expected: FAIL — ImportError (`ManualBlock` not defined).

- [ ] **Step 3: Implement.**

`enums.py` — add to `BlockReason`:

```python
    # Operator-raised block from the CRM conversation-kill flow (2026-08-24 spec).
    # No expiry window — stands until deliberately cleared (maker-checker).
    MANUAL_ADMIN = "MANUAL_ADMIN"
```

and add `BlockReason.MANUAL_ADMIN.value` to BOTH `CLEARABLE_REASONS` and `REASONS_REQUIRING_APPROVAL` frozensets.

`models.py` — beside `ManualOverride`:

```python
class ManualBlock(BaseModel):
    """An operator-raised block (CRM conversation-kill with block_requested).

    Point-in-time like ManualOverride: a manual override clears it only when
    ``blocked_at <= cleared_at`` — a block raised after a clear re-blocks.
    """

    blocked_at: str  # ISO-8601 UTC
    reason_category: str  # kill-command vocabulary (fraud_abuse | operational | compliance)
    actor: str  # "user:<staff-id>" | "system:<agent>"
    note: str = ""
    request_id: str  # idempotency key
```

and on `ReapplicationBlockState` (beside `manual_override`):

```python
    # Operator-raised manual block (conversation-kill). None = no manual block.
    manual_block: Optional[ManualBlock] = None
```

`block_evaluation.py` — in `evaluate_block`, immediately after the `state is None` early-return (deliberate staff action outranks every fact-derived block; look at how the existing code reads `state.manual_override` around line 227 and reuse its cleared-watermark comparison style):

```python
    # Operator-raised manual block (conversation-kill, 2026-08-24 spec) —
    # outranks fact-derived blocks; suppressed only by a manual override that
    # names MANUAL_ADMIN with a cleared_at at/after the block instant.
    if state.manual_block is not None:
        override = state.manual_override
        cleared = (
            override is not None
            and BlockReason.MANUAL_ADMIN.value in override.cleared_reasons
            and state.manual_block.blocked_at <= override.cleared_at
        )
        if not cleared:
            return BlockDecision(
                True, BlockReason.MANUAL_ADMIN, MessageVariant.GENERIC_RETURNING
            )
```

(`MessageVariant.GENERIC_RETURNING` — neutral returning-customer copy; the kill reason must never leak to the customer.)

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/rohansharp/workspace/billieChat/backend && python -m pytest tests/unit/services/reapplicationBlock/ -v`
Expected: new tests pass AND all pre-existing reapplicationBlock tests still pass (the new field defaults to None so legacy blobs deserialise unchanged).

- [ ] **Step 5: Commit**

```bash
cd /Users/rohansharp/workspace/billieChat
git add backend/backend/src/services/reapplicationBlock backend/tests/unit/services/reapplicationBlock/test_manual_block.py
git commit -m "feat(kill): MANUAL_ADMIN block reason + ManualBlock state + evaluation"
```

### Task 12: reapplicationBlock kill-command handler

**Repo:** `/Users/rohansharp/workspace/billieChat`

**Files:**
- Modify: `backend/backend/src/services/reapplicationBlock/reapplication_block_service.py`
- Modify: `backend/backend/src/services/reapplicationBlock/repository.py`
- Test: `backend/tests/unit/services/reapplicationBlock/test_manual_block_handler.py`

**Interfaces:**
- Consumes: Task 1 config key `msg_type_conversation_kill_requested`; Task 11's `ManualBlock` / `MANUAL_ADMIN`; the repository's CAS update machinery; feature flag `ENABLE_MANUAL_KILL_BLOCK`.
- Produces: `_handle_conversation_kill(event_data, payload)` that raises the block when `block_requested`; `repository.apply_manual_block(canonical_id, manual_block)`. State-changed emission happens via the EXISTING after-commit hook (`_on_state_committed`) — no new emit code.

- [ ] **Step 1: Write the failing tests** (same fixtures as `test_service_state_events.py` — fakeredis service fixture, `emitted` push_to_ledger capture, `ENABLE_REAPPLICATION_BLOCK_STATE_EVENTS` env on; add `monkeypatch.setenv("ENABLE_MANUAL_KILL_BLOCK", "true")` as an autouse fixture):

```python
# Cases (each a real test function using the fixture pattern above):
# 1. block_requested=True → repository state has manual_block with the
#    command's request_id/actor; evaluate_block(state) is blocked with
#    BlockReason.MANUAL_ADMIN; a reapplication_block.state.changed.v1
#    appears in `emitted` (the after-commit hook fired)
# 2. block_requested=False → repository state unchanged (get_block_state
#    returns None), nothing emitted
# 3. flag off → nothing happens even with block_requested=True
# 4. duplicate delivery (same request_id twice) → state written once,
#    state.changed emitted once
# 5. missing customer_id/usr → warning path, no write
```

Build the kill event dict exactly as Task 2's `_kill_event()` does (typ from `config.get("msg_type_conversation_kill_requested")`, JSON-string payload, `usr` = customer id).

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/rohansharp/workspace/billieChat/backend && python -m pytest tests/unit/services/reapplicationBlock/test_manual_block_handler.py -v`
Expected: FAIL — no handler for the message type (service ignores it).

- [ ] **Step 3: Implement.**

`repository.py` — add `apply_manual_block`, mirroring EXACTLY how the existing manual-override apply method drives `_update_with_cas` (find the method `_handle_clear_authorized` calls to persist `state.manual_override` and copy its CAS/verify/after-commit structure, substituting the `manual_block` field):

```python
    async def apply_manual_block(self, canonical_id: str, manual_block) -> "ReapplicationBlockState":
        """CAS-apply an operator-raised manual block; idempotent by request_id."""

        def _mutate(state):
            if (
                state.manual_block is not None
                and state.manual_block.request_id == manual_block.request_id
            ):
                return state  # idempotent replay
            state.manual_block = manual_block
            return state

        return await self._update_with_cas(canonical_id, _mutate)
```

(adjust the `_update_with_cas` call to its actual signature — the executor must read `_update_with_cas` and the existing manual-override apply method first; if `_update_with_cas` returns `(state, changed)` or takes a before/after pair, follow that shape.)

`reapplication_block_service.py` — register in the handler map in `__init__` (beside `_handle_clear_authorized`):

```python
            config.get(
                "msg_type_conversation_kill_requested",
                "conversation.kill.requested.v1",
            ): self._handle_conversation_kill,
```

and the handler:

```python
    async def _handle_conversation_kill(self, event_data, payload):
        """Raise a MANUAL_ADMIN block from a CRM conversation-kill (block_requested)."""
        if not _feature_flag("ENABLE_MANUAL_KILL_BLOCK"):
            return
        if not payload.get("block_requested"):
            return
        request_id = payload.get("request_id")
        if not request_id:
            logger.warning("conversation.kill without request_id — no manual block")
            return
        canonical = await self._canonical(event_data)
        if not canonical:
            logger.warning(
                "conversation.kill %s: no resolvable customer — no manual block",
                request_id,
            )
            return
        manual_block = ManualBlock(
            blocked_at=datetime.now(timezone.utc).isoformat(),
            reason_category=payload.get("reason_category", ""),
            actor=payload.get("actor", ""),
            note=payload.get("note", ""),
            request_id=request_id,
        )
        await self.repository.apply_manual_block(canonical, manual_block)
        logger.warning(
            "manual block raised for %s (kill request %s, actor %s)",
            canonical,
            request_id,
            payload.get("actor", "?"),
        )
```

Import `ManualBlock` in the service's models import block. `_canonical(event_data)` is the service's existing envelope→canonical resolver (used by every other handler). The `reapplication_block.state.changed.v1` emission comes from the existing repository after-commit hook — do NOT emit manually.

- [ ] **Step 4: Run to verify pass**

Run: `cd /Users/rohansharp/workspace/billieChat/backend && python -m pytest tests/unit/services/reapplicationBlock/ -v`
Expected: PASS, including the pre-existing clear-flow tests (clearing MANUAL_ADMIN goes through the untouched `_handle_clear_authorized` with maker-checker approval, because Task 11 put it in `REASONS_REQUIRING_APPROVAL`).

- [ ] **Step 5: Add flag to config** — `"ENABLE_MANUAL_KILL_BLOCK": true` (dev/demo/test) / `false` (prod) in the four `config.<env>.json` `feature_flags` blocks.

- [ ] **Step 6: Commit**

```bash
cd /Users/rohansharp/workspace/billieChat
git add backend/backend/src/services/reapplicationBlock backend/backend/src/config.*.json backend/tests/unit/services/reapplicationBlock/test_manual_block_handler.py
git commit -m "feat(kill): raise MANUAL_ADMIN block from conversation-kill (block_requested)"
```

### Task 13: CRM — unhide the block checkbox

**Repo:** `/Users/rohansharp/workspace/billie-crm`

**Files:**
- Modify: `src/components/ConversationDetailView/EndConversation/index.tsx` (no code change if Task 9 already gated on the env var — this task is enabling + testing)
- Modify: `infra/fly/fly.demo.toml` / `fly.prod.toml` `[env]`: `NEXT_PUBLIC_ENABLE_KILL_BLOCK = "true"` (demo first; prod at Phase-2 rollout)
- Test: extend `tests/unit/components/EndConversation.test.tsx`

- [ ] **Step 1: Failing test:** with `NEXT_PUBLIC_ENABLE_KILL_BLOCK` stubbed `'true'` (use `vi.stubEnv('NEXT_PUBLIC_ENABLE_KILL_BLOCK', 'true')`), the modal shows the checkbox "Also block this customer from re-applying", and confirming with it ticked posts `blockRequested: true`.
- [ ] **Step 2:** Run: `pnpm exec vitest run tests/unit/components/EndConversation.test.tsx --config ./vitest.config.mts` — Expected: FAIL if Task 9 hard-coded the hide; PASS immediately only if Task 9's gating already works — in that case keep the test (it pins the contract) and note it never failed.
- [ ] **Step 3:** Implement/fix until green (checkbox renders only under the flag; `blockRequested` flows through the existing schema — no route change needed).
- [ ] **Step 4:** `pnpm exec prettier --write . --log-level warn && pnpm lint` on touched files; commit:

```bash
git add src/components/ConversationDetailView/EndConversation tests/unit/components/EndConversation.test.tsx infra/fly/fly.demo.toml
git commit -m "feat(kill): enable also-block checkbox behind NEXT_PUBLIC_ENABLE_KILL_BLOCK"
```

### Task 14: Part C verification

- [ ] **Step 1 (billieChat):** `cd /Users/rohansharp/workspace/billieChat/backend && python -m pytest tests/unit/services/reapplicationBlock tests/unit/services/applicationState -v` — PASS.
- [ ] **Step 2 (billie-crm):** `pnpm lint && pnpm exec vitest run tests/unit/components/EndConversation.test.tsx tests/unit/routes/conversationKill.test.ts --config ./vitest.config.mts` — PASS.
- [ ] **Step 3:** Commit any fixes in each repo (`chore(kill): part C verification fixes`).

---

## Rollout (operator runbook — not executor tasks)

1. **billieChat → demo:** `make -C infra/fly/backend deploy ENV=demo CONFIRM=1` (billieChat deploys are manual; GH tag workflows don't work). Verify via `fly image show`. `ENABLE_CONVERSATION_KILL` is already true in demo config.
2. **billie-crm → demo:** `make -C infra/fly deploy ENV=demo GITHUB_TOKEN=…` (runs the kill_record migration; dev/demo also have `push: true`).
3. **Demo end-to-end:** kill a live test conversation (stop message renders, chat input closes) AND a zombie one (status flips without a live session); confirm `status=hard_end`, banner, noticeboard stop post; with the checkbox: customer blocked on re-application, block chip on customer, clear via existing maker-checker flow.
4. **Prod:** billieChat deploy, flip `ENABLE_CONVERSATION_KILL=true` (config or `fly secrets set`), then CRM deploy. Phase 2 flags stay off in prod until the demo checkbox test passes.
5. **BTB-295** (fraud-agent adoption) stays open — blocked on enforce-mode decision.

## Plan-time verifications already done

- No gRPC exists in billieChat; command-stream is the established CRM→billieChat path (`publishClearAuthorized`).
- `hasApprovalAuthority` exists in `src/lib/access.ts` and is used exactly as Task 5 does (see `reapp-block-clear/approve/route.ts`).
- `conversations` status select already contains `hard_end`; `kill_record` is the ONLY new column (one migration, Task 6).
- `NoticeboardPost.conversation_state_seq` is `Optional[int] = 0` — seq 0 with `force_turn=True` is accepted; the turn manager never regresses its high-water mark on a lower seq. Confirm visually in the demo end-to-end (rollout step 3).
- `ReapplicationBlockState` deserialises unknown-field-free legacy blobs; adding `manual_block: Optional[...] = None` is backward-compatible (same pattern as `manual_override`).
