# Re-application block `state.changed.v1` — consumer (billie-crm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The CRM's customer-level block mirror (`customers.reapplication_block_*`) follows billieChat's `reapplication_block.state.changed.v1`, version-guarded, so a blocked customer shows the ⛔ chip and Clear-block action without ever re-applying.

**Architecture:** One new event-processor handler does a version-guarded upsert on `customers` (`… ON CONFLICT DO UPDATE … WHERE stored state_version < incoming`), using a small `update_where` extension to the shared `db.upsert` helper. The Payload `Customers` collection gains a `stateVersion` number (committed migration). No UI change — `getAttentionItems` and `ClearBlockButton` already render from the mirror. Phase 2 (gated on rollout verification) retires the legacy writers of the current-state columns.

**Tech Stack:** Python 3.11 event-processor (asyncpg, structlog, pytest with the `mock_pool` fixture) · Payload CMS 3 / Next 16 (TypeScript, vitest) · Postgres (Payload migration).

**Spec:** `docs/superpowers/specs/2026-08-22-reapplication-block-state-changed-event-design.md` (producer plan: billieChat `docs/superpowers/plans/2026-08-22-reapplication-block-state-changed-producer.md`).

## Global Constraints

- Event type: `reapplication_block.state.changed.v1`; payload per the spec table (`canonical_customer_id, state_version, blocked, reason, blocked_until, source_application_number, source_account_id, source_decided_at, previous, cause, changed_at`).
- Columns: `customers.reapplication_block_state_version` (Payload `reapplicationBlock.stateVersion`, `number` → pg `numeric`) and `customers.reapplication_block_state_changed_at` (Payload `reapplicationBlock.stateChangedAt`, `date` → pg `timestamp(3) with time zone`); guard predicate exactly
  `COALESCE(customers.reapplication_block_state_version, 0) < EXCLUDED.reapplication_block_state_version OR customers.reapplication_block_state_changed_at IS NULL OR EXCLUDED.reapplication_block_state_changed_at > customers.reapplication_block_state_changed_at` (version orders events within one projection epoch; the `changed_at` clause lets a new epoch — Redis rebuild / merge fold restarts at v1 — or a late `drop` event after a merge be superseded instead of wedging the row).
- `blocked=false` NULLs `reason`, `blocked_until`, `application_number`; keeps `blocked_at`; never touches `clear_status`/`cleared_at`; conversations are never written by this handler. Every event (blocked or not) writes `state_version` and `state_changed_at`.
- Payload collections are read-only projections — only the Python event-processor writes `customers`.
- Schema changes need a committed migration generated off current `main` via the throwaway-Postgres recipe (below); run `pnpm generate:types` after changing the collection.
- Python: run from `event-processor/` with `.venv/bin/python -m pytest tests/<file> -v`; `ruff check .` clean. TS: `pnpm exec vitest run <file> --config ./vitest.config.mts`; Prettier style (single quotes, no semicolons, 100 cols).
- Branch from current `main`; conventional commits; every commit ends with the two trailer lines
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01UaYmDmNDAm5mhzcZnZSHZa`.
- Deploy: `make -C infra/fly deploy ENV=demo GITHUB_TOKEN="…"` applies pending migrations first, then rolls the image. Do Task 5 (Phase 2) only after the rollout gate in Task 4 is signed off.

---

## File map

| file | responsibility |
|---|---|
| `event-processor/src/billie_servicing/db.py` | `upsert(..., update_where=)` + returns the command tag |
| `event-processor/src/billie_servicing/handlers/reapplication.py` | `STATE_VERSION_GUARD`, `handle_reapplication_block_state_changed` |
| `event-processor/src/billie_servicing/handlers/__init__.py`, `main.py` | export + registration |
| `src/collections/Customers.ts` | `reapplicationBlock.stateVersion` (Task 2) and `reapplicationBlock.stateChangedAt` (Task 6) fields |
| `src/migrations/<ts>_reapplication_block_state_version.{ts,json}`, `src/migrations/index.ts` | column migration |
| `src/payload-types.ts` (generated), `src/hooks/queries/useCustomer.ts` | `stateVersion` in the customer type |
| tests | `event-processor/tests/test_db_upsert.py`, `test_reapplication_state_changed.py`, one test in `test_processor_routing.py`; one test in `tests/unit/collections.test.ts` |

---

### Task 1: `db.upsert` — `update_where` guard and command-tag return

**Files:**
- Modify: `event-processor/src/billie_servicing/db.py:56-116` (`upsert`)
- Test: `event-processor/tests/test_db_upsert.py`

**Interfaces:**
- Produces: `async def upsert(target, table, *, conflict_columns, values, insert_only_columns=None, do_nothing_on_conflict=False, update_where: str | None = None) -> str` — `update_where` is appended as `DO UPDATE SET … WHERE <predicate>` (ignored with `do_nothing_on_conflict`); returns asyncpg's command tag (`"INSERT 0 1"`, or `"INSERT 0 0"` when the predicate rejected the update).

- [ ] **Step 1: Write the failing tests**

```python
# event-processor/tests/test_db_upsert.py
"""db.upsert: optional DO UPDATE … WHERE guard and the command-tag return value."""

from __future__ import annotations

from billie_servicing.db import upsert

GUARD = (
    "COALESCE(customers.reapplication_block_state_version, 0) "
    "< EXCLUDED.reapplication_block_state_version"
)


async def test_update_where_is_appended_to_do_update(mock_pool):
    await upsert(
        mock_pool,
        "customers",
        conflict_columns=["customer_id"],
        values={"customer_id": "A", "reapplication_block_state_version": 7},
        update_where=GUARD,
    )
    sql = mock_pool.calls_against("customers")[-1].sql
    assert sql.endswith(
        "DO UPDATE SET reapplication_block_state_version = "
        f"EXCLUDED.reapplication_block_state_version WHERE {GUARD}"
    )


async def test_no_update_where_leaves_sql_unchanged(mock_pool):
    await upsert(mock_pool, "customers", conflict_columns=["customer_id"], values={"customer_id": "A", "x": 1})
    sql = mock_pool.calls_against("customers")[-1].sql
    assert sql.endswith("DO UPDATE SET x = EXCLUDED.x")
    assert " WHERE " not in sql


async def test_update_where_ignored_with_do_nothing(mock_pool):
    await upsert(
        mock_pool, "t", conflict_columns=["id"], values={"id": 1},
        do_nothing_on_conflict=True, update_where="1 = 0",
    )
    assert mock_pool.calls[-1].sql.endswith("DO NOTHING")


async def test_returns_command_tag(mock_pool):
    tag = await upsert(mock_pool, "t", conflict_columns=["id"], values={"id": 1, "x": 2})
    assert tag == "INSERT 0 1"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd event-processor && .venv/bin/python -m pytest tests/test_db_upsert.py -v`
Expected: `test_update_where_*` FAIL with `TypeError: upsert() got an unexpected keyword argument 'update_where'`; `test_returns_command_tag` FAIL with `assert None == 'INSERT 0 1'`.

- [ ] **Step 3: Extend `upsert`**

Change the signature, docstring and tail of `upsert` in `db.py`:

```python
async def upsert(
    target: ExecuteTarget,
    table: str,
    *,
    conflict_columns: list[str],
    values: dict[str, Any],
    insert_only_columns: Iterable[str] | None = None,
    do_nothing_on_conflict: bool = False,
    update_where: str | None = None,
) -> str:
```

Append to the `Args:` block of the docstring:

```
        update_where: optional SQL predicate appended to the ``DO UPDATE`` branch
            (``DO UPDATE SET … WHERE <predicate>``) — for monotonic guards such as
            ``COALESCE(t.version, 0) < EXCLUDED.version``. Caller-trusted SQL, like
            the column names; never user input. Ignored with ``do_nothing_on_conflict``.

    Returns:
        asyncpg's command tag (``"INSERT 0 1"``; ``"INSERT 0 0"`` when the
        ``update_where`` predicate rejected the update on conflict).
```

Replace the last lines (from `set_clause = …` to `await target.execute(sql, *args)`) with:

```python
            set_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)
            sql += f"DO UPDATE SET {set_clause}"
            if update_where:
                sql += f" WHERE {update_where}"
    return await target.execute(sql, *args)
```

- [ ] **Step 4: Run the tests to verify they pass, plus every handler test that goes through `upsert`**

Run: `cd event-processor && .venv/bin/python -m pytest tests/test_db_upsert.py tests/test_handlers.py tests/test_reapplication_and_identity_verification.py tests/test_block_clear_projection.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add event-processor/src/billie_servicing/db.py event-processor/tests/test_db_upsert.py
git commit -m "feat(event-processor): db.upsert update_where guard + command-tag return

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UaYmDmNDAm5mhzcZnZSHZa"
```

---

### Task 2: Schema — `reapplicationBlock.stateVersion` + migration + types

**Files:**
- Modify: `src/collections/Customers.ts:330-333` (after the `clearedAt` field inside the `reapplicationBlock` group)
- Create (generated): `src/migrations/<timestamp>_reapplication_block_state_version.ts` + `.json`; Modify (generated): `src/migrations/index.ts`, `src/payload-types.ts`
- Modify: `src/hooks/queries/useCustomer.ts:116` (after `clearedAt`)
- Test: `tests/unit/collections.test.ts` (inside `describe('Customers Collection')`)

**Interfaces:**
- Produces: column `customers.reapplication_block_state_version numeric NULL`; `CustomerData['reapplicationBlock']['stateVersion']?: number | null`.

- [ ] **Step 1: Write the failing test**

Add inside `describe('Customers Collection', …)` in `tests/unit/collections.test.ts`:

```ts
    test('reapplicationBlock group carries the projection stateVersion guard', () => {
      const fields = (Customers.fields || []) as any[]
      const group = fields.find((f) => f.name === 'reapplicationBlock')
      expect(group?.type).toBe('group')
      const stateVersion = (group?.fields || []).find((f: any) => f.name === 'stateVersion')
      expect(stateVersion?.type).toBe('number')
      expect(stateVersion?.admin?.readOnly).toBe(true)
    })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/unit/collections.test.ts --config ./vitest.config.mts -t "stateVersion"`
Expected: FAIL — `expected undefined to be 'number'`. (The vitest globalSetup starts a Postgres testcontainer; if it stalls on `payload.config`, rerun — it is intermittent.)

- [ ] **Step 3: Add the field**

In `src/collections/Customers.ts`, after the `clearedAt` field object (the last entry of the `reapplicationBlock` group's `fields`):

```ts
        {
          // state.changed.v1: billieChat's projection CAS version. The event-processor
          // applies an event only when this stored version is lower, so the two
          // unordered prod consumers converge on the newest state.
          name: 'stateVersion',
          type: 'number',
          admin: {
            readOnly: true,
            description: 'billieChat block projection version that last wrote this mirror',
          },
        },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/collections.test.ts --config ./vitest.config.mts`
Expected: all pass.

- [ ] **Step 5: Generate the migration (throwaway Postgres — never the real dev DB)**

```bash
git fetch origin && git rebase origin/main   # migrate:create rewrites index.ts; be on current main
docker run --rm -d --name mig-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=billie -p 5434:5432 postgres:16-alpine
export DATABASE_URI="postgresql://postgres:postgres@localhost:5434/billie?sslmode=disable"
export PAYLOAD_SECRET=migrate-local
pnpm payload migrate                                   # bring the throwaway DB to current schema first
pnpm payload migrate:create reapplication_block_state_version   # name is POSITIONAL (--name is ignored)
pnpm payload migrate                                   # the new migration applies cleanly
docker rm -f mig-pg
```

Verify the generated `src/migrations/<ts>_reapplication_block_state_version.ts` contains exactly one schema change:

```sql
ALTER TABLE "customers" ADD COLUMN "reapplication_block_state_version" numeric;
```
(and `DROP COLUMN` in `down`). If the diff contains anything else, the throwaway DB was not at current schema — discard, rerun from `pnpm payload migrate`.

- [ ] **Step 6: Regenerate types and extend the hook type**

Run: `pnpm generate:types`
Expected: `src/payload-types.ts` `Customer.reapplicationBlock` gains `stateVersion?: number | null`.

In `src/hooks/queries/useCustomer.ts`, after the `clearedAt?: string | null` line inside `reapplicationBlock`:

```ts
    /** state.changed.v1: billieChat projection version that last wrote this mirror (ordering guard). */
    stateVersion?: number | null
```

- [ ] **Step 7: Lint and commit**

Run: `pnpm lint`
Expected: clean.

```bash
git add src/collections/Customers.ts src/migrations src/payload-types.ts src/hooks/queries/useCustomer.ts tests/unit/collections.test.ts
git commit -m "feat(customers): reapplication_block_state_version column for the block-state mirror

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UaYmDmNDAm5mhzcZnZSHZa"
```

---

### Task 3: Handler `handle_reapplication_block_state_changed` + registration

**Files:**
- Modify: `event-processor/src/billie_servicing/handlers/reapplication.py` (append after `handle_reapplication_block_auto_cleared`)
- Modify: `event-processor/src/billie_servicing/handlers/__init__.py:95-100` (import block) and `:117-121` (`__all__`)
- Modify: `event-processor/src/billie_servicing/main.py:83-87` (import) and `:206-210` (registration)
- Test: `event-processor/tests/test_reapplication_state_changed.py`; add one test to `event-processor/tests/test_processor_routing.py`

**Interfaces:**
- Consumes: `upsert(..., update_where=...) -> str` (Task 1); columns from Tasks 2 and 6; existing `parse_payload`, `safe_str`, `coerce_date`, `resolve_canonical_customer_id`.
- Produces: `STATE_VERSION_GUARD: str`; `async def handle_reapplication_block_state_changed(pool, event) -> None`; handler registered for `"reapplication_block.state.changed.v1"`.

- [ ] **Step 1: Write the failing tests**

```python
# event-processor/tests/test_reapplication_state_changed.py
"""reapplication_block.state.changed.v1 → customer-level block mirror (version-guarded).

Emitted by billieChat whenever the evaluated block decision changes — no customer
interaction needed. The CRM mirrors it onto ``customers.reapplication_block_*``
only when the event's ``state_version`` is newer than the stored one, and never
touches the conversation-level decline history or the clear audit stamps.
"""

from __future__ import annotations

import json

from billie_servicing.handlers.reapplication import (
    STATE_VERSION_GUARD,
    handle_reapplication_block_state_changed,
)

CANONICAL = "B81FC35E"


def _event(**overrides):
    payload = {
        "canonical_customer_id": CANONICAL,
        "state_version": 7,
        "blocked": True,
        "reason": "ACCOUNT_CONDUCT",
        "blocked_until": "2027-08-20T23:16:24+00:00",
        "source_application_number": "32B94F53-4CC",
        "source_account_id": None,
        "source_decided_at": "2026-08-20T23:16:24+00:00",
        "previous": {"reason": None, "blocked_until": None},
        "cause": {
            "event_type": "credit_assessment_accountConduct_result",
            "event_id": "evt-1",
            "conv": "c1",
        },
        "changed_at": "2026-08-20T23:16:25+00:00",
    }
    payload.update(overrides)
    return {
        "typ": "reapplication_block.state.changed.v1",
        "usr": payload["canonical_customer_id"],
        "conv": "c1",
        "seq": 4,
        "payload": payload,
    }


class TestBlocked:
    async def test_mirrors_current_decision(self, mock_pool):
        await handle_reapplication_block_state_changed(mock_pool, _event())
        row = mock_pool.last_upsert("customers")
        assert row["customer_id"] == CANONICAL
        assert row["reapplication_block_reason"] == "ACCOUNT_CONDUCT"
        assert row["reapplication_block_blocked_until"] is not None
        assert row["reapplication_block_application_number"] == "32B94F53-4CC"
        assert row["reapplication_block_blocked_at"] is not None
        assert row["reapplication_block_state_version"] == 7
        assert row["reapplication_block_state_changed_at"] is not None

    async def test_upsert_is_version_guarded(self, mock_pool):
        await handle_reapplication_block_state_changed(mock_pool, _event())
        sql = mock_pool.calls_against("customers")[-1].sql
        assert sql.endswith(f"WHERE {STATE_VERSION_GUARD}")
        assert "ON CONFLICT (customer_id)" in sql
        assert "< EXCLUDED.reapplication_block_state_version" in STATE_VERSION_GUARD
        assert "reapplication_block_state_changed_at IS NULL" in STATE_VERSION_GUARD
        assert "> customers.reapplication_block_state_changed_at" in STATE_VERSION_GUARD

    async def test_does_not_touch_clear_audit_or_conversations(self, mock_pool):
        await handle_reapplication_block_state_changed(mock_pool, _event())
        row = mock_pool.last_upsert("customers")
        assert "reapplication_block_clear_status" not in row
        assert "reapplication_block_cleared_at" not in row
        assert not mock_pool.has_call_against("conversations")


class TestUnblocked:
    async def test_nulls_current_state_but_keeps_blocked_at(self, mock_pool):
        await handle_reapplication_block_state_changed(
            mock_pool,
            _event(
                blocked=False, reason=None, blocked_until=None, source_application_number=None,
                previous={"reason": "ACCOUNT_CONDUCT", "blocked_until": "2027-08-20T23:16:24+00:00"},
            ),
        )
        row = mock_pool.last_upsert("customers")
        assert row["reapplication_block_reason"] is None
        assert row["reapplication_block_blocked_until"] is None
        assert row["reapplication_block_application_number"] is None
        assert "reapplication_block_blocked_at" not in row
        assert row["reapplication_block_state_version"] == 7
        assert row["reapplication_block_state_changed_at"] is not None

    async def test_blocked_false_ignores_stray_reason(self, mock_pool):
        """blocked=false with a reason attached must still read as unblocked."""
        await handle_reapplication_block_state_changed(mock_pool, _event(blocked=False))
        assert mock_pool.last_upsert("customers")["reapplication_block_reason"] is None


class TestGuards:
    async def test_missing_state_version_is_ignored(self, mock_pool):
        await handle_reapplication_block_state_changed(mock_pool, _event(state_version=None))
        assert not mock_pool.has_call_against("customers")

    async def test_non_integer_state_version_is_ignored(self, mock_pool):
        await handle_reapplication_block_state_changed(mock_pool, _event(state_version="seven"))
        assert not mock_pool.has_call_against("customers")

    async def test_no_customer_id_is_noop(self, mock_pool):
        event = _event()
        event["payload"]["canonical_customer_id"] = None
        event["usr"] = None
        await handle_reapplication_block_state_changed(mock_pool, event)
        assert not mock_pool.has_call_against("customers")

    async def test_guard_rejection_is_not_an_error(self, mock_pool):
        """asyncpg reports 'INSERT 0 0' when the version guard rejects the write —
        the handler logs at INFO and returns; nothing is raised or retried."""
        mock_pool.connection.execute.side_effect = None
        mock_pool.connection.execute.return_value = "INSERT 0 0"
        await handle_reapplication_block_state_changed(mock_pool, _event(state_version=3))
        assert mock_pool.connection.execute.await_count == 1  # attempted once, no retry

    async def test_resolves_merged_into_canonical(self, mock_pool):
        mock_pool.set_fetchval("CANON-1")  # customers.merged_into for the event's id
        await handle_reapplication_block_state_changed(mock_pool, _event())
        assert mock_pool.last_upsert("customers")["customer_id"] == "CANON-1"

    async def test_string_payload_parsed_defensively(self, mock_pool):
        event = _event()
        event["payload"] = json.dumps(event["payload"])
        await handle_reapplication_block_state_changed(mock_pool, event)
        assert mock_pool.last_upsert("customers") is not None
```

And add to `event-processor/tests/test_processor_routing.py` (after `test_collection_handlers_registered`):

```python
def test_reapplication_block_state_changed_registered(make_processor):
    """setup_handlers wires the customer-level block-state mirror handler."""
    from billie_servicing.main import setup_handlers

    proc = make_processor
    setup_handlers(proc)
    assert "reapplication_block.state.changed.v1" in proc.handlers
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd event-processor && .venv/bin/python -m pytest tests/test_reapplication_state_changed.py tests/test_processor_routing.py -v`
Expected: `ImportError: cannot import name 'STATE_VERSION_GUARD'` for the new file; `test_reapplication_block_state_changed_registered` FAILS with `assert 'reapplication_block.state.changed.v1' in {...}`.

- [ ] **Step 3: Write the handler**

Append to `event-processor/src/billie_servicing/handlers/reapplication.py`:

```python
# Guard for the customer-level block mirror. The version clause orders events
# within one projection epoch so the two unordered prod consumers converge on
# the newest state; the changed_at clause lets a new epoch (a Redis rebuild or
# merge fold restarts the document at v1) or a late `drop` event after a merge
# be superseded instead of wedging the row forever (spec: Race analysis).
STATE_VERSION_GUARD = (
    "COALESCE(customers.reapplication_block_state_version, 0) "
    "< EXCLUDED.reapplication_block_state_version "
    "OR customers.reapplication_block_state_changed_at IS NULL "
    "OR EXCLUDED.reapplication_block_state_changed_at "
    "> customers.reapplication_block_state_changed_at"
)


async def handle_reapplication_block_state_changed(
    pool: asyncpg.Pool, event: dict[str, Any]
) -> None:
    """Handle ``reapplication_block.state.changed.v1``.

    Emitted by billieChat's reapplicationBlock service whenever the evaluated
    block decision for a canonical customer changes — a decline recorded, a loan
    closed, a manual clear applied, an identity merge, or the one-off backfill.
    No customer interaction is required, so a customer declined today shows as
    blocked in the servicing view today (spec: 2026-08-22 state-changed design).

    This is the authoritative writer of the customer-level "currently blocked"
    mirror (``reason`` / ``blocked_until`` / ``blocked_at`` /
    ``application_number``). It never touches the clear-audit stamps
    (``clear_status`` / ``cleared_at`` — owned by the cleared/auto_cleared
    handlers) nor the conversation-level "why was THIS application halted"
    record (owned by ``handle_reapplication_blocked``).

    Guarded: ``state_version`` is the projection's CAS version and orders
    events within one projection epoch, so arrival order across the two prod
    consumers does not matter; ``changed_at`` lets a newer emission from a new
    epoch (or after a merge) supersede a higher stale version. A rejected
    (stale) write is logged at INFO and is not an error.
    """
    payload = parse_payload(event)
    customer_id = (
        safe_str(
            payload.get("canonical_customer_id") or event.get("usr"),
            "customer_id",
        )
        or None
    )
    canonical = await resolve_canonical_customer_id(pool, customer_id)
    raw_version = payload.get("state_version")
    blocked = bool(payload.get("blocked"))
    reason = payload.get("reason") if blocked else None

    log = logger.bind(
        canonical_customer_id=canonical,
        state_version=raw_version,
        blocked=blocked,
        reason=reason,
    )
    log.info("Processing reapplication_block.state.changed.v1")

    if not canonical:
        log.warning("state.changed event without resolvable customer id — no customer mirror")
        return
    try:
        state_version = int(raw_version)
    except (TypeError, ValueError):
        log.warning("state.changed event without an integer state_version — ignored")
        return

    now = datetime.now(UTC)
    changed_at = coerce_date(payload.get("changed_at")) or now
    values: dict[str, Any] = {
        "customer_id": canonical,
        "reapplication_block_state_version": state_version,
        "reapplication_block_state_changed_at": changed_at,
        "reapplication_block_reason": reason,
        "reapplication_block_blocked_until": (
            coerce_date(payload.get("blocked_until")) if blocked else None
        ),
        "reapplication_block_application_number": (
            payload.get("source_application_number") if blocked else None
        ),
        "updated_at": now,
        "created_at": now,
    }
    if blocked:
        # When the block became effective in the mirror. The fact's own time is
        # source_decided_at (kept on the conversation record). Retained on
        # unblock as audit, so it is simply not written then.
        values["reapplication_block_blocked_at"] = changed_at

    tag = await upsert(
        pool,
        "customers",
        conflict_columns=["customer_id"],
        values=values,
        insert_only_columns=["created_at"],
        update_where=STATE_VERSION_GUARD,
    )
    if str(tag).endswith(" 0"):
        log.info("Stale reapplication_block.state.changed ignored (stored version is newer)")
        return
    log.info("Re-application block state mirrored")
```

- [ ] **Step 4: Export and register**

`handlers/__init__.py` — extend the `.reapplication` import block and `__all__`:

```python
from .reapplication import (
    handle_reapplication_block_auto_cleared,
    handle_reapplication_block_clear_rejected,
    handle_reapplication_block_cleared,
    handle_reapplication_block_state_changed,
    handle_reapplication_blocked,
)
```
```python
    "handle_reapplication_block_auto_cleared",
    "handle_reapplication_block_state_changed",
```

`main.py` — add `handle_reapplication_block_state_changed,` to the `from .handlers import (…)` block next to the other `handle_reapplication_block_*` names, and after the `auto_cleared` registration:

```python
    # Customer-level block state (spec 2026-08-22) — emitted by billieChat whenever
    # the evaluated block decision changes; authoritative writer of the customers
    # mirror, version-guarded so arrival order across consumers is irrelevant.
    processor.register_handler(
        "reapplication_block.state.changed.v1", handle_reapplication_block_state_changed
    )
```

- [ ] **Step 5: Run the tests to verify they pass, then the full event-processor suite and lint**

Run: `cd event-processor && .venv/bin/python -m pytest tests -q && ruff check .`
Expected: all pass (12 new handler tests + 1 registration test; `test_handler_exports.py` confirms the re-export), ruff clean.

- [ ] **Step 6: Commit**

```bash
git add event-processor/src/billie_servicing/handlers/reapplication.py \
  event-processor/src/billie_servicing/handlers/__init__.py \
  event-processor/src/billie_servicing/main.py \
  event-processor/tests/test_reapplication_state_changed.py \
  event-processor/tests/test_processor_routing.py
git commit -m "feat(event-processor): mirror reapplication_block.state.changed.v1 onto customers (version-guarded)

Customer-level block mirror now follows billieChat's projection the moment a
decision changes — no re-application needed for the chip / Clear-block action.
Applies only when the stored state_version is lower; never writes clear-audit
stamps or conversations.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UaYmDmNDAm5mhzcZnZSHZa"
```

---

### Task 6: Schema — `reapplicationBlock.stateChangedAt` + second migration (runs after Task 2, before Task 3)

**Files:**
- Modify: `src/collections/Customers.ts` (after the `stateVersion` field inside the `reapplicationBlock` group)
- Create (generated): `src/migrations/<timestamp>_reapplication_block_state_changed_at.ts` + `.json`; Modify (generated): `src/migrations/index.ts`, `src/payload-types.ts`
- Modify: `src/hooks/queries/useCustomer.ts` (after `stateVersion`)
- Test: `tests/unit/collections.test.ts` (extend the `stateVersion` test)

**Interfaces:**
- Produces: column `customers.reapplication_block_state_changed_at timestamp(3) with time zone NULL`; `CustomerData['reapplicationBlock']['stateChangedAt']?: string | null`.

- [ ] **Step 1: Extend the failing test**

In `tests/unit/collections.test.ts`, inside the `reapplicationBlock group carries the projection stateVersion guard` test, append:

```ts
      const stateChangedAt = (group?.fields || []).find((f: any) => f.name === 'stateChangedAt')
      expect(stateChangedAt?.type).toBe('date')
      expect(stateChangedAt?.admin?.readOnly).toBe(true)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/unit/collections.test.ts --config ./vitest.config.mts -t "stateVersion"`
Expected: FAIL — `expected undefined to be 'date'`.

- [ ] **Step 3: Add the field**

In `src/collections/Customers.ts`, directly after the `stateVersion` field object:

```ts
        {
          // state.changed.v1: emission time of the event that last wrote this mirror. Second
          // clause of the event-processor's guard: a newer emission supersedes a higher stale
          // version after a projection epoch reset (Redis rebuild / merge fold) or a merge.
          name: 'stateChangedAt',
          type: 'date',
          admin: {
            readOnly: true,
            description: 'Emission time of the billieChat block state event that last wrote this mirror',
          },
        },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/collections.test.ts --config ./vitest.config.mts`
Expected: all pass.

- [ ] **Step 5: Generate the migration (throwaway Postgres — same recipe as Task 2)**

```bash
docker rm -f mig-pg 2>/dev/null; docker run --rm -d --name mig-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=billie -p 5434:5432 postgres:16-alpine
export DATABASE_URI="postgresql://postgres:postgres@localhost:5434/billie?sslmode=disable"
export PAYLOAD_SECRET=migrate-local
pnpm payload migrate                                          # includes Task 2's migration
pnpm payload migrate:create reapplication_block_state_changed_at   # name is POSITIONAL
pnpm payload migrate
docker rm -f mig-pg
```

Verify the generated `up` contains exactly one schema change:

```sql
ALTER TABLE "customers" ADD COLUMN "reapplication_block_state_changed_at" timestamp(3) with time zone;
```
(and the matching `DROP COLUMN` in `down`). Anything else → discard and rerun from `pnpm payload migrate`.

- [ ] **Step 6: Regenerate types and extend the hook type**

Run: `pnpm generate:types` — `Customer.reapplicationBlock` gains `stateChangedAt?: string | null`.

In `src/hooks/queries/useCustomer.ts`, after the `stateVersion?: number | null` line:

```ts
    /** state.changed.v1: emission time of the event that last wrote this mirror (second guard clause). */
    stateChangedAt?: string | null
```

- [ ] **Step 7: Lint and commit**

Run: `pnpm lint`

```bash
git add src/collections/Customers.ts src/migrations src/payload-types.ts src/hooks/queries/useCustomer.ts tests/unit/collections.test.ts
git commit -m "feat(customers): reapplication_block_state_changed_at column (epoch-safe mirror guard)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UaYmDmNDAm5mhzcZnZSHZa"
```

---

### Task 4: Verify, PR, deploy demo, backfill, rollout gate

- [ ] **Step 1: Full verification as CI runs it**

Run: `pnpm lint && pnpm test:int && (cd event-processor && .venv/bin/python -m pytest tests -q && ruff check .)`
Expected: green.

- [ ] **Step 2: PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat: mirror reapplication_block.state.changed.v1 onto the customer block mirror" --body "$(cat <<'B'
## Summary
- New event-processor handler for billieChat's `reapplication_block.state.changed.v1` (spec: `docs/superpowers/specs/2026-08-22-reapplication-block-state-changed-event-design.md`): version-guarded upsert of `customers.reapplication_block_*`, so a blocked customer shows the ⛔ chip + Clear-block action without re-applying.
- `db.upsert(update_where=…)` + command-tag return; `reapplicationBlock.stateVersion` field + migration.
- No UI change; Phase 2 (retire legacy writers of the current-state columns) is a follow-up after rollout verification.

## Test plan
- [ ] event-processor suite green (new: upsert guard, handler blocked/unblocked/stale/merged-into, registration)
- [ ] `pnpm test:int` green (collections test for `stateVersion`)
- [ ] demo: deploy (migration applies), run billieChat backfill `--dry-run` then real; a known-blocked demo customer shows the chip with no attempt
- [ ] demo: Clear-block round trip updates the mirror via `state.changed` (`stateVersion` increments)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01UaYmDmNDAm5mhzcZnZSHZa
B
)"
```

- [ ] **Step 3: Merge and deploy demo (rollout step 2)**

```bash
gh pr checks --watch --fail-fast && gh pr merge --merge --delete-branch
git checkout main && git pull --ff-only origin main
make -C infra/fly deploy ENV=demo GITHUB_TOKEN="$GITHUB_TOKEN"    # applies the migration, then rolls
```

- [ ] **Step 4: Backfill demo and verify (rollout step 3)**

In billieChat (producer plan Task 6 must be deployed on demo):

```bash
cd ~/workspace/billieChat/backend && APP_ENV=demo venv/bin/python -m backend.scripts.emit_reapplication_block_state --dry-run
cd ~/workspace/billieChat/backend && APP_ENV=demo venv/bin/python -m backend.scripts.emit_reapplication_block_state
```

Verify via the CRM admin API (`.claude/skills/assessing-issue-reports/fetch-issue.sh api demo /api/customer/<id>`): a known-blocked demo customer returns `reapplicationBlock.reason` + `stateVersion` set, and the servicing view shows the ⛔ chip and Clear block button. Then run a Clear-block round trip and confirm `stateVersion` increased and `reason` cleared (or moved to the residual reason).

- [ ] **Step 5: Prod (rollout step 4)**

In order: (a) billieChat — flip `ENABLE_REAPPLICATION_BLOCK_STATE_EVENTS` to `true` in `config.prod.json`, commit, `make -C infra/fly/backend deploy ENV=prod CONFIRM=1`; (b) CRM — `make -C infra/fly deploy ENV=prod GITHUB_TOKEN="…"`; (c) billieChat backfill `APP_ENV=prod … --dry-run`, then real; (d) spot-check customer B81FC35E (or any currently-blocked customer) in prod.

**Gate for Task 5:** one week of prod traffic with `stale reapplication_block.state.changed ignored` only appearing for genuinely reordered deliveries, no `after_commit hook failed` in billieChat logs, and the mirror matching billieChat for the spot-checked customers.

---

### Task 5 (Phase 2 — DO NOT START until the Task 4 gate is signed off): single writer

**Files:**
- Modify: `event-processor/src/billie_servicing/handlers/reapplication.py` — `handle_reapplication_blocked` (customer-mirror block), `handle_reapplication_block_cleared` (customer reason NULLing), `handle_reapplication_block_auto_cleared` (UPDATE statement)
- Test: `event-processor/tests/test_reapplication_and_identity_verification.py`, `test_block_clear_projection.py`, `test_reapplication_auto_clear.py`

- [ ] **Step 1: Write/adjust the failing tests**

`test_reapplication_auto_clear.py` — replace the first two tests in `TestAutoClear`:

```python
    async def test_stamps_auto_cleared_status_only(self, mock_pool):
        """Current-state columns are owned by state.changed.v1 — only the audit stamp lands."""
        await handle_reapplication_block_auto_cleared(
            mock_pool, _event(residual_block_reason=None)
        )
        upd = mock_pool.last_update("customers")
        assert upd is not None
        assert upd["reapplication_block_clear_status"] == "auto_cleared"
        assert "reapplication_block_reason" not in upd
        sql = mock_pool.calls_against("customers")[-1].sql
        assert "reapplication_block_reason = 'ACTIVE_LOAN'" not in sql

    async def test_residual_reason_is_not_written(self, mock_pool):
        await handle_reapplication_block_auto_cleared(
            mock_pool, _event(residual_block_reason="PRIOR_DEFAULT")
        )
        assert "reapplication_block_reason" not in mock_pool.last_update("customers")
```

`test_block_clear_projection.py` — two tests change; everything else (conversation audit, request-row flips, tombstone follow, rejected paths) stays:

| test | change |
|---|---|
| `test_cleared_nulls_block_and_stamps_audit` (line 24) | rename to `test_cleared_stamps_audit_without_touching_reason`; replace `assert cust["reapplication_block_reason"] is None` with `assert "reapplication_block_reason" not in cust  # owned by state.changed.v1 (Phase 2)`; keep the clear-status / cleared-at assertions |
| `test_cleared_prior_none_also_nulls_reason` (line 71) | rename to `test_cleared_prior_none_stamps_audit_only`; same assertion swap |

(`test_cleared_leaves_reason_when_prior_still_blocks` already asserts the key is absent — unchanged. Line 270's `conv["reapplication_block_reason"] is None` is the **conversation** row — unchanged.)

`test_reapplication_and_identity_verification.py` — only `handle_reapplication_blocked` tests that read the **customers** table change; conversation and re-attribution assertions stay:

| test | change |
|---|---|
| `TestReapplicationBlocked::test_mirrors_block_onto_canonical_customer` (line 94) | rename to `test_does_not_write_customer_mirror`; body after the handler call becomes `assert not mock_pool.inserts_into("customers")  # owned by state.changed.v1 (Phase 2)` |
| `TestReapplicationBlocked::test_resolves_merged_into_tombstone` (line 106) | delete — the handler no longer resolves a canonical for a customer write; tombstone resolution for the mirror is covered by `test_reapplication_state_changed.py::TestGuards::test_resolves_merged_into_canonical` |
| `TestReapplicationBlocked::test_no_conversation_id_still_mirrors_customer` (line 143) | rename to `test_no_conversation_id_writes_nothing`; replace the `last_insert("customers")` assertion with `assert not mock_pool.inserts_into("customers")` |
| `TestReapplicationBlocked::test_permanent_block_null_blocked_until` (line 116) and `test_string_payload_parsed_defensively` (line 133) | if `doc` is read from `customers`, read it from the conversations upsert instead (`mock_pool.last_upsert("conversations")`) and keep the assertions; if it already reads `conversations`, unchanged |
| `TestReapplicationBlockedReattribution::test_identity_conflict_records_block_but_does_not_reattribute` (line 267) | replace line 276 `assert mock_pool.last_insert("customers")["customer_id"] == self.CANONICAL` with `assert not mock_pool.inserts_into("customers")` |
| `TestReapplicationBlockedReattribution::test_existing_block_projections_preserved_alongside_reattribution` (line 330) | delete the three `cust = mock_pool.last_insert("customers")` … `assert cust["reapplication_block_reason"] == "ACTIVE_LOAN"` lines (340–342); keep the conversation assertions |

`test_confident_reason_tombstones_journey_customer_row` asserts the re-attribution **UPDATE** on `customers` (the `merged_into` tombstone), which Phase 2 keeps — unchanged.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd event-processor && .venv/bin/python -m pytest tests/test_reapplication_auto_clear.py tests/test_block_clear_projection.py tests/test_reapplication_and_identity_verification.py -v`
Expected: the adjusted assertions FAIL (the legacy handlers still write the columns).

- [ ] **Step 3: Retire the legacy writes**

`handle_reapplication_blocked` — delete the block from `# Customer-level mirror on the canonical row.` through the `else: log.warning("Re-application block event without customer id — no customer mirror")` line (the `customer_id` / `canonical_id` locals are only used there). Keep the conversation upsert above it and the re-attribution block below it. Add a comment where it was:

```python
    # Customer-level mirror is owned by reapplication_block.state.changed.v1
    # (handle_reapplication_block_state_changed) — this per-application event no
    # longer writes customers.reapplication_block_*.
```

`handle_reapplication_block_cleared` — remove

```python
        if reason_is_gone:
            # NULL the reason so the servicing view stops showing "blocked".
            customer_values["reapplication_block_reason"] = None
```
(keep `clear_status` / `cleared_at` on the customer, and leave the conversation `conv_values` logic untouched — that is the per-application audit trail).

`handle_reapplication_block_auto_cleared` — replace the `pool.execute(...)` statement with:

```python
    status = await pool.execute(
        """
        UPDATE customers
        SET reapplication_block_clear_status = 'auto_cleared',
            reapplication_block_cleared_at = $2,
            updated_at = $3
        WHERE customer_id = $1
        """,
        canonical,
        cleared_at,
        datetime.now(UTC),
    )
```
and drop the now-unused `residual` local (keep it in the log line only if still referenced; otherwise remove). Update the docstring's last two paragraphs to say the current-state columns are owned by `state.changed.v1` and only the audit stamp is written here.

- [ ] **Step 4: Run the full suite + lint**

Run: `cd event-processor && .venv/bin/python -m pytest tests -q && ruff check .`
Expected: green.

- [ ] **Step 5: Commit, PR, deploy (demo then prod, same commands as Task 4)**

```bash
git add event-processor/src/billie_servicing/handlers/reapplication.py event-processor/tests
git commit -m "refactor(event-processor): state.changed.v1 is the single writer of the customer block mirror (Phase 2)

application.reapplication_blocked / cleared / auto_cleared no longer write the
current-state columns, closing the last-write window where an unordered legacy
event could undo a newer state.changed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UaYmDmNDAm5mhzcZnZSHZa"
```
