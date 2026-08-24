# Conversation Kill — CRM "End conversation" button (design)

- **Date:** 2026-08-24 (approved in-session same day)
- **Repos:** `billie-crm` (UI, API, projection) + `billieChat` (command handlers, routing)
- **Related:** BTB-295 (future FraudRiskAgent adoption) · reapplication-block clear flow (PR #78 state.changed pipeline) · fraud rolling-summary work (commit 7b01e65)

## Goal

Staff (admin/supervisor) can end a live billieChat conversation from the CRM: the customer
sees one neutral stop message, the session closes (including zombie/offline sessions), the
CRM records who/why, and optionally the customer is blocked from re-applying.

## Decisions (approved)

| Question | Decision |
|---|---|
| Use cases | Fraud/abuse response + operational cleanup + compliance — a `reason_category` rides on the command |
| Customer-facing copy | One neutral message for every kill, from billieChat config (`conversationKill_stop_message`), pattern of `fraudRisk_stop_message`: "This conversation has been ended by our team. If you have any questions, please contact our support team." The reason never reaches the customer. |
| Authority | `hasApprovalAuthority` (admin + supervisor) |
| Re-entry | Optional "also block re-application" checkbox → manual reapplication block (raising a block has no approval ceremony today; clearing keeps the existing two-step maker-checker flow) |
| Ceremony | Confirm modal (reason + optional note + optional block checkbox), fires immediately — no request/approve round-trip |
| Transport | Redis command on `chatLedger` (no gRPC — billieChat has no gRPC surface; the command-stream pattern is durable and already proven by `clear_authorized`) |
| Architecture | Fan-out: one command routed to two domain-owned handlers (applicationState = kill, reapplicationBlock = optional block) |

## Command contract

`conversation.kill.requested.v1` — published by CRM to `chatLedger` (envelope identical to
`publishClearAuthorized`: `agt: billie-crm`, `cls: 'cmd'`, `conv: <conversation id>`, `usr: <customer id>`).

```json
{
  "request_id": "<nanoid — idempotency key>",
  "conversation_id": "…",
  "application_number": "…",
  "customer_id": "…",
  "reason_category": "fraud_abuse" | "operational" | "compliance",
  "note": "<optional free text, audit only>",
  "actor": "user:<staff-id>",
  "block_requested": false,
  "requested_at": "<ISO-8601>"
}
```

`actor` is namespaced (`user:` / `system:`) so non-human senders (BTB-295: `system:fraudRiskAgent`)
adopt the same contract.

**Routing (`billieChat routing/routes.json`):** new entry under the existing `"${agent_billie-crm}"`
sender block → `targetAgent: [service_applicationState, service_reapplicationBlock]`. Routes are a
per-sender allowlist — without the entry the Broker silently drops the command. (BTB-295 adds its own
`agent_fraudRisk` sender entry later.)

**Return path:** `conversation.killed.v1` (echoes `request_id`, `reason_category`, `note`, `actor`,
plus `killed_at`) routed to `agent_billie-crm` → `inbox:billie-servicing`.

## billieChat: kill handler (applicationState service)

New entry in `application_state_service.py`'s `typ → handler` map: `_handle_conversation_kill`,
feature-flagged `ENABLE_CONVERSATION_KILL` (pattern of `ENABLE_MANUAL_BLOCK_CLEAR`). Steps:

1. **Idempotency guard** — `SET kill:{request_id} NX EX 86400`; redelivery no-ops.
2. **Stop the chat** — `post_to_noticeboard(agent_name="conversationKill", post_content=<stop message>,
   force_turn=True, end_conversation=True, end_conversation_text=<stop message>)`. `seq` read from the
   noticeboard turn-state hash (the turn manager's high-water mark), fallback 0 — exact sourcing
   verified at plan time.
3. **Close the session** — write `data::conversation → {"conversation_status": <conversation_status_closed>}`
   into `noticeboard:{application_number}`, mirroring the CLA directive handler's loan-agreement close.
   This is what terminates a zombie session; the noticeboard post alone needs a live turn cycle.
4. **Emit** `conversation.killed.v1`.

Edge cases: already-ended conversation → steps 2–3 are harmless no-ops, killed event still fires so the
CRM audit lands. Missing `application_number` → warn, skip step 3, still emit (matches CLA's handling of
the same gap).

Side benefit: the stop post lands on the conversation noticeboard, which the CRM already ingests and
displays — the kill is visible in the existing panel for free.

## billieChat: optional manual block (reapplicationBlock service)

`_handle_conversation_kill` in `reapplication_block_service.py`'s typ-map; no-ops unless
`block_requested: true`. Feature flag `ENABLE_MANUAL_KILL_BLOCK` (separate from the kill flag so
Phase 1 ships kill-only). When active:

- New `BlockReason.MANUAL_ADMIN` in `enums.py`, **no expiry window** (`None`, like PEP — permanent
  until deliberately cleared).
- Resolve the canonical customer via the existing alias-chain machinery; write the block through the
  existing repository; emit the existing `reapplication_block.state.changed.v1` — already consumed by
  the CRM (PR #78), so the customer block chip appears with zero new CRM block code.
- Clearing uses the existing two-step maker-checker clear flow untouched. Plan-time check: the clear
  flow's reason-class validation must accept `MANUAL_ADMIN` (maker-checker required is the correct
  class).

## CRM: UI + API

- **Button** in `ConversationDetailView` header: rendered only for `hasApprovalAuthority` and while
  `status` is non-terminal (`active` / `paused`). Label: "End conversation".
- **Confirm modal** (stepped, per `docs/ux-standards.md` for irreversible actions): shows the exact
  customer-facing message, radio reason (`Fraud / abuse` · `Operational cleanup` ·
  `Compliance / customer request`), optional note, optional "Also block this customer from
  re-applying" checkbox (hidden until Phase 2 flag), Cancel / End conversation.
- **API route** `POST /api/commands/conversation-kill` (modelled on `reapp-block-clear/request`):
  Zod-validated body, role check, calls new `publishConversationKill` in
  `src/server/chatledger-publisher.ts`, returns `request_id`. Writes nothing locally — the projection
  only ever reflects what billieChat confirmed; the UI shows a pending state until the conversation
  detail refetch flips (React Query).

## CRM: projection + audit

New event-processor handler `handle_conversation_killed` for `conversation.killed.v1`
(in `handlers/conversation.py`, registered in `main.py`):

- `conversations.status = 'hard_end'` (existing vocabulary — grid/filters unchanged), bump
  `version`/`updated_at`, **update-only**.
- Audit into a new `killRecord` json field on the Conversations collection
  (`{request_id, actor, reason_category, note, killed_at}`). One Payload field ⇒
  `pnpm generate:types` ⇒ **one migration** (dev/demo via `push: true`; prod via the deploy's
  migrate step).
- Naturally idempotent (same event → same values) — safe under at-least-once delivery and the
  18-consumer group.
- Detail view: banner above the panel ("Ended by <staff> · <reason> · <time>"); kill button hides
  once status is terminal.

## Phasing & rollout

1. **Phase 1 — kill only.** billieChat first (route entry + applicationState handler + config
   message, `ENABLE_CONVERSATION_KILL` off → demo, synthetic-command verify), then CRM (publisher,
   API, UI, projection + migration → demo), end-to-end demo test, then prod. billieChat deploys are
   manual (`make -C infra/fly/backend deploy ENV=… CONFIRM=1`); CRM via `make -C infra/fly deploy`.
   Deploy order affects when the feature lights up, not correctness — unknown events drop safely in
   both directions. Prod ordering: flip billieChat prod `ENABLE_CONVERSATION_KILL` to true at/before
   the CRM prod deploy; until then the prod button would silently no-op (command delivered, handler
   flag-off).
2. **Phase 2 — block checkbox.** `MANUAL_ADMIN` + reapplicationBlock handler + clear-flow reason-class
   check + unhide checkbox (`ENABLE_MANUAL_KILL_BLOCK`).
3. **Phase 3 — BTB-295.** FraudRiskAgent enforce mode emits the kill command
   (`actor: system:fraudRiskAgent`); own routes.json sender entry; claim/release re-plumbed onto
   command emission. Blocked on Phases 1–2 and the enforce-mode decision.

## Testing

- **billieChat pytest:** both handlers — idempotency (duplicate request_id no-ops), feature-flag off
  no-ops, missing-field handling, noticeboard post + session-hash write + killed emission shapes,
  block only when requested; existing service-test patterns.
- **CRM pytest (MockPool):** status flip to `hard_end`, `killRecord` audit shape, update-only,
  version bump.
- **CRM Vitest:** button gating (role + status), modal flow (reason required, confirm), pending state,
  banner render; alongside existing ConversationDetailView tests.
- **Manual:** one end-to-end kill in demo per phase (live conversation + a zombie conversation).

## Explicitly out of scope

- No gRPC surface; no change to `fraud_risk.halt.v1`, the Slack alert, or the customer AttentionStrip
  chip; no request/approve ceremony for kills; no per-reason customer messaging.
