# Re-application block state → CRM, at the moment it changes

**Status:** draft for review · **Date:** 2026-08-22 · **Repos:** billieChat (producer), billie-crm (consumer)
**Related:** billieChat `docs/superpowers/specs/2026-06-10-reapplication-block-decision-event-design.md`,
`…/2026-06-21-m2-reapplication-block-postgres-design.md`; billie-crm
`docs/superpowers/specs/2026-06-10-reapplication-block-and-identity-events-design.md`.

## Problem

billieChat's `reapplicationBlock` service owns the per-customer block projection
(`reapplication:block:{canonical}` in Redis, dual-written to Postgres) and
`evaluate_block(state)` derives the live decision: reason, precedence, decline windows,
manual-override coverage. The projection is mutated by events the service already consumes
(account lifecycle/aging/write-off, `credit_assessment_accountConduct_result`,
`credit_assessment_serviceability_result`, `identityRisk_assessment`, identity link/merge,
manual clears).

The service **only emits clear outcomes** (`reapplication_block.cleared.v1`,
`clear_rejected.v1`, `auto_cleared.v1`). The "you are blocked" fact reaches the CRM solely via
`application.reapplication_blocked.v1`, which is emitted at *evaluation time* — a re-application
attempt or a logged-in session start. Consequences:

1. A customer declined on day 0 is blocked in the projection from day 0, but the CRM's customer
   mirror (`customers.reapplication_block_*`) stays empty until they come back. Operators cannot
   proactively review or clear a block for a customer who never returns (observed 21–22 Aug 2026,
   customer B81FC35E).
2. Blocks that arise with no application at all — PRIOR_DEFAULT / PRIOR_SERIOUS_ARREARS from
   account events — are invisible in the CRM until an attempt.
3. The CRM's `blocked_until` is a snapshot taken at the attempt, not the projection's truth; and
   the existing `cleared.v1` handler can NULL the reason when a *lower-precedence* reason still
   applies (spec §14 only covers higher-precedence), leaving the mirror optimistic until the next
   attempt.

## Requirements

- The CRM customer mirror reflects the projection's current decision within seconds of any
  mutation that changes it — no customer interaction required.
- billieChat remains the single evaluator. The CRM never re-derives eligibility rules.
- Safe under the CRM's two unordered prod consumers (`inbox:billie-servicing`): a stale event must
  not overwrite a newer state.
- Existing contracts keep working unchanged during rollout; legacy writers are retired in a
  deliberate second step, not a big bang.
- Every new producer/typ pair is pinned by a router test (the 22 Aug drop class).

## Rejected alternatives

| option | why not |
|---|---|
| CRM re-derives the block from the input events it already receives | duplicates regulated decline rules (windows, precedence, override coverage, merges); manual overrides live in billieChat; guaranteed drift. |
| CRM pulls block state on demand (internal billieChat API / reading its Postgres shadow) | adds a synchronous runtime dependency to the CRM's read-only-projection model; needs new service auth (billieChat has no internal-API pattern); cannot power "all blocked customers" views. |
| Emit on *every* projection version | every instalment/aging tick would fan out; the CRM only needs decision changes. |
| CRM-only stopgap: offer "Clear block" from a block-inducing decline | operator acts blind to the real state; the customer chip still needs this event. Remains a valid bridge if timing demands it; this spec supersedes it. |

## Design

```
account / aging / decline / identity / manual-clear event
  │
  ▼  reapplicationBlock service handler → store.<mutator>()
  │     └─ repository._update_with_cas(): WATCH → load BEFORE → mutate → version+1 → EXEC
  │        └─ after a successful EXEC: after_commit(before, after)           ← new hook
  ▼
service.on_state_committed(before, after, cause=event_data)
  │  d0 = evaluate_block(before, now)   d1 = evaluate_block(after, now)
  │  signature(d) = (reason, blocked_until, source_application_number, source_account_id, source_decided_at)
  │  if signature(d0) == signature(d1): return                                ← no fan-out
  ▼
push_to_ledger( reapplication_block.state.changed.v1 )
  ▼  routes.json: ${service_reapplicationBlock} + typ → ${agent_billie-crm}
billie-crm event-processor: handle_reapplication_block_state_changed
  └─ UPSERT customers.reapplication_block_* WHERE stored state_version < event state_version
```

### New event contract (billieChat)

`MessageTypes.REAPPLICATION_BLOCK_STATE_CHANGED = "reapplication_block.state.changed.v1"`
in `shared/billie_shared/contracts/message_types.py`; config key
`msg_type_reapplication_block_state_changed` in all four env configs.

Envelope: `agt=<reapplicationBlock service agent_name>` (the `${service_reapplicationBlock}`
sender block), `usr=<canonical_customer_id>`, `conv=<causing event's conv, else
"block-state:{canonical}">`, `seq=<causing seq>+1` — the same conventions as `_emit_auto_cleared`.

Payload:

| field | type | notes |
|---|---|---|
| canonical_customer_id | str | projection key (post-merge canonical) |
| state_version | int | `ReapplicationBlockState.version` **after** the mutation; consumer's monotonic guard |
| blocked | bool | `BlockDecision.blocked` |
| reason | str\|null | `BlockReason` value; null when unblocked |
| blocked_until | str\|null | ISO-8601 window end; null = permanent (PEP, PRIOR_DEFAULT) or ongoing (ACTIVE_LOAN) |
| source_application_number | str\|null | application that created the blocking fact |
| source_account_id | str\|null | account that created it (loan/default blocks) |
| source_decided_at | str\|null | ISO-8601 of the blocking fact |
| previous | object\|null | `{reason, blocked_until}` of the decision before this mutation; null on backfill |
| cause | object | `{event_type, event_id, conv}` of the input event (or `{"event_type":"backfill"}`) |
| changed_at | str | ISO-8601 emission time |

`message_variant` / `stop_message` are deliberately absent — they belong to the
application-level `application.reapplication_blocked.v1` (customer-facing copy), not to customer
state. IDENTITY_CONFLICT is a recognition-time halt, not projection state: `evaluate_block` is
called with `identity_conflict=False`, so this event never carries it (unchanged from today's
customer mirror semantics, which only learn of it via the attempt event).

### Producer: emit point

**Repository hook.** `ReapplicationBlockRepository._update_with_cas` already holds the exact
predecessor state (loaded under `WATCH`) and the committed successor. Add an optional
`after_commit: Callable[[ReapplicationBlockState, ReapplicationBlockState], Awaitable[None]]`
registered once via `store.set_after_commit(cb)`. It is awaited **after** a successful `EXEC`,
outside the pipeline, with `(before, after)`; `before` is a fresh `ReapplicationBlockState`
(`canonical_customer_id` only, `version=0`) when the key did not exist. The `DualWrite` store
forwards registration to its Redis repository (Redis is the authoritative writer in every store
mode; the Postgres shadow never triggers the hook). Hook exceptions are logged and never fail the
write — the event is best-effort, the backfill/parity tooling is the repair path.

`merge(keep_id, drop_id)` commits `keep` through the same CAS path, so it fires for `keep`;
the `drop` key is deleted without a hook (the CRM has already re-pointed `drop`'s rows via
`customer.identity.merged.v1`; a `blocked=false` for a tombstone would be noise).

**Service.** `ReapplicationBlockService` registers `self._on_state_committed` at init. It
evaluates before/after with the **same** `now`, compares the signature above, and emits on
change only. Same-`now` evaluation means a decline window that lapsed since the last emission
cannot masquerade as a mutation-driven change (the CRM hides lapsed windows by date — see Race
analysis). The handler's `event_data` is made available to the hook via a `contextvars`
variable set by `process_message`, so `cause`/`conv`/`seq` come from the input event without
threading parameters through every mutator; the backfill script sets it to the synthetic cause.

Feature flag `ENABLE_REAPPLICATION_BLOCK_STATE_EVENTS`, resolved by `config.feature_flag()` — an env
var override first, then the `feature_flags` block of `config.<env>.json` (the Redis seed files are
not involved). Baseline: `dev`/`demo` true; `test` false (unit tests opt in via the env var);
`prod` false until rollout step 4 (no staging config exists). Off → hook still runs, emit is skipped.

**Relationship to existing emitters (unchanged):**
- `application.reapplication_blocked.v1` — still emitted at attempts/session start; still the
  conversation-level "why was THIS application halted" record with the stop message.
- `cleared.v1` / `clear_rejected.v1` — still emitted; still carry operator audit + queue status.
- `auto_cleared.v1` — still emitted. After this change, the manual clear and the last-loan-repaid
  paths each produce *two* events (outcome + state); the CRM treats `state.changed` as the only
  writer of current-state columns (Phase 2), so the duplication is harmless.

### Routing (billieChat)

`routes.json`, under `${service_reapplicationBlock}`:
`{"condition": {"typ": "${msg_type_reapplication_block_state_changed}"}, "targetAgent": ["${agent_billie-crm}"]}`.

Not routed to `applicationState` (per-application record, no customer-level state) nor the
portal (future consumer — out of scope). Tests: a `test_block_state_routes.py` pin (pattern:
`tests/unit/routing/test_block_clear_routes.py`) **and** an emitter-coverage test asserting every
`msg_type_*` the service passes to `push_to_ledger` resolves to ≥1 inbox for its sender — the
generalisation of `test_platform_sender_coverage.py` that would have caught the 22 Aug gap.

### Backfill (billieChat)

`backend/scripts/emit_reapplication_block_state.py` (pattern:
`backfill_reapplication_block_postgres.py`): SCAN `reapplication:block:*`, load state,
`evaluate_block(state)`, emit `state.changed` with `previous=null`,
`cause={"event_type":"backfill"}`, `state_version=state.version`. Flags: `--dry-run`,
`--only-blocked` (default off — emitting `blocked=false` also repairs stale CRM mirrors), `--limit`.
`changed_at` on a backfill event is the projection's own `updated_at` (not the emission time): a
backfill snapshot the CRM has already superseded fails both guard clauses, so a backfill running
against a live producer cannot regress a mirror, and re-runs are true no-ops. Runs once per env after the CRM
handler is live (rollout step 3/5). Routed through the normal ledger path, so the inline router /
broker and the CRM's dedup all apply.

### Consumer: billie-crm event processor

`handlers/reapplication.py` → `handle_reapplication_block_state_changed(pool, event)`:

1. `payload = parse_payload(event)`. Contract fields are validated BEFORE any DB access and the
   event is ignored with a warning if any is missing: `state_version` must be an integer, `blocked`
   must be present, `changed_at` must parse to a datetime (a defaulted `now` would satisfy the guard's
   time clause unconditionally and a missing `blocked` would read as "unblocked" — both fail closed).
   Then `canonical = resolve_canonical_customer_id(pool, payload["canonical_customer_id"] or
   event["usr"])`; no id → warn, no-op.
2. Version-guarded upsert on `customers` (conflict `customer_id`):
   - always: `reapplication_block_state_version = $v`, `reapplication_block_state_changed_at = changed_at`,
     `updated_at`
   - `blocked=true`: `reason`, `blocked_until`, `blocked_at = changed_at` (when the block became
     effective in the mirror; the fact's own time is `source_decided_at`, kept on the conversation
     record as today), `application_number = source_application_number`
   - `blocked=false`: `reason = NULL`, `blocked_until = NULL`, `application_number = NULL`;
     `blocked_at` retained (audit); `clear_status`/`cleared_at` untouched — those belong to the
     `cleared`/`auto_cleared` handlers.
   - guard: `… ON CONFLICT (customer_id) DO UPDATE SET … WHERE
     COALESCE(customers.reapplication_block_state_version, 0) < EXCLUDED.reapplication_block_state_version
     OR customers.reapplication_block_state_changed_at IS NULL
     OR EXCLUDED.reapplication_block_state_changed_at > customers.reapplication_block_state_changed_at`.
     The version clause orders events within one projection epoch; the `changed_at` clause lets a
     new epoch (Redis rebuild / merge fold restarts the document at v1) or a late `drop` event after
     a merge be superseded instead of wedging the row forever.
     `db.upsert` gains an optional `update_where: str | None` that is appended to the
     `DO UPDATE` clause (column names are caller-trusted, as today). `upsert` returns asyncpg's command
     tag; `INSERT 0 0` means the guard rejected the write — logged at INFO with the incoming version
     (`stale state.changed ignored`), never an error.
3. Conversations are **not** touched — per-application history stays with the attempt event.

Registration in `main.py` (`processor.register_handler("reapplication_block.state.changed.v1",
…)`); parsing falls through `_parse_event`'s final `sanitize_envelope` branch like the other
`reapplication_block.*` events — no parser change. Export from `handlers/__init__.py`
(`test_handler_exports.py` / `test_processor_routing.py` patterns).

**Schema (Payload, read-only projection):** `Customers.ts` `reapplicationBlock` group gains
`stateVersion` (number, nullable, `admin.readOnly`) and `stateChangedAt` (date, nullable, `admin.readOnly`). Committed migration
(`make -C infra/fly pg-migrate-create ENV=dev NAME=reapplication_block_state_version` via the
throwaway-Postgres recipe), then `pnpm generate:types`. The afterSchemaInit hook is untouched.

**UI:** none. `getAttentionItems` (`src/lib/accountTriage.ts`) and `ClearBlockButton` already
render from `customer.reapplicationBlock.reason/blockedUntil`; `useCustomer` gains the optional
`stateVersion` field only for completeness.

### Phase 2 — single writer (billie-crm, after backfill is verified per env)

Once every env has run the backfill and a week of `state.changed` traffic looks right in the
mirror, retire the legacy writes of the current-state columns so a stale/unordered legacy event
cannot undo a newer `state.changed`:

- `handle_reapplication_blocked`: keep the conversation upsert and the re-attribution merge;
  drop the `customers` reason/blocked_until/blocked_at/application_number write.
- `handle_reapplication_block_cleared` / `_auto_cleared`: keep `clear_status`/`cleared_at` (and
  the conversation audit trail / queue row flip); drop the `reason` NULLing and the
  `residual_block_reason` overwrite.

Until Phase 2 the legacy writers do not set `state_version`, so they can still overwrite; the
window is the same one that exists today and closes with Phase 2.

## Race analysis

- **Per-version emission.** The hook receives the exact predecessor loaded under `WATCH`, so each
  committed version is compared to its own predecessor: a transition cannot be lost to a
  concurrent writer's stale read. A CAS retry re-runs `mutate` on the newer state and fires the
  hook once, for the version it actually committed.
- **Unordered consumers.** `state_version` is monotonic per canonical within one projection epoch;
  the CRM applies `stored_version < incoming_version` for ordering. Two prod consumers processing v7
  and v8 in either order converge on v8. `application.reapplication_blocked.v1` (per attempt) carries
  no version — hence Phase 2.
- **Epoch resets and merges.** A Redis rebuild or a merge fold restarts a document at v1
  (`dual_write._pg_is_relic`, BTB-289), and a `state.changed` for `drop` emitted just before a merge
  can land on `keep`'s row (one `merged_into` hop) carrying `drop`'s higher version. A pure version
  guard would then reject every later event silently. The `changed_at` clause of the guard accepts a
  newer emission regardless of version, so a new epoch takes over on its first event and the late-`drop`
  case self-heals on `keep`'s next emission.
- **Window lapse.** No event fires when `blocked_until` passes without a mutation; the CRM hides
  lapsed windows by date (`isBlockActive`), as today. The next mutation re-evaluates with a fresh
  `now` and may emit `blocked=false` (or a residual reason) — which only confirms what the UI
  already shows.
- **Identity merge.** `keep` emits at its new version; the CRM resolves the canonical through one
  `merged_into` hop as every customer-level mirror does. `drop` is silent by design.
- **Phase-1 window: `auto_cleared` audit stamp.** The last-loan-repaid path now emits two events.
  If `state.changed` (`blocked=false`) is applied first it NULLs `reason`, and the legacy
  `auto_cleared` UPDATE (guarded `WHERE reapplication_block_reason = 'ACTIVE_LOAN'`) then matches
  nothing — the customer-level `clear_status='auto_cleared'` stamp is lost. Audit-only: nothing
  user-facing reads `clear_status` while `reason` is NULL. Phase 2's rewrite of that handler (stamp
  only, no predicate) closes it.
- **Hook failure.** A failed emit never fails the write; the projection stays correct and the
  backfill script is the repair. A drop at the router is alertable via the existing
  `ledger_route_drop` metric; the new emitter adds `reapplication_block_state_changed_emitted{reason}`.

## Test plan (TDD, both repos)

billieChat
- repository: `after_commit` fires once per successful CAS with `(before, after)`; `before` is the
  empty state for a new key; fires for `keep` on merge, not for `drop`; a raising hook is logged
  and the write still returns the committed state; `DualWrite` forwards registration.
- service: aging tick with unchanged decision → no emit; ACCOUNT_CONDUCT decline recorded →
  emit `blocked=true, reason=ACCOUNT_CONDUCT, blocked_until=decided_at+12m,
  source_application_number`; manual clear of the only reason → `blocked=false`, `previous.reason`
  set; manual clear with a residual reason → emits the residual; last loan repaid → both
  `auto_cleared` and `state.changed` emitted; flag off → no emit; payload `state_version` equals
  the committed version; `usr`/`conv`/`seq` follow the input event.
- routing: new typ from `${service_reapplicationBlock}` resolves to `inbox_billie-crm`; emitter
  coverage test over every `msg_type_*` the service emits.
- contract: `MessageTypes` constant + config key present in all four env configs.
- backfill: dry-run emits nothing; `--only-blocked` skips unblocked states; emitted payloads carry
  `previous=null` and `cause.event_type="backfill"`.

billie-crm
- handler: blocked=true upsert writes reason/blocked_until/blocked_at/application_number and
  state_version; blocked=false NULLs reason/blocked_until/application_number, keeps blocked_at
  and clear_status; stale version is ignored (no write, INFO log); equal version ignored; missing
  customer row is inserted; canonical resolution through `merged_into`; missing id → no-op.
- `db.upsert(update_where=…)` renders the `WHERE` on `DO UPDATE` and leaves the `DO NOTHING` path
  unchanged.
- registration/export tests; UI unchanged — existing `accountTriage` tests already cover rendering
  from the mirror.

## Rollout

1. billieChat: contract + hook + emitter (flag off in prod) + routes + tests → deploy demo → flag on.
2. billie-crm: migration + handler + `db.upsert` extension → deploy demo (migration applied by
   `make -C infra/fly deploy`).
3. demo: run the backfill; verify a known-blocked demo customer shows the ⛔ chip with no attempt;
   compare `customers.reapplication_block_reason` / `state_version` against billieChat's projection
   for a sample of blocked customers (the `stale … ignored` log line is a weak signal because the
   time clause accepts almost everything during a backfill); count `customers` rows before/after to
   catch phantom rows from `blocked=false` events for canonicals the CRM has never seen; verify a
   Clear-block round-trip updates the mirror via `state.changed` (not only `cleared`).
4. prod: same order (deploy billieChat → flag on → deploy CRM → backfill). Deploys are manual
   (`make -C infra/fly/backend deploy ENV=…`); the tag-triggered workflows are not wired.
5. Phase 2 PR in billie-crm after one week of clean prod traffic.

## Out of scope

- A portal-facing consumer ("you can apply again on …") — the event is designed to support it.
- A scheduled "window lapsed" emitter — date-based hiding in the CRM already covers it.
- Any CRM-side evaluation of eligibility; any change to `application.reapplication_blocked.v1`.
- UI redesign of the attention chip (e.g. linking `source_account_id` to the account rail).
