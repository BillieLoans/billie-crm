# Applicant Release — billieChat Enforcement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the billieChat half of the batch applicant release feature: a new `applicantReleaseService` that consumes release commands from the CRM, a mobile+OTP front-door gate, a runtime gate-mode switch with an ops CLI, and the Svelte gate/capacity pages.

**Architecture:** A new `services/applicantRelease/` package cloned structurally from `services/reapplicationBlock/` — a BaseAgent consumer on `inbox:applicantReleaseService` maintaining a Redis-primary grant store (Postgres shadow via store-mode), a `gate.py` decision function called from new `/gate/*` FastAPI routes and enforced in `/chat/init` + the WS welcome branch. Facts flow back to the CRM over `chatLedger`.

**Tech Stack:** Python 3.12, FastAPI, redis.asyncio, SQLAlchemy Core + Alembic, Pydantic, Svelte 4 + TypeScript (frontend), pytest (asyncio_mode=auto).

**Spec:** `docs/superpowers/specs/2026-08-02-batch-applicant-release-design.md` (in the billie-crm repo).

## Global Constraints

- Repo: `/Users/rohansharp/workspace/billieChat`. Create branch `feat/applicant-release` off latest `main` before Task 1.
- Run backend tests from `backend/`: `python -m pytest tests/unit/... -v` (asyncio_mode=auto — async tests need no decorator). Unit tests use `unittest.mock.AsyncMock` + `patch.object`, NOT fakeredis. Repository tests may use the real-Redis `redis_mock` fixture from `backend/tests/conftest.py:37` (requires a local Redis on `redis://localhost`).
- Test files must set `os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_for_tests")` and `os.environ.setdefault("APP_ENV", "test")` BEFORE importing anything under `backend.src` (add `# noqa: E402` on the imports) — see `backend/tests/unit/services/reapplicationBlock/test_session_start.py:9-23`.
- Event types (verbatim, never re-spell): `applicant_release.released.v1`, `applicant_release.revoked.v1`, `applicant_release.gate_mode.set.v1`, `applicant_release.grant_claimed.v1`, `applicant_release.invites_sent.v1`, `applicant_release.gate_mode.changed.v1`.
- Names: service/agent name `applicantReleaseService`, inbox `inbox:applicantReleaseService`. Config keys: `service_applicantRelease`, `inbox_applicantRelease`, `enable_applicantReleaseService`.
- Redis keys: `application_gate:mode`, `applicant_release:release:{releaseId}` (hash), `applicant_release:grant:{mobileE164}` (hash), `applicant_release:members:{releaseId}` (set), `applicant_release:quota_releases` (set), `applicant_release:processed:{releaseId}` (dedup marker), `capacity_gate_messages` (copy hash).
- Feature flag: `ENABLE_APPLICATION_GATE`, default `False` everywhere. Runtime mode values: `open` | `gated`; unset key means `open`.
- Grant hash fields are strings (Redis): `release_id`, `status` (`granted`|`claimed`), `expires_at` (ISO 8601), `claimed_at`, `source` (`targeted`|`quota`). Release hash fields: `type`, `status` (`active`|`revoked`), `expires_at`, `quota_total`, `quota_claimed`, `send_invite_sms` (`"1"`/`"0"`), `name`.
- All timestamps ISO 8601 UTC via `datetime.now(timezone.utc).isoformat()`.
- Envelope: `LedgerMessage` from `backend.src.models.ledger`; publish via `push_to_ledger` from `backend.src.utils.ledgerUtils` (usage template: `backend/backend/src/services/reapplicationBlock/session_start.py:69-88`).
- Commit after every task with a `feat(applicant-release): …` message.

---

### Task 1: Config keys + routing rules

**Files:**
- Modify: `backend/backend/src/config.dev.json`, `config.test.json`, `config.demo.json`, `config.prod.json`
- Modify: `backend/backend/src/routing/routes.json`
- Test: `backend/tests/unit/routing/test_applicant_release_routing.py`

**Interfaces:**
- Consumes: existing router `resolve()` and config var-substitution.
- Produces: config keys `service_applicantRelease` = `"applicantReleaseService"`, `inbox_applicantRelease` = `"inbox:applicantReleaseService"`, `enable_applicantReleaseService` = `true`, and six `msg_type_applicant_release_*` keys used by every later task.

- [ ] **Step 1: Write the failing routing test**

```python
# backend/tests/unit/routing/test_applicant_release_routing.py
"""CRM applicant_release.* commands route to applicantReleaseService; facts route back."""
import os

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_for_tests")

from backend.src.models.ledger import LedgerMessage  # noqa: E402
from backend.src.routing import router as routing_router  # noqa: E402


def _msg(agt: str, typ: str) -> LedgerMessage:
    return LedgerMessage(
        conv="conv-1", agt=agt, usr="u-1", seq=1, cls="cmd", typ=typ, payload="{}"
    )


def _resolved_inboxes(msg: LedgerMessage) -> list[str]:
    targets = routing_router.resolve(msg)
    # resolve returns inbox stream names (see routing/README.md); normalise to list of str
    return [t if isinstance(t, str) else t[0] for t in targets]


def test_crm_release_command_reaches_applicant_release_service():
    inboxes = _resolved_inboxes(_msg("billie-crm", "applicant_release.released.v1"))
    assert "inbox:applicantReleaseService" in inboxes


def test_crm_revoke_and_gate_mode_reach_service_via_prefix():
    for typ in ("applicant_release.revoked.v1", "applicant_release.gate_mode.set.v1"):
        assert "inbox:applicantReleaseService" in _resolved_inboxes(_msg("billie-crm", typ))


def test_service_facts_route_back_to_crm_inbox():
    for typ in (
        "applicant_release.grant_claimed.v1",
        "applicant_release.invites_sent.v1",
        "applicant_release.gate_mode.changed.v1",
    ):
        assert "inbox:billie-servicing" in _resolved_inboxes(
            _msg("applicantReleaseService", typ)
        )
```

Before running, check `backend/tests/unit/routing/` for an existing router test and mirror its exact call pattern for `resolve()` (it may take a dict or return `(inbox, message)` tuples — adjust `_resolved_inboxes` to match the established test, keeping the assertions).

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `python -m pytest tests/unit/routing/test_applicant_release_routing.py -v`
Expected: FAIL (unknown recipient — rules absent).

- [ ] **Step 3: Add config keys to all four config JSONs**

In each of `config.dev.json`, `config.test.json`, `config.demo.json`, `config.prod.json`, alongside the existing `service_reapplicationBlock` / `inbox_reapplicationBlock` keys:

```json
"service_applicantRelease": "applicantReleaseService",
"inbox_applicantRelease": "inbox:applicantReleaseService",
"enable_applicantReleaseService": true,
"msg_type_applicant_release_released": "applicant_release.released.v1",
"msg_type_applicant_release_revoked": "applicant_release.revoked.v1",
"msg_type_applicant_release_gate_mode_set": "applicant_release.gate_mode.set.v1",
"msg_type_applicant_release_grant_claimed": "applicant_release.grant_claimed.v1",
"msg_type_applicant_release_invites_sent": "applicant_release.invites_sent.v1",
"msg_type_applicant_release_gate_mode_changed": "applicant_release.gate_mode.changed.v1",
```

And in the `"feature_flags"` block of each: `"ENABLE_APPLICATION_GATE": false`.

- [ ] **Step 4: Add routing rules**

In `backend/backend/src/routing/routes.json`:

(a) In the `"routes"` object, find the `"${agent_billie-crm}"` **sender** block (create it if only the target usages exist) and append:

```json
{
  "condition": { "typ": "applicant_release." },
  "targetAgent": [ "${service_applicantRelease}" ]
}
```

(Prefix match — router matches exact → prefix → wildcard, `router.py:319-366` — so this catches `released`/`revoked`/`gate_mode.set` from the CRM.)

(b) Add a new sender block:

```json
"${service_applicantRelease}": [
  {
    "condition": { "typ": "applicant_release." },
    "targetAgent": [ "${agent_billie-crm}" ]
  }
]
```

(c) In `"agent_inbox_mapping"` add: `"${service_applicantRelease}": "${inbox_applicantRelease}",`

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/unit/routing/test_applicant_release_routing.py -v`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/backend/src/config.*.json backend/backend/src/routing/routes.json backend/tests/unit/routing/test_applicant_release_routing.py
git commit -m "feat(applicant-release): config keys and routing rules for applicantReleaseService"
```

---

### Task 2: Enums, payload models, capacity copy

**Files:**
- Create: `backend/backend/src/services/applicantRelease/__init__.py` (empty)
- Create: `backend/backend/src/services/applicantRelease/enums.py`
- Create: `backend/backend/src/services/applicantRelease/models.py`
- Create: `backend/backend/src/services/applicantRelease/messages.py`
- Test: `backend/tests/unit/services/applicantRelease/test_models.py`, `test_messages.py` (and empty `backend/tests/unit/services/applicantRelease/__init__.py` if sibling dirs have one)

**Interfaces:**
- Produces: `ReleaseType`, `GateMode`, `GateOutcome` enums; `ReleasedPayload.model_validate(dict)`, `GrantSpec(mobile_e164, contact_id, send_sms)`, `RevokedPayload`, `GateModeSetPayload`; `parse_event_payload(event_data: dict) -> dict`; `resolve_capacity_message(key: str, redis=None) -> str` with keys `"at_capacity"` and `"not_on_release"`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/services/applicantRelease/test_models.py
import json
import os

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_for_tests")

import pytest  # noqa: E402
from backend.src.services.applicantRelease.models import (  # noqa: E402
    GateModeSetPayload,
    ReleasedPayload,
    RevokedPayload,
    parse_event_payload,
)


def test_parse_event_payload_decodes_json_string():
    assert parse_event_payload({"payload": json.dumps({"a": 1})}) == {"a": 1}
    assert parse_event_payload({"payload": {"a": 1}}) == {"a": 1}
    assert parse_event_payload({"payload": "not-json"}) == {}
    assert parse_event_payload({}) == {}


def test_released_payload_targeted():
    p = ReleasedPayload.model_validate({
        "release_id": "rel-1", "name": "August wave 3", "type": "waitlist",
        "expires_at": "2026-08-16T00:00:00+00:00", "send_invite_sms": True,
        "grants": [{"mobile_e164": "+61400000001", "contact_id": "c-1", "send_sms": True},
                   {"mobile_e164": "+61400000002", "contact_id": None, "send_sms": False}],
        "released_by": "staff-1",
    })
    assert p.type == "waitlist"
    assert p.quota_count is None
    assert p.grants[1].send_sms is False


def test_released_payload_open_quota():
    p = ReleasedPayload.model_validate({
        "release_id": "rel-2", "name": "Walk-ups", "type": "open_quota",
        "expires_at": "2026-08-16T00:00:00+00:00", "send_invite_sms": False,
        "quota_count": 150, "released_by": "staff-1",
    })
    assert p.quota_count == 150
    assert p.grants == []


def test_gate_mode_set_rejects_unknown_mode():
    with pytest.raises(Exception):
        GateModeSetPayload.model_validate({"mode": "sideways", "set_by": "ops"})
    assert RevokedPayload.model_validate({"release_id": "r", "revoked_by": "s"}).reason is None
```

```python
# backend/tests/unit/services/applicantRelease/test_messages.py
import os

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_for_tests")

from unittest.mock import AsyncMock  # noqa: E402

import pytest  # noqa: E402
from backend.src.services.applicantRelease import messages  # noqa: E402


@pytest.mark.asyncio
async def test_redis_override_wins():
    r = AsyncMock()
    r.hgetall = AsyncMock(return_value={b"at_capacity": b"custom copy"})
    assert await messages.resolve_capacity_message("at_capacity", r) == "custom copy"


@pytest.mark.asyncio
async def test_fallback_without_redis():
    text = await messages.resolve_capacity_message("at_capacity", None)
    assert "capacity" in text.lower() or "batches" in text.lower()


@pytest.mark.asyncio
async def test_redis_error_falls_back():
    r = AsyncMock()
    r.hgetall = AsyncMock(side_effect=RuntimeError("down"))
    assert await messages.resolve_capacity_message("not_on_release", r)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/services/applicantRelease/ -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

```python
# backend/backend/src/services/applicantRelease/enums.py
"""Enums for the applicant-release entry gate."""
from __future__ import annotations

import enum


class ReleaseType(str, enum.Enum):
    WAITLIST = "waitlist"
    PHONE_LIST = "phone_list"
    OPEN_QUOTA = "open_quota"


class GateMode(str, enum.Enum):
    OPEN = "open"
    GATED = "gated"


class GateOutcome(str, enum.Enum):
    BYPASS_CUSTOMER = "bypass_customer"
    ENTER_GRANT = "enter_grant"
    ENTER_QUOTA = "enter_quota"
    DENY = "deny"
```

```python
# backend/backend/src/services/applicantRelease/models.py
"""Pydantic contracts for applicant_release.* events (CRM-originated commands)."""
from __future__ import annotations

import json
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


def parse_event_payload(event_data: dict[str, Any]) -> dict[str, Any]:
    """Envelope payload arrives as a JSON string on the wire; tolerate dicts and junk."""
    payload = event_data.get("payload", {})
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return {}
    return payload if isinstance(payload, dict) else {}


class GrantSpec(BaseModel):
    mobile_e164: str
    contact_id: Optional[str] = None
    send_sms: bool = False


class ReleasedPayload(BaseModel):
    release_id: str
    name: str
    type: Literal["waitlist", "phone_list", "open_quota"]
    expires_at: str
    send_invite_sms: bool = False
    grants: list[GrantSpec] = Field(default_factory=list)
    quota_count: Optional[int] = None
    released_by: str


class RevokedPayload(BaseModel):
    release_id: str
    revoked_by: str
    reason: Optional[str] = None


class GateModeSetPayload(BaseModel):
    mode: Literal["open", "gated"]
    set_by: str
    reason: Optional[str] = None
```

```python
# backend/backend/src/services/applicantRelease/messages.py
"""Runtime-editable capacity-gate copy.

Resolution order mirrors reapplicationBlock/stop_messages.py:
Redis hash ``capacity_gate_messages`` → config ``capacity_gate_messages`` block
→ hard-coded fallback. Ops can retune wording without a deploy.
"""
from __future__ import annotations

from backend.src.config import config

CAPACITY_COPY_KEY = "capacity_gate_messages"

_FALLBACKS = {
    "at_capacity": (
        "We're at capacity right now. We let new applications in batches so we can "
        "look after every customer properly — join the waitlist at billie.loans and "
        "we'll text you the moment a spot opens."
    ),
    "not_on_release": (
        "Your number isn't on this release yet. Join the waitlist at billie.loans "
        "and we'll text you the moment a spot opens."
    ),
    "invite_sms": (
        "Billie: you're in! Your spot to apply is open until {expires}. "
        "Start here: https://chat.billie.loans"
    ),
}


async def _redis_messages(redis) -> dict:
    if redis is None:
        return {}
    try:
        data = await redis.hgetall(CAPACITY_COPY_KEY)
    except Exception:  # pragma: no cover - defensive
        return {}
    decoded = {}
    for k, v in (data or {}).items():
        k = k.decode() if isinstance(k, bytes) else k
        v = v.decode() if isinstance(v, bytes) else v
        decoded[k] = v
    return decoded


async def resolve_capacity_message(key: str, redis=None) -> str:
    overrides = await _redis_messages(redis)
    if overrides.get(key):
        return overrides[key]
    configured = config.get(CAPACITY_COPY_KEY) or {}
    if isinstance(configured, dict) and configured.get(key):
        return configured[key]
    return _FALLBACKS.get(key, _FALLBACKS["at_capacity"])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/services/applicantRelease/ -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/backend/src/services/applicantRelease backend/tests/unit/services/applicantRelease
git commit -m "feat(applicant-release): enums, event payload models, runtime capacity copy"
```

---

### Task 3: Redis grant repository (atomic quota claim)

**Files:**
- Create: `backend/backend/src/services/applicantRelease/repository.py`
- Test: `backend/tests/unit/services/applicantRelease/test_repository.py`

**Interfaces:**
- Consumes: `ReleasedPayload`, `GrantSpec` from Task 2.
- Produces (all methods on `RedisApplicantReleaseRepository(redis)`):
  - `async apply_release(payload: ReleasedPayload) -> bool` — False on replay
  - `async get_release(release_id: str) -> Optional[dict]`
  - `async get_grant(mobile_e164: str) -> Optional[dict]`
  - `async claim_grant(mobile_e164: str) -> Optional[dict]` — returns `{"release_id", "source", "already_claimed": bool}` or None
  - `async claim_quota_slot(mobile_e164: str) -> Optional[dict]` — same shape, source `"quota"`, or None when no open quota
  - `async has_open_quota() -> bool`
  - `async revoke_release(release_id: str) -> int` — grants removed
  - `async get_gate_mode() -> str` / `async set_gate_mode(mode: str) -> None`
- Module constants: `KEY_MODE = "application_gate:mode"`, `KEY_RELEASE = "applicant_release:release:{}"`, `KEY_GRANT = "applicant_release:grant:{}"`, `KEY_MEMBERS = "applicant_release:members:{}"`, `KEY_QUOTA_SET = "applicant_release:quota_releases"`, `KEY_PROCESSED = "applicant_release:processed:{}"`.

This task uses the real-Redis `redis_mock` fixture (integration-style, like `test_repository.py` in reapplicationBlock) because the quota claim is a Lua script — mocks would test nothing.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/services/applicantRelease/test_repository.py
"""Grant-store repository against a real local Redis (redis_mock fixture)."""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_for_tests")

import pytest  # noqa: E402
from backend.src.services.applicantRelease.models import GrantSpec, ReleasedPayload  # noqa: E402
from backend.src.services.applicantRelease.repository import (  # noqa: E402
    RedisApplicantReleaseRepository,
)


def _future() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()


def _past() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()


def _targeted(release_id: str, mobiles: list[str], expires_at: str | None = None) -> ReleasedPayload:
    return ReleasedPayload(
        release_id=release_id, name="t", type="waitlist",
        expires_at=expires_at or _future(), send_invite_sms=False,
        grants=[GrantSpec(mobile_e164=m, send_sms=False) for m in mobiles],
        released_by="staff-1",
    )


def _quota(release_id: str, count: int) -> ReleasedPayload:
    return ReleasedPayload(
        release_id=release_id, name="q", type="open_quota",
        expires_at=_future(), send_invite_sms=False,
        quota_count=count, released_by="staff-1",
    )


@pytest.fixture
async def repo(redis_mock):
    r = RedisApplicantReleaseRepository(redis_mock)
    yield r
    # best-effort cleanup of keys created by tests (unique ids keep tests isolated anyway)


def _mob() -> str:
    return "+614" + uuid.uuid4().hex[:8]


async def test_apply_release_is_replay_safe(repo):
    rid = f"rel-{uuid.uuid4().hex[:8]}"
    m = _mob()
    assert await repo.apply_release(_targeted(rid, [m])) is True
    assert await repo.apply_release(_targeted(rid, [m])) is False  # replay
    grant = await repo.get_grant(m)
    assert grant["release_id"] == rid and grant["status"] == "granted"


async def test_claim_grant_and_idempotent_reclaim(repo):
    rid = f"rel-{uuid.uuid4().hex[:8]}"
    m = _mob()
    await repo.apply_release(_targeted(rid, [m]))
    first = await repo.claim_grant(m)
    assert first == {"release_id": rid, "source": "targeted", "already_claimed": False}
    again = await repo.claim_grant(m)
    assert again["already_claimed"] is True


async def test_expired_grant_cannot_claim(repo):
    rid = f"rel-{uuid.uuid4().hex[:8]}"
    m = _mob()
    await repo.apply_release(_targeted(rid, [m], expires_at=_past()))
    assert await repo.claim_grant(m) is None


async def test_quota_claim_caps_atomically(repo):
    rid = f"rel-{uuid.uuid4().hex[:8]}"
    await repo.apply_release(_quota(rid, 5))
    results = await asyncio.gather(*[repo.claim_quota_slot(_mob()) for _ in range(20)])
    assert sum(1 for x in results if x) == 5
    assert await repo.has_open_quota() is False


async def test_quota_reclaim_same_mobile_does_not_burn_slot(repo):
    rid = f"rel-{uuid.uuid4().hex[:8]}"
    await repo.apply_release(_quota(rid, 2))
    m = _mob()
    first = await repo.claim_quota_slot(m)
    assert first and first["already_claimed"] is False
    again = await repo.claim_grant(m)  # re-entry path: grant now exists for m
    assert again["already_claimed"] is True
    assert await repo.has_open_quota() is True  # only 1 of 2 slots used


async def test_revoke_kills_grants_and_quota(repo):
    rid = f"rel-{uuid.uuid4().hex[:8]}"
    m = _mob()
    await repo.apply_release(_targeted(rid, [m]))
    removed = await repo.revoke_release(rid)
    assert removed == 1
    assert await repo.get_grant(m) is None
    assert (await repo.get_release(rid))["status"] == "revoked"


async def test_gate_mode_defaults_open(repo):
    assert await repo.get_gate_mode() == "open"
    await repo.set_gate_mode("gated")
    assert await repo.get_gate_mode() == "gated"
    await repo.set_gate_mode("open")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/services/applicantRelease/test_repository.py -v`
Expected: FAIL with import error. (If Redis isn't running locally, start it the way the existing suite expects — the `redis_mock` fixture connects to `redis://localhost`.)

- [ ] **Step 3: Implement the repository**

```python
# backend/backend/src/services/applicantRelease/repository.py
"""Redis-primary grant store for the applicant-release entry gate.

Keys (all string values):
  application_gate:mode                       "open" | "gated" (absent = open)
  applicant_release:release:{id}    hash      type,status,expires_at,quota_total,quota_claimed,send_invite_sms,name
  applicant_release:grant:{mobile}  hash      release_id,status,expires_at,claimed_at,source
  applicant_release:members:{id}    set       mobiles granted under the release (revocation sweep)
  applicant_release:quota_releases  set       release ids with open quota
  applicant_release:processed:{id}  string    replay marker (SET NX)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from backend.src.services.applicantRelease.models import ReleasedPayload

KEY_MODE = "application_gate:mode"
KEY_RELEASE = "applicant_release:release:{}"
KEY_GRANT = "applicant_release:grant:{}"
KEY_MEMBERS = "applicant_release:members:{}"
KEY_QUOTA_SET = "applicant_release:quota_releases"
KEY_PROCESSED = "applicant_release:processed:{}"

_PROCESSED_TTL = 90 * 24 * 3600  # outlives any plausible replay window

# Atomic check-and-claim for one quota slot: caps quota_claimed at quota_total
# and creates the grant + membership in the same script so concurrent claims
# can never oversell.  KEYS: release, grant, members  ARGV: mobile, now_iso
_CLAIM_QUOTA_LUA = """
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'active' then return 0 end
local total = tonumber(redis.call('HGET', KEYS[1], 'quota_total') or '0')
local claimed = tonumber(redis.call('HGET', KEYS[1], 'quota_claimed') or '0')
if claimed >= total then return 0 end
redis.call('HINCRBY', KEYS[1], 'quota_claimed', 1)
redis.call('HSET', KEYS[2],
  'release_id', ARGV[3], 'status', 'claimed', 'source', 'quota',
  'expires_at', redis.call('HGET', KEYS[1], 'expires_at') or '',
  'claimed_at', ARGV[2])
redis.call('SADD', KEYS[3], ARGV[1])
if claimed + 1 >= total then redis.call('SREM', KEYS[4], ARGV[3]) end
return 1
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expired(expires_at: str) -> bool:
    if not expires_at:
        return False
    try:
        return datetime.fromisoformat(expires_at) <= datetime.now(timezone.utc)
    except ValueError:
        return False


def _decode(h: dict) -> dict:
    return {
        (k.decode() if isinstance(k, bytes) else k): (v.decode() if isinstance(v, bytes) else v)
        for k, v in (h or {}).items()
    }


class RedisApplicantReleaseRepository:
    def __init__(self, redis: Any) -> None:
        self.redis = redis
        self._claim_quota = None  # lazily registered Lua script

    async def apply_release(self, payload: ReleasedPayload) -> bool:
        first = await self.redis.set(
            KEY_PROCESSED.format(payload.release_id), "1", ex=_PROCESSED_TTL, nx=True
        )
        if not first:
            return False
        await self.redis.hset(
            KEY_RELEASE.format(payload.release_id),
            mapping={
                "type": payload.type,
                "status": "active",
                "name": payload.name,
                "expires_at": payload.expires_at,
                "quota_total": str(payload.quota_count or 0),
                "quota_claimed": "0",
                "send_invite_sms": "1" if payload.send_invite_sms else "0",
            },
        )
        for grant in payload.grants:
            await self.redis.hset(
                KEY_GRANT.format(grant.mobile_e164),
                mapping={
                    "release_id": payload.release_id,
                    "status": "granted",
                    "source": "targeted",
                    "expires_at": payload.expires_at,
                },
            )
            await self.redis.sadd(KEY_MEMBERS.format(payload.release_id), grant.mobile_e164)
        if payload.type == "open_quota" and (payload.quota_count or 0) > 0:
            await self.redis.sadd(KEY_QUOTA_SET, payload.release_id)
        return True

    async def get_release(self, release_id: str) -> Optional[dict]:
        h = _decode(await self.redis.hgetall(KEY_RELEASE.format(release_id)))
        return h or None

    async def get_grant(self, mobile_e164: str) -> Optional[dict]:
        h = _decode(await self.redis.hgetall(KEY_GRANT.format(mobile_e164)))
        return h or None

    async def claim_grant(self, mobile_e164: str) -> Optional[dict]:
        grant = await self.get_grant(mobile_e164)
        if not grant:
            return None
        if _expired(grant.get("expires_at", "")):
            return None
        release = await self.get_release(grant["release_id"])
        if not release or release.get("status") != "active":
            return None
        if grant.get("status") == "claimed":
            return {
                "release_id": grant["release_id"],
                "source": grant.get("source", "targeted"),
                "already_claimed": True,
            }
        await self.redis.hset(
            KEY_GRANT.format(mobile_e164),
            mapping={"status": "claimed", "claimed_at": _now_iso()},
        )
        return {
            "release_id": grant["release_id"],
            "source": grant.get("source", "targeted"),
            "already_claimed": False,
        }

    async def has_open_quota(self) -> bool:
        for rid in await self._quota_release_ids():
            release = await self.get_release(rid)
            if (
                release
                and release.get("status") == "active"
                and not _expired(release.get("expires_at", ""))
                and int(release.get("quota_claimed", "0")) < int(release.get("quota_total", "0"))
            ):
                return True
        return False

    async def claim_quota_slot(self, mobile_e164: str) -> Optional[dict]:
        if self._claim_quota is None:
            self._claim_quota = self.redis.register_script(_CLAIM_QUOTA_LUA)
        for rid in await self._quota_release_ids():
            release = await self.get_release(rid)
            if not release or _expired(release.get("expires_at", "")):
                continue
            won = await self._claim_quota(
                keys=[
                    KEY_RELEASE.format(rid),
                    KEY_GRANT.format(mobile_e164),
                    KEY_MEMBERS.format(rid),
                    KEY_QUOTA_SET,
                ],
                args=[mobile_e164, _now_iso(), rid],
            )
            if won:
                return {"release_id": rid, "source": "quota", "already_claimed": False}
        return None

    async def revoke_release(self, release_id: str) -> int:
        removed = 0
        members = await self.redis.smembers(KEY_MEMBERS.format(release_id))
        for m in members or []:
            mobile = m.decode() if isinstance(m, bytes) else m
            grant = await self.get_grant(mobile)
            if grant and grant.get("release_id") == release_id:
                await self.redis.delete(KEY_GRANT.format(mobile))
                removed += 1
        await self.redis.hset(KEY_RELEASE.format(release_id), mapping={"status": "revoked"})
        await self.redis.srem(KEY_QUOTA_SET, release_id)
        return removed

    async def get_gate_mode(self) -> str:
        raw = await self.redis.get(KEY_MODE)
        mode = raw.decode() if isinstance(raw, bytes) else raw
        return mode or "open"

    async def set_gate_mode(self, mode: str) -> None:
        await self.redis.set(KEY_MODE, mode)

    async def _quota_release_ids(self) -> list[str]:
        raw = await self.redis.smembers(KEY_QUOTA_SET)
        return [r.decode() if isinstance(r, bytes) else r for r in (raw or [])]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/services/applicantRelease/test_repository.py -v`
Expected: PASS (8 tests). The concurrency test proves exactly 5 of 20 racing claims win.

- [ ] **Step 5: Commit**

```bash
git add backend/backend/src/services/applicantRelease/repository.py backend/tests/unit/services/applicantRelease/test_repository.py
git commit -m "feat(applicant-release): Redis grant store with atomic quota claim"
```

---

### Task 4: Postgres shadow, Alembic migration, dual-write

**Files:**
- Create: `backend/migrations/versions/0009_applicant_release.py`
- Create: `backend/backend/src/services/applicantRelease/postgres_repository.py`
- Create: `backend/backend/src/services/applicantRelease/dual_write.py`
- Test: `backend/tests/unit/services/applicantRelease/test_dual_write.py`

**Interfaces:**
- Consumes: `RedisApplicantReleaseRepository` (Task 3), `resolve_store_mode`/`StoreMode` from `billie_shared.infra.store_mode`.
- Produces: `build_applicant_release_repository(redis_repo)` selected by env `APPLICANT_RELEASE_PROJECTION_STORE` (`redis`|`dual`|`pg`, default redis); `PostgresApplicantReleaseRepository` with `shadow_release(release_id: str, data: dict)`, `shadow_grant(mobile_e164: str, data: dict)`, `delete_grant(mobile_e164: str)`. The dual-write wrapper exposes the same public surface as the Redis repo and shadows best-effort after each write (Redis stays authoritative — same posture as `reapplicationBlock/dual_write.py`).

- [ ] **Step 1: Write the Alembic migration**

Check the current head first: `ls backend/migrations/versions/` — `down_revision` below must name the latest revision (expected `0008_identity_nonmatch_review`; adjust if a newer one landed).

```python
# backend/migrations/versions/0009_applicant_release.py
"""applicant_release shadow tables (release + grant JSONB read-models)

Revision ID: 0009_applicant_release
Revises: 0008_identity_nonmatch_review
Create Date: 2026-08-02
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009_applicant_release"
down_revision = "0008_identity_nonmatch_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS applicant_release")
    op.create_table(
        "release",
        sa.Column("release_id", sa.Text(), primary_key=True),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="applicant_release",
    )
    op.create_table(
        "grant",
        sa.Column("mobile_e164", sa.Text(), primary_key=True),
        sa.Column("release_id", sa.Text(), nullable=False),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="applicant_release",
    )
    op.create_index(
        "ix_applicant_release_grant_release",
        "grant",
        ["release_id"],
        schema="applicant_release",
    )


def downgrade() -> None:
    op.drop_table("grant", schema="applicant_release")
    op.drop_table("release", schema="applicant_release")
    op.execute("DROP SCHEMA IF EXISTS applicant_release")
```

- [ ] **Step 2: Write the failing dual-write test**

```python
# backend/tests/unit/services/applicantRelease/test_dual_write.py
import os

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_for_tests")

from unittest.mock import AsyncMock, patch  # noqa: E402

import pytest  # noqa: E402
from billie_shared.infra.store_mode import StoreMode  # noqa: E402
from backend.src.services.applicantRelease import dual_write  # noqa: E402
from backend.src.services.applicantRelease.models import GrantSpec, ReleasedPayload  # noqa: E402


def _payload() -> ReleasedPayload:
    return ReleasedPayload(
        release_id="rel-1", name="t", type="waitlist",
        expires_at="2099-01-01T00:00:00+00:00", send_invite_sms=False,
        grants=[GrantSpec(mobile_e164="+61400000001")], released_by="s",
    )


def test_redis_mode_returns_bare_redis_repo():
    redis_repo = AsyncMock()
    with patch.object(dual_write, "resolve_store_mode", return_value=StoreMode.REDIS):
        assert dual_write.build_applicant_release_repository(redis_repo) is redis_repo


@pytest.mark.asyncio
async def test_dual_mode_shadows_after_redis_write():
    redis_repo = AsyncMock()
    redis_repo.apply_release = AsyncMock(return_value=True)
    with patch.object(dual_write, "resolve_store_mode", return_value=StoreMode.DUAL), \
         patch.object(dual_write, "PostgresApplicantReleaseRepository") as PgCls:
        pg = PgCls.return_value
        pg.shadow_release = AsyncMock()
        pg.shadow_grant = AsyncMock()
        repo = dual_write.build_applicant_release_repository(redis_repo)
        assert await repo.apply_release(_payload()) is True
    redis_repo.apply_release.assert_awaited_once()
    pg.shadow_release.assert_awaited_once()
    pg.shadow_grant.assert_awaited_once()


@pytest.mark.asyncio
async def test_shadow_failure_never_breaks_the_write():
    redis_repo = AsyncMock()
    redis_repo.apply_release = AsyncMock(return_value=True)
    with patch.object(dual_write, "resolve_store_mode", return_value=StoreMode.DUAL), \
         patch.object(dual_write, "PostgresApplicantReleaseRepository") as PgCls:
        PgCls.return_value.shadow_release = AsyncMock(side_effect=RuntimeError("pg down"))
        PgCls.return_value.shadow_grant = AsyncMock()
        repo = dual_write.build_applicant_release_repository(redis_repo)
        assert await repo.apply_release(_payload()) is True  # still succeeds
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/unit/services/applicantRelease/test_dual_write.py -v`
Expected: FAIL with import error.

- [ ] **Step 4: Implement postgres repo + dual-write**

```python
# backend/backend/src/services/applicantRelease/postgres_repository.py
"""Best-effort Postgres shadow of the applicant-release grant store.

Redis is authoritative (repository.py); these JSONB rows exist for durability,
parity checks, and the eventual pg cutover — same posture as
reapplicationBlock/postgres_repository.py.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text

from billie_shared.infra.pg_client import get_async_engine


class PostgresApplicantReleaseRepository:
    async def shadow_release(self, release_id: str, data: dict[str, Any]) -> None:
        engine = get_async_engine()
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO applicant_release.release (release_id, data, updated_at) "
                    "VALUES (:rid, CAST(:data AS jsonb), now()) "
                    "ON CONFLICT (release_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()"
                ),
                {"rid": release_id, "data": json.dumps(data)},
            )

    async def shadow_grant(self, mobile_e164: str, data: dict[str, Any]) -> None:
        engine = get_async_engine()
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    'INSERT INTO applicant_release."grant" (mobile_e164, release_id, data, updated_at) '
                    "VALUES (:mob, :rid, CAST(:data AS jsonb), now()) "
                    "ON CONFLICT (mobile_e164) DO UPDATE SET release_id = EXCLUDED.release_id, "
                    "data = EXCLUDED.data, updated_at = now()"
                ),
                {"mob": mobile_e164, "rid": data.get("release_id", ""), "data": json.dumps(data)},
            )

    async def delete_grant(self, mobile_e164: str) -> None:
        engine = get_async_engine()
        async with engine.begin() as conn:
            await conn.execute(
                text('DELETE FROM applicant_release."grant" WHERE mobile_e164 = :mob'),
                {"mob": mobile_e164},
            )
```

Before finalising, open `backend/backend/src/services/reapplicationBlock/postgres_repository.py` and mirror its engine-acquisition call exactly (if it uses a different helper than `get_async_engine`, use that one).

```python
# backend/backend/src/services/applicantRelease/dual_write.py
"""Store-mode selection for the applicant-release grant store."""
from __future__ import annotations

import logging
from typing import Any, Optional

from billie_shared.infra.store_mode import StoreMode, resolve_store_mode

from backend.src.services.applicantRelease.models import ReleasedPayload
from backend.src.services.applicantRelease.postgres_repository import (
    PostgresApplicantReleaseRepository,
)
from backend.src.services.applicantRelease.repository import RedisApplicantReleaseRepository

logger = logging.getLogger(__name__)

_STORE_FLAG = "APPLICANT_RELEASE_PROJECTION_STORE"


class DualWriteApplicantReleaseRepository:
    """Redis-authoritative wrapper that shadows writes into Postgres best-effort."""

    def __init__(
        self,
        redis_repo: RedisApplicantReleaseRepository,
        pg_repo: PostgresApplicantReleaseRepository,
    ) -> None:
        self._redis = redis_repo
        self._pg = pg_repo

    # -- reads delegate straight to Redis -------------------------------------
    async def get_release(self, release_id: str):
        return await self._redis.get_release(release_id)

    async def get_grant(self, mobile_e164: str):
        return await self._redis.get_grant(mobile_e164)

    async def has_open_quota(self) -> bool:
        return await self._redis.has_open_quota()

    async def get_gate_mode(self) -> str:
        return await self._redis.get_gate_mode()

    # -- writes: Redis first, then best-effort shadow -------------------------
    async def apply_release(self, payload: ReleasedPayload) -> bool:
        applied = await self._redis.apply_release(payload)
        if applied:
            await self._shadow_release(payload.release_id)
            for grant in payload.grants:
                await self._shadow_grant(grant.mobile_e164)
        return applied

    async def claim_grant(self, mobile_e164: str):
        result = await self._redis.claim_grant(mobile_e164)
        if result and not result.get("already_claimed"):
            await self._shadow_grant(mobile_e164)
        return result

    async def claim_quota_slot(self, mobile_e164: str):
        result = await self._redis.claim_quota_slot(mobile_e164)
        if result:
            await self._shadow_release(result["release_id"])
            await self._shadow_grant(mobile_e164)
        return result

    async def revoke_release(self, release_id: str) -> int:
        removed = await self._redis.revoke_release(release_id)
        await self._shadow_release(release_id)
        return removed

    async def set_gate_mode(self, mode: str) -> None:
        await self._redis.set_gate_mode(mode)

    async def _shadow_release(self, release_id: str) -> None:
        try:
            data = await self._redis.get_release(release_id) or {}
            await self._pg.shadow_release(release_id, data)
        except Exception:  # pragma: no cover — shadow must never break the write
            logger.warning("applicant_release pg shadow (release) failed", exc_info=True)

    async def _shadow_grant(self, mobile_e164: str) -> None:
        try:
            data = await self._redis.get_grant(mobile_e164)
            if data is None:
                await self._pg.delete_grant(mobile_e164)
            else:
                await self._pg.shadow_grant(mobile_e164, data)
        except Exception:  # pragma: no cover
            logger.warning("applicant_release pg shadow (grant) failed", exc_info=True)


def build_applicant_release_repository(
    redis_repo: RedisApplicantReleaseRepository,
):
    mode = resolve_store_mode(_STORE_FLAG)
    if mode in (StoreMode.DUAL, StoreMode.PG):
        return DualWriteApplicantReleaseRepository(
            redis_repo, PostgresApplicantReleaseRepository()
        )
    return redis_repo
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/unit/services/applicantRelease/test_dual_write.py -v`
Expected: PASS (3 tests). Also verify the migration parses: `python -c "import importlib.util,sys; spec=importlib.util.spec_from_file_location('m','migrations/versions/0009_applicant_release.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print(m.revision)"` (from `backend/`).

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/versions/0009_applicant_release.py backend/backend/src/services/applicantRelease/postgres_repository.py backend/backend/src/services/applicantRelease/dual_write.py backend/tests/unit/services/applicantRelease/test_dual_write.py
git commit -m "feat(applicant-release): Postgres shadow tables and dual-write store mode"
```

---

### Task 5: applicantReleaseService (event consumer + invite SMS)

**Files:**
- Create: `backend/backend/src/services/applicantRelease/applicant_release_service.py`
- Modify: `backend/backend/src/__main__.py` (import + AgentRunner + ProcessSpec)
- Test: `backend/tests/unit/services/applicantRelease/test_service.py`

**Interfaces:**
- Consumes: repository builder (Task 4), models (Task 2), `send_sms(to_number, body) -> bool` from `backend.src.utils.smsUtils`, `push_to_ledger` + `LedgerMessage`, `resolve_capacity_message` (for the `invite_sms` template).
- Produces: `class ApplicantReleaseService(BaseAgent)` with `async process_message(self, event_id: str, event_data: dict)`; module-level `FACT_AGENT` name; emits `applicant_release.invites_sent.v1` and `applicant_release.gate_mode.changed.v1` facts. `__main__.py` gains `run_applicant_release_service`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/services/applicantRelease/test_service.py
import json
import os

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_for_tests")

from unittest.mock import AsyncMock, patch  # noqa: E402

import pytest  # noqa: E402
from backend.src.services.applicantRelease import applicant_release_service as svc_mod  # noqa: E402
from backend.src.services.applicantRelease.applicant_release_service import (  # noqa: E402
    ApplicantReleaseService,
)


def _released_event(send_invite_sms=True):
    return {
        "conv": "applicant-release:rel-1", "agt": "billie-crm", "usr": "staff-1",
        "cls": "cmd", "typ": "applicant_release.released.v1", "cause": "ev-1",
        "payload": json.dumps({
            "release_id": "rel-1", "name": "Wave", "type": "waitlist",
            "expires_at": "2099-01-01T00:00:00+00:00",
            "send_invite_sms": send_invite_sms,
            "grants": [
                {"mobile_e164": "+61400000001", "contact_id": "c-1", "send_sms": True},
                {"mobile_e164": "+61400000002", "contact_id": None, "send_sms": False},
            ],
            "released_by": "staff-1",
        }),
    }


def _service_with_mocks():
    svc = ApplicantReleaseService.__new__(ApplicantReleaseService)  # skip BaseAgent init
    svc.repository = AsyncMock()
    svc.repository.apply_release = AsyncMock(return_value=True)
    svc.repository.revoke_release = AsyncMock(return_value=2)
    svc.repository.set_gate_mode = AsyncMock()
    svc.agent_name = "applicantReleaseService"
    return svc


@pytest.mark.asyncio
async def test_released_sends_sms_only_where_send_sms_true():
    svc = _service_with_mocks()
    with patch.object(svc_mod, "send_sms", new=AsyncMock(return_value=True)) as sms, \
         patch.object(svc_mod, "push_to_ledger", new=AsyncMock()) as ledger:
        await svc.process_message("m-1", _released_event())
    sms.assert_awaited_once()
    assert sms.await_args.args[0] == "+61400000001"
    fact = ledger.await_args.args[0][0]
    assert fact.typ == "applicant_release.invites_sent.v1"
    payload = json.loads(fact.payload) if isinstance(fact.payload, str) else fact.payload
    assert payload["sent"] == ["+61400000001"] and payload["failed"] == []


@pytest.mark.asyncio
async def test_failed_sms_retried_once_then_reported():
    svc = _service_with_mocks()
    with patch.object(svc_mod, "send_sms", new=AsyncMock(return_value=False)) as sms, \
         patch.object(svc_mod, "push_to_ledger", new=AsyncMock()) as ledger:
        await svc.process_message("m-1", _released_event())
    assert sms.await_count == 2  # one attempt + one retry for the single send_sms grant
    payload = ledger.await_args.args[0][0].payload
    payload = json.loads(payload) if isinstance(payload, str) else payload
    assert payload["failed"][0]["mobile_e164"] == "+61400000001"


@pytest.mark.asyncio
async def test_replayed_release_sends_no_sms():
    svc = _service_with_mocks()
    svc.repository.apply_release = AsyncMock(return_value=False)  # replay
    with patch.object(svc_mod, "send_sms", new=AsyncMock()) as sms, \
         patch.object(svc_mod, "push_to_ledger", new=AsyncMock()) as ledger:
        await svc.process_message("m-1", _released_event())
    sms.assert_not_awaited()
    ledger.assert_not_awaited()


@pytest.mark.asyncio
async def test_revoked_dispatch():
    svc = _service_with_mocks()
    event = {
        "typ": "applicant_release.revoked.v1", "agt": "billie-crm", "usr": "staff-1",
        "conv": "applicant-release:rel-1", "cls": "cmd",
        "payload": json.dumps({"release_id": "rel-1", "revoked_by": "staff-1"}),
    }
    with patch.object(svc_mod, "push_to_ledger", new=AsyncMock()):
        await svc.process_message("m-2", event)
    svc.repository.revoke_release.assert_awaited_once_with("rel-1")


@pytest.mark.asyncio
async def test_gate_mode_set_applies_and_emits_changed_fact():
    svc = _service_with_mocks()
    event = {
        "typ": "applicant_release.gate_mode.set.v1", "agt": "billie-crm", "usr": "ops",
        "conv": "applicant-release:gate", "cls": "cmd",
        "payload": json.dumps({"mode": "gated", "set_by": "ops"}),
    }
    with patch.object(svc_mod, "push_to_ledger", new=AsyncMock()) as ledger:
        await svc.process_message("m-3", event)
    svc.repository.set_gate_mode.assert_awaited_once_with("gated")
    fact = ledger.await_args.args[0][0]
    assert fact.typ == "applicant_release.gate_mode.changed.v1"


@pytest.mark.asyncio
async def test_unknown_type_is_ignored():
    svc = _service_with_mocks()
    await svc.process_message("m-4", {"typ": "something.else.v1", "payload": "{}"})
    svc.repository.apply_release.assert_not_awaited()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/services/applicantRelease/test_service.py -v`
Expected: FAIL with import error.

- [ ] **Step 3: Implement the service**

```python
# backend/backend/src/services/applicantRelease/applicant_release_service.py
"""Applicant-release projection service.

Consumes CRM-originated applicant_release.* commands from
``inbox:applicantReleaseService`` (routed off chatLedger by the Broker),
maintains the grant store, sends invite SMS where consent allowed it, and
emits facts back onto chatLedger for the CRM's projections.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from backend.src.agents.baseAgent import BaseAgent
from backend.src.config import config
from backend.src.models.ledger import LedgerMessage
from backend.src.services.applicantRelease.dual_write import (
    build_applicant_release_repository,
)
from backend.src.services.applicantRelease.models import (
    GateModeSetPayload,
    ReleasedPayload,
    RevokedPayload,
    parse_event_payload,
)
from backend.src.services.applicantRelease.repository import (
    RedisApplicantReleaseRepository,
)
from backend.src.utils.ledgerUtils import push_to_ledger
from backend.src.utils.smsUtils import send_sms

logger = logging.getLogger(__name__)

_SMS_RETRY_DELAY_S = 1.0


def _invite_sms_body(expires_at: str) -> str:
    template = (config.get("capacity_gate_messages") or {}).get("invite_sms") or (
        "Billie: you're in! Your spot to apply is open until {expires}. "
        "Start here: https://chat.billie.loans"
    )
    try:
        expires = datetime.fromisoformat(expires_at).strftime("%-d %b %Y")
    except ValueError:
        expires = expires_at
    return template.format(expires=expires)


class ApplicantReleaseService(BaseAgent):
    """Projects applicant_release.* commands into the grant store."""

    def __init__(self, shared_data: dict = None):
        super().__init__(
            agent_name=config.get("service_applicantRelease", "applicantReleaseService"),
            inbox_name=config.get("inbox_applicantRelease", "inbox:applicantReleaseService"),
            shared_data=shared_data if shared_data is not None else {},
        )
        self.repository = None  # set on connect (needs the redis client)

    async def connect(self):  # pragma: no cover — exercised in integration
        await super().connect()
        self.repository = build_applicant_release_repository(
            RedisApplicantReleaseRepository(self.redis_client)
        )

    async def process_message(self, event_id: str, event_data: Dict[str, Any]):
        typ = event_data.get("typ", "")
        if typ == config.get(
            "msg_type_applicant_release_released", "applicant_release.released.v1"
        ):
            await self._handle_released(event_data)
        elif typ == config.get(
            "msg_type_applicant_release_revoked", "applicant_release.revoked.v1"
        ):
            await self._handle_revoked(event_data)
        elif typ == config.get(
            "msg_type_applicant_release_gate_mode_set", "applicant_release.gate_mode.set.v1"
        ):
            await self._handle_gate_mode_set(event_data)
        # anything else: not ours — ack and move on

    async def _handle_released(self, event_data: Dict[str, Any]) -> None:
        payload = ReleasedPayload.model_validate(parse_event_payload(event_data))
        applied = await self.repository.apply_release(payload)
        if not applied:
            logger.info("applicant_release.released replay ignored", extra={"release_id": payload.release_id})
            return
        if payload.send_invite_sms:
            await self._send_invites(payload)

    async def _send_invites(self, payload: ReleasedPayload) -> None:
        body = _invite_sms_body(payload.expires_at)
        sent: list[str] = []
        failed: list[dict] = []
        for grant in payload.grants:
            if not grant.send_sms:
                continue
            ok = await send_sms(grant.mobile_e164, body)
            if not ok:
                await asyncio.sleep(_SMS_RETRY_DELAY_S)
                ok = await send_sms(grant.mobile_e164, body)
            if ok:
                sent.append(grant.mobile_e164)
            else:
                failed.append({"mobile_e164": grant.mobile_e164, "reason": "send_failed"})
        await self._emit_fact(
            typ=config.get(
                "msg_type_applicant_release_invites_sent", "applicant_release.invites_sent.v1"
            ),
            conv=f"applicant-release:{payload.release_id}",
            usr=payload.released_by,
            payload={"release_id": payload.release_id, "sent": sent, "failed": failed},
        )

    async def _handle_revoked(self, event_data: Dict[str, Any]) -> None:
        payload = RevokedPayload.model_validate(parse_event_payload(event_data))
        removed = await self.repository.revoke_release(payload.release_id)
        logger.info(
            "applicant_release revoked",
            extra={"release_id": payload.release_id, "grants_removed": removed},
        )

    async def _handle_gate_mode_set(self, event_data: Dict[str, Any]) -> None:
        payload = GateModeSetPayload.model_validate(parse_event_payload(event_data))
        await self.repository.set_gate_mode(payload.mode)
        await self._emit_fact(
            typ=config.get(
                "msg_type_applicant_release_gate_mode_changed",
                "applicant_release.gate_mode.changed.v1",
            ),
            conv="applicant-release:gate",
            usr=payload.set_by,
            payload={
                "mode": payload.mode,
                "set_by": payload.set_by,
                "changed_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    async def _emit_fact(self, *, typ: str, conv: str, usr: str, payload: dict) -> None:
        await push_to_ledger(
            [
                LedgerMessage(
                    conv=conv,
                    agt=self.agent_name,
                    usr=usr,
                    seq=1,
                    cls="msg",
                    typ=typ,
                    payload=payload,
                )
            ]
        )
```

Before finalising: open `backend/backend/src/services/reapplicationBlock/reapplication_block_service.py` and confirm (a) the exact name of the redis client attribute set by `BaseAgent.connect()` (`self.redis_client` vs `self.redis`) and (b) whether `LedgerMessage.payload` expects a dict or a pre-serialised string in `push_to_ledger` — mirror whichever that service does, and adjust `_emit_fact` and the tests' payload decode accordingly.

- [ ] **Step 4: Register the process in `__main__.py`**

With the other service imports (~line 115):

```python
from backend.src.services.applicantRelease.applicant_release_service import (  # noqa: E402
    ApplicantReleaseService,
)
```

With the other runners (~line 506): `run_applicant_release_service = AgentRunner(ApplicantReleaseService, "Applicant Release Service")`

After the `enable_reapplicationBlockService` block (~line 710):

```python
    if config.get("enable_applicantReleaseService", True):
        specs.append(
            ProcessSpec(
                "applicantReleaseService",
                run_applicant_release_service,
                (shared_data,),
            )
        )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/unit/services/applicantRelease/test_service.py -v`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/backend/src/services/applicantRelease/applicant_release_service.py backend/backend/src/__main__.py backend/tests/unit/services/applicantRelease/test_service.py
git commit -m "feat(applicant-release): event consumer service with invite SMS and facts"
```

---

### Task 6: Gate decision function

**Files:**
- Create: `backend/backend/src/services/applicantRelease/gate.py`
- Test: `backend/tests/unit/services/applicantRelease/test_gate.py`

**Interfaces:**
- Consumes: repository (Tasks 3-4), `feature_flag` from `backend.src.config`, identity blind index (`backend.src.identity.blind_index.get_blind_indexer`, `backend.src.identity.signals.SignalType`, `backend.src.identity.builder.phone_signal`), `push_to_ledger`/`LedgerMessage`, `resolve_capacity_message`.
- Produces:
  - `@dataclass GateResult: outcome: GateOutcome; message: Optional[str] = None; release_id: Optional[str] = None`
  - `async evaluate_gate(mobile_e164: str, *, redis, conversation_id: str) -> GateResult`
  - `async gate_status(redis) -> str` — `"off" | "quota_open" | "invite_only"`
  - `async is_gate_enforced(redis) -> bool` — flag AND mode == gated
  - `normalise_mobile(raw: str) -> Optional[str]` — via `phone_signal(raw).value`
  - `async lookup_customer_by_mobile(mobile_e164: str, redis) -> Optional[str]` — canonical id or None

- [ ] **Step 1: Write the failing decision-matrix tests**

```python
# backend/tests/unit/services/applicantRelease/test_gate.py
import os

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_for_tests")

from unittest.mock import AsyncMock, patch  # noqa: E402

import pytest  # noqa: E402
from backend.src.services.applicantRelease import gate as gate_mod  # noqa: E402
from backend.src.services.applicantRelease.enums import GateOutcome  # noqa: E402


def _repo(*, grant=None, quota=None):
    repo = AsyncMock()
    repo.claim_grant = AsyncMock(return_value=grant)
    repo.claim_quota_slot = AsyncMock(return_value=quota)
    repo.has_open_quota = AsyncMock(return_value=quota is not None)
    repo.get_gate_mode = AsyncMock(return_value="gated")
    return repo


def _patches(repo, *, customer=None):
    return (
        patch.object(gate_mod, "_build_repository", return_value=repo),
        patch.object(gate_mod, "lookup_customer_by_mobile", new=AsyncMock(return_value=customer)),
        patch.object(gate_mod, "push_to_ledger", new=AsyncMock()),
        patch.object(gate_mod, "resolve_capacity_message", new=AsyncMock(return_value="copy")),
        patch.object(gate_mod, "feature_flag", return_value=True),
    )


async def _run(repo, *, customer=None):
    p = _patches(repo, customer=customer)
    with p[0], p[1], p[2] as ledger, p[3], p[4]:
        result = await gate_mod.evaluate_gate(
            "+61400000001", redis=AsyncMock(), conversation_id="conv-1"
        )
    return result, ledger


@pytest.mark.asyncio
async def test_existing_customer_bypasses():
    result, ledger = await _run(_repo(), customer="CANON001")
    assert result.outcome == GateOutcome.BYPASS_CUSTOMER
    ledger.assert_not_awaited()  # no claim fact for a bypass


@pytest.mark.asyncio
async def test_targeted_grant_enters_and_emits_claim_fact():
    repo = _repo(grant={"release_id": "rel-1", "source": "targeted", "already_claimed": False})
    result, ledger = await _run(repo)
    assert result.outcome == GateOutcome.ENTER_GRANT and result.release_id == "rel-1"
    fact = ledger.await_args.args[0][0]
    assert fact.typ == "applicant_release.grant_claimed.v1"


@pytest.mark.asyncio
async def test_reclaim_emits_no_second_fact():
    repo = _repo(grant={"release_id": "rel-1", "source": "targeted", "already_claimed": True})
    result, ledger = await _run(repo)
    assert result.outcome == GateOutcome.ENTER_GRANT
    ledger.assert_not_awaited()


@pytest.mark.asyncio
async def test_quota_claim_when_no_grant():
    repo = _repo(grant=None, quota={"release_id": "rel-q", "source": "quota", "already_claimed": False})
    result, ledger = await _run(repo)
    assert result.outcome == GateOutcome.ENTER_QUOTA
    assert ledger.await_args.args[0][0].typ == "applicant_release.grant_claimed.v1"


@pytest.mark.asyncio
async def test_no_grant_no_quota_denies_with_copy():
    result, _ = await _run(_repo(grant=None, quota=None))
    assert result.outcome == GateOutcome.DENY
    assert result.message == "copy"


@pytest.mark.asyncio
async def test_gate_status_matrix():
    repo = _repo()
    with patch.object(gate_mod, "_build_repository", return_value=repo):
        with patch.object(gate_mod, "feature_flag", return_value=False):
            assert await gate_mod.gate_status(AsyncMock()) == "off"
        with patch.object(gate_mod, "feature_flag", return_value=True):
            repo.get_gate_mode = AsyncMock(return_value="open")
            assert await gate_mod.gate_status(AsyncMock()) == "off"
            repo.get_gate_mode = AsyncMock(return_value="gated")
            repo.has_open_quota = AsyncMock(return_value=True)
            assert await gate_mod.gate_status(AsyncMock()) == "quota_open"
            repo.has_open_quota = AsyncMock(return_value=False)
            assert await gate_mod.gate_status(AsyncMock()) == "invite_only"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/services/applicantRelease/test_gate.py -v`
Expected: FAIL with import error.

- [ ] **Step 3: Implement gate.py**

```python
# backend/backend/src/services/applicantRelease/gate.py
"""Front-door gate decision for the applicant-release feature.

Order (spec §6): existing customer → targeted grant → open-quota claim → deny.
Grant status is only ever evaluated AFTER OTP possession-proof — callers must
not invoke evaluate_gate with an unverified mobile.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from backend.src.config import config, feature_flag
from backend.src.identity.blind_index import get_blind_indexer
from backend.src.identity.builder import phone_signal
from backend.src.identity.signals import SignalType
from backend.src.models.ledger import LedgerMessage
from backend.src.services.applicantRelease.dual_write import (
    build_applicant_release_repository,
)
from backend.src.services.applicantRelease.enums import GateOutcome
from backend.src.services.applicantRelease.messages import resolve_capacity_message
from backend.src.services.applicantRelease.repository import (
    RedisApplicantReleaseRepository,
)
from backend.src.utils.ledgerUtils import push_to_ledger

GATE_FLAG = "ENABLE_APPLICATION_GATE"


@dataclass
class GateResult:
    outcome: GateOutcome
    message: Optional[str] = None
    release_id: Optional[str] = None
    canonical_customer_id: Optional[str] = None


def normalise_mobile(raw: str) -> Optional[str]:
    """AU mobile → E.164, or None. Reuses the identity signal normaliser."""
    return phone_signal(raw).value


def _build_repository(redis):
    return build_applicant_release_repository(RedisApplicantReleaseRepository(redis))


async def lookup_customer_by_mobile(mobile_e164: str, redis) -> Optional[str]:
    """Mobile → canonical customer id via the identity blind index, else None."""
    indexer = get_blind_indexer()
    for key in indexer.candidate_keys(SignalType.PHONE, mobile_e164):
        subjects = await redis.smembers(key)
        for s in subjects or []:
            subject_id = s.decode() if isinstance(s, bytes) else s
            if subject_id:
                return subject_id
    return None


async def is_gate_enforced(redis) -> bool:
    if not feature_flag(GATE_FLAG):
        return False
    return await _build_repository(redis).get_gate_mode() == "gated"


async def gate_status(redis) -> str:
    """off | quota_open | invite_only — drives which frontend state leads."""
    if not await is_gate_enforced(redis):
        return "off"
    if await _build_repository(redis).has_open_quota():
        return "quota_open"
    return "invite_only"


async def evaluate_gate(mobile_e164: str, *, redis, conversation_id: str) -> GateResult:
    # 1. Existing customers bypass — releases control NEW applicant volume only.
    canonical = await lookup_customer_by_mobile(mobile_e164, redis)
    if canonical:
        return GateResult(GateOutcome.BYPASS_CUSTOMER, canonical_customer_id=canonical)

    repo = _build_repository(redis)

    # 2. Targeted grant (or re-entry on an already-claimed one).
    grant = await repo.claim_grant(mobile_e164)
    if grant:
        if not grant["already_claimed"]:
            await _emit_claim_fact(mobile_e164, grant, conversation_id)
        return GateResult(GateOutcome.ENTER_GRANT, release_id=grant["release_id"])

    # 3. Open quota walk-up.
    slot = await repo.claim_quota_slot(mobile_e164)
    if slot:
        await _emit_claim_fact(mobile_e164, slot, conversation_id)
        return GateResult(GateOutcome.ENTER_QUOTA, release_id=slot["release_id"])

    # 4. Deny — post-verification copy (their number simply isn't on a release).
    message = await resolve_capacity_message("not_on_release", redis)
    return GateResult(GateOutcome.DENY, message=message)


async def _emit_claim_fact(mobile_e164: str, claim: dict, conversation_id: str) -> None:
    from datetime import datetime, timezone

    await push_to_ledger(
        [
            LedgerMessage(
                conv=f"applicant-release:{claim['release_id']}",
                agt=config.get("service_applicantRelease", "applicantReleaseService"),
                usr=mobile_e164,
                seq=1,
                cls="msg",
                typ=config.get(
                    "msg_type_applicant_release_grant_claimed",
                    "applicant_release.grant_claimed.v1",
                ),
                payload={
                    "release_id": claim["release_id"],
                    "mobile_e164": mobile_e164,
                    "source": claim["source"],
                    "claimed_at": datetime.now(timezone.utc).isoformat(),
                    "conversation_id": conversation_id,
                },
            )
        ]
    )
```

(Apply the same `LedgerMessage.payload` dict-vs-string convention confirmed in Task 5.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/services/applicantRelease/test_gate.py -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/backend/src/services/applicantRelease/gate.py backend/tests/unit/services/applicantRelease/test_gate.py
git commit -m "feat(applicant-release): gate decision function with customer bypass and claim facts"
```

---

### Task 7: Gate CLI (the on/off configuration script)

**Files:**
- Create: `backend/backend/scripts/set_application_gate.py`
- Test: `backend/tests/unit/scripts/test_set_application_gate.py`

**Interfaces:**
- Consumes: `push_to_ledger`, `LedgerMessage`, repository (for `status`).
- Produces: CLI `python backend/scripts/set_application_gate.py {on|off|status}` (run from `backend/` with env pointing at the target environment's Redis — same operating posture as `check_reapplication_block_parity.py`). `on` → publishes `applicant_release.gate_mode.set.v1` with `mode="gated"`; `off` → `mode="open"`; `status` → prints current mode + enforcement. Note: the spec named this `gate_cli.py` under the service package; the repo's actual ops-script precedent is `backend/backend/scripts/`, so it lives there — same commands, same behaviour.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/scripts/test_set_application_gate.py
import json
import os

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_for_tests")

from unittest.mock import AsyncMock, patch  # noqa: E402

import pytest  # noqa: E402
from backend.scripts import set_application_gate as cli  # noqa: E402


@pytest.mark.asyncio
async def test_on_publishes_gated_mode():
    with patch.object(cli, "push_to_ledger", new=AsyncMock()) as ledger:
        await cli.set_mode("on", operator="rohan")
    msg = ledger.await_args.args[0][0]
    assert msg.typ == "applicant_release.gate_mode.set.v1"
    assert msg.cls == "cmd"
    payload = json.loads(msg.payload) if isinstance(msg.payload, str) else msg.payload
    assert payload["mode"] == "gated" and payload["set_by"] == "rohan"


@pytest.mark.asyncio
async def test_off_publishes_open_mode():
    with patch.object(cli, "push_to_ledger", new=AsyncMock()) as ledger:
        await cli.set_mode("off", operator="rohan")
    payload = ledger.await_args.args[0][0].payload
    payload = json.loads(payload) if isinstance(payload, str) else payload
    assert payload["mode"] == "open"


def test_unknown_command_rejected():
    with pytest.raises(SystemExit):
        cli.parse_args(["sideways"])
```

If `backend/tests/unit/scripts/` has no `__init__.py` and imports fail, mirror how `backend/tests/unit/scripts/` (or the nearest existing script test) imports its target — some script tests import via `importlib` from the file path; use that pattern instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/scripts/test_set_application_gate.py -v`
Expected: FAIL with import error.

- [ ] **Step 3: Implement the CLI**

```python
# backend/backend/scripts/set_application_gate.py
"""Ops switch for the applicant-release entry gate.

    python backend/scripts/set_application_gate.py on      # enforce the gate (mode=gated)
    python backend/scripts/set_application_gate.py off     # open door (mode=open) — the rolled-out end state
    python backend/scripts/set_application_gate.py status  # print mode + effective enforcement

Publishes applicant_release.gate_mode.set.v1 to chatLedger so the change is
audited and applied by applicantReleaseService (which emits the .changed fact
the CRM projects). Run with the target env's Redis config, same as the other
scripts in this directory.
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import logging
import os

from backend.src.config import config, feature_flag
from backend.src.models.ledger import LedgerMessage
from backend.src.services.applicantRelease.repository import (
    KEY_MODE,
    RedisApplicantReleaseRepository,
)
from backend.src.utils.ledgerUtils import push_to_ledger
from billie_shared.infra.redis_client import async_redis

_MODE_FOR_COMMAND = {"on": "gated", "off": "open"}


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["on", "off", "status"])
    parser.add_argument("--reason", default=None, help="optional audit note")
    return parser.parse_args(argv)


async def set_mode(command: str, *, operator: str, reason: str | None = None) -> None:
    mode = _MODE_FOR_COMMAND[command]
    await push_to_ledger(
        [
            LedgerMessage(
                conv="applicant-release:gate",
                agt=config.get("agent_billie-crm", "billie-crm"),
                usr=operator,
                seq=1,
                cls="cmd",
                typ=config.get(
                    "msg_type_applicant_release_gate_mode_set",
                    "applicant_release.gate_mode.set.v1",
                ),
                payload={"mode": mode, "set_by": operator, "reason": reason},
            )
        ]
    )
    print(f"gate_mode.set published: mode={mode} (applied by applicantReleaseService)")


async def show_status() -> None:
    redis = await async_redis()
    repo = RedisApplicantReleaseRepository(redis)
    mode = await repo.get_gate_mode()
    flag = feature_flag("ENABLE_APPLICATION_GATE")
    enforced = flag and mode == "gated"
    print(f"mode={mode}  ENABLE_APPLICATION_GATE={flag}  enforced={enforced}  key={KEY_MODE}")


async def _main() -> None:
    logging.basicConfig(level=logging.INFO)
    args = parse_args()
    operator = os.getenv("GATE_OPERATOR") or getpass.getuser()
    if args.command == "status":
        await show_status()
    else:
        await set_mode(args.command, operator=operator, reason=args.reason)


if __name__ == "__main__":
    asyncio.run(_main())
```

(Publish uses `agt=billie-crm` so the existing Task-1 routing rule — CRM sender, `applicant_release.` prefix — delivers it to the service; no extra route needed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/scripts/test_set_application_gate.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/backend/scripts/set_application_gate.py backend/tests/unit/scripts/test_set_application_gate.py
git commit -m "feat(applicant-release): ops CLI to switch gate mode via audited event"
```

---

### Task 8: Gate HTTP endpoints + /chat/init and WS enforcement

**Files:**
- Create: `backend/backend/src/routes/gate.py`
- Modify: `backend/backend/src/routes/chat.py` (gate check in `init_chat` + WS welcome backstop)
- Modify: wherever routers are registered (find with `rg -n "include_router" backend/backend/src` — add `gate.router` beside `chat.router`)
- Test: `backend/tests/unit/routes/test_gate_routes.py`, `backend/tests/unit/routes/test_chat_init_gate.py`

**Interfaces:**
- Consumes: `otp_service` singleton (`initiate_verification(conversation_id, channel, destination, application_number)`, `validate_otp`, `resend_otp`, `mark_verified`), `evaluate_gate`/`gate_status`/`is_gate_enforced`/`normalise_mobile` (Task 6), `validate_session_token` dependency, `rate_limit_by_ip`, `CLIENT_SESSION` constant.
- Produces:
  - `GET /gate/status` → `{"mode": "off"|"quota_open"|"invite_only"}`
  - `POST /gate/otp/initiate` `{mobile}` → `{"success", "masked_destination", "expires_in_seconds"}` | 400 `invalid_mobile`
  - `POST /gate/otp/verify` `{code}` → `{"result": "enter"}` | `{"result": "capacity", "message"}` | `{"valid": false, "attempts_remaining"}`
  - `POST /gate/otp/resend` → otp_service resend result
  - Session-hash fields stamped on entry: `gate_passed="true"`, `gate_mobile`, `gate_release_id` (empty for bypass), `gate_outcome`
  - `/chat/init` returns `{"status": "gate_required", "mode": ...}` when enforced and not passed
- OTP namespacing: the gate uses `conversation_id=f"gate:{session_id}"` for every otp_service call, and `channel="sms"`, `application_number="gate"`.

- [ ] **Step 1: Write the failing route tests**

```python
# backend/tests/unit/routes/test_gate_routes.py
import os

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_for_tests")

from unittest.mock import AsyncMock, patch  # noqa: E402

import pytest  # noqa: E402
from backend.src.routes import gate as gate_routes  # noqa: E402
from backend.src.services.applicantRelease.enums import GateOutcome  # noqa: E402
from backend.src.services.applicantRelease.gate import GateResult  # noqa: E402

TOKEN = {"session_id": "sid-1", "role": "anonymous"}


@pytest.mark.asyncio
async def test_initiate_rejects_invalid_mobile():
    with patch.object(gate_routes, "get_redis", new=AsyncMock()):
        with pytest.raises(Exception) as exc:
            await gate_routes.gate_otp_initiate(
                gate_routes.GateOtpInitiateBody(mobile="12345"), token=TOKEN
            )
        assert getattr(exc.value, "status_code", None) == 400


@pytest.mark.asyncio
async def test_initiate_normalises_and_calls_otp_service():
    otp = AsyncMock()
    otp.initiate_verification = AsyncMock(return_value={
        "success": True, "masked_destination": "04•• ••• 001",
        "expires_in_seconds": 300, "max_attempts": 3,
    })
    with patch.object(gate_routes, "otp_service", otp), \
         patch.object(gate_routes, "get_redis", new=AsyncMock()):
        result = await gate_routes.gate_otp_initiate(
            gate_routes.GateOtpInitiateBody(mobile="0400 000 001"), token=TOKEN
        )
    assert result["success"] is True
    kwargs = otp.initiate_verification.await_args.kwargs
    args = otp.initiate_verification.await_args.args
    called = kwargs or dict(zip(["conversation_id", "channel", "destination", "application_number"], args))
    assert called["conversation_id"] == "gate:sid-1"
    assert called["destination"] == "+61400000001"


@pytest.mark.asyncio
async def test_verify_enter_stamps_session():
    otp = AsyncMock()
    otp.validate_otp = AsyncMock(return_value={"valid": True})
    otp.get_verified_destination = AsyncMock(return_value="+61400000001")
    redis = AsyncMock()
    with patch.object(gate_routes, "otp_service", otp), \
         patch.object(gate_routes, "get_redis", new=AsyncMock(return_value=redis)), \
         patch.object(gate_routes, "evaluate_gate",
                      new=AsyncMock(return_value=GateResult(GateOutcome.ENTER_GRANT, release_id="rel-1"))):
        result = await gate_routes.gate_otp_verify(
            gate_routes.GateOtpVerifyBody(code="123456"), token=TOKEN
        )
    assert result == {"result": "enter"}
    mapping = redis.hset.await_args.kwargs["mapping"]
    assert mapping["gate_passed"] == "true"
    assert mapping["gate_mobile"] == "+61400000001"
    assert mapping["gate_release_id"] == "rel-1"


@pytest.mark.asyncio
async def test_verify_deny_returns_capacity_copy():
    otp = AsyncMock()
    otp.validate_otp = AsyncMock(return_value={"valid": True})
    otp.get_verified_destination = AsyncMock(return_value="+61400000002")
    with patch.object(gate_routes, "otp_service", otp), \
         patch.object(gate_routes, "get_redis", new=AsyncMock(return_value=AsyncMock())), \
         patch.object(gate_routes, "evaluate_gate",
                      new=AsyncMock(return_value=GateResult(GateOutcome.DENY, message="full up"))):
        result = await gate_routes.gate_otp_verify(
            gate_routes.GateOtpVerifyBody(code="123456"), token=TOKEN
        )
    assert result == {"result": "capacity", "message": "full up"}


@pytest.mark.asyncio
async def test_verify_invalid_code_passes_through():
    otp = AsyncMock()
    otp.validate_otp = AsyncMock(return_value={"valid": False, "attempts_remaining": 2})
    with patch.object(gate_routes, "otp_service", otp), \
         patch.object(gate_routes, "get_redis", new=AsyncMock(return_value=AsyncMock())):
        result = await gate_routes.gate_otp_verify(
            gate_routes.GateOtpVerifyBody(code="000000"), token=TOKEN
        )
    assert result["valid"] is False and result["attempts_remaining"] == 2
```

```python
# backend/tests/unit/routes/test_chat_init_gate.py
import os

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_for_tests")

from unittest.mock import AsyncMock, patch  # noqa: E402

import pytest  # noqa: E402
from backend.src.routes import chat as chat_routes  # noqa: E402


@pytest.mark.asyncio
async def test_init_returns_gate_required_when_enforced_and_not_passed():
    redis = AsyncMock()
    redis.hgetall = AsyncMock(return_value={})  # no gate_passed on the session
    with patch.object(chat_routes, "get_redis", new=AsyncMock(return_value=redis)), \
         patch.object(chat_routes, "is_gate_enforced", new=AsyncMock(return_value=True)), \
         patch.object(chat_routes, "gate_status", new=AsyncMock(return_value="invite_only")):
        result = await chat_routes.init_chat(token={"session_id": "sid-1", "role": "anonymous"})
    assert result == {"status": "gate_required", "mode": "invite_only"}


@pytest.mark.asyncio
async def test_init_proceeds_when_gate_passed():
    redis = AsyncMock()
    redis.hgetall = AsyncMock(return_value={"gate_passed": "true"})
    with patch.object(chat_routes, "get_redis", new=AsyncMock(return_value=redis)), \
         patch.object(chat_routes, "is_gate_enforced", new=AsyncMock(return_value=True)):
        # will proceed into the normal init path — patch the downstream call
        # that begins agent work so the test stays unit-scoped
        with patch.object(chat_routes, "add_application_details_to_queue", new=AsyncMock()):
            result = await chat_routes.init_chat(
                token={"session_id": "sid-1", "role": "anonymous"}
            )
    assert result.get("status") != "gate_required"
```

Adjust the second test's downstream patches to whatever `init_chat` actually calls between the gate check and its return in the current code (read `chat.py:88-300` while writing it) — the assertion that matters is `status != "gate_required"` when `gate_passed` is stamped.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/routes/test_gate_routes.py tests/unit/routes/test_chat_init_gate.py -v`
Expected: FAIL with import error.

- [ ] **Step 3: Implement `routes/gate.py`**

```python
# backend/backend/src/routes/gate.py
"""Front-door gate endpoints for the applicant-release feature.

The mobile is only trusted AFTER OTP verification — /verify re-reads the
destination from the OTP service, never from client input, so the gate cannot
be probed for which numbers are released (spec §7).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.src.services.applicantRelease.enums import GateOutcome
from backend.src.services.applicantRelease.gate import (
    evaluate_gate,
    gate_status,
    normalise_mobile,
)
from backend.src.services.auth_service import validate_session_token
from backend.src.services.otp_service import otp_service
from backend.src.utils.rate_limit import rate_limit_by_ip
from backend.src.utils.redisUtils import get_redis  # match chat.py's import for get_redis
from backend.src.routes.chat import CLIENT_SESSION

router = APIRouter(prefix="/gate", tags=["gate"])

_GATE_CHANNEL = "sms"
_GATE_APPLICATION = "gate"


class GateOtpInitiateBody(BaseModel):
    mobile: str


class GateOtpVerifyBody(BaseModel):
    code: str


def _gate_conv(token: dict) -> str:
    return f"gate:{token.get('session_id')}"


@router.get(
    "/status",
    dependencies=[Depends(rate_limit_by_ip(limit=60, window_seconds=60, key_prefix="gate_status"))],
)
async def gate_status_route(token: dict = Depends(validate_session_token)):
    r = await get_redis()
    return {"mode": await gate_status(r)}


@router.post(
    "/otp/initiate",
    dependencies=[Depends(rate_limit_by_ip(limit=10, window_seconds=60, key_prefix="gate_otp_init"))],
)
async def gate_otp_initiate(
    body: GateOtpInitiateBody, token: dict = Depends(validate_session_token)
):
    mobile = normalise_mobile(body.mobile)
    if not mobile:
        raise HTTPException(status_code=400, detail="invalid_mobile")
    return await otp_service.initiate_verification(
        conversation_id=_gate_conv(token),
        channel=_GATE_CHANNEL,
        destination=mobile,
        application_number=_GATE_APPLICATION,
    )


@router.post(
    "/otp/verify",
    dependencies=[Depends(rate_limit_by_ip(limit=20, window_seconds=60, key_prefix="gate_otp_verify"))],
)
async def gate_otp_verify(
    body: GateOtpVerifyBody, token: dict = Depends(validate_session_token)
):
    conv = _gate_conv(token)
    outcome = await otp_service.validate_otp(conv, _GATE_CHANNEL, body.code)
    if not outcome.get("valid"):
        return outcome  # {"valid": False, "reason", "attempts_remaining"}

    mobile = await otp_service.get_verified_destination(conv, _GATE_CHANNEL)
    if not mobile:
        raise HTTPException(status_code=409, detail="no_verified_destination")

    r = await get_redis()
    sid = token.get("session_id")
    result = await evaluate_gate(mobile, redis=r, conversation_id=conv)

    if result.outcome in (
        GateOutcome.BYPASS_CUSTOMER,
        GateOutcome.ENTER_GRANT,
        GateOutcome.ENTER_QUOTA,
    ):
        await r.hset(
            f"{CLIENT_SESSION}:{sid}",
            mapping={
                "gate_passed": "true",
                "gate_mobile": mobile,
                "gate_release_id": result.release_id or "",
                "gate_outcome": result.outcome.value,
            },
        )
        return {"result": "enter"}

    return {"result": "capacity", "message": result.message}


@router.post(
    "/otp/resend",
    dependencies=[Depends(rate_limit_by_ip(limit=5, window_seconds=60, key_prefix="gate_otp_resend"))],
)
async def gate_otp_resend(token: dict = Depends(validate_session_token)):
    return await otp_service.resend_otp(_gate_conv(token), _GATE_CHANNEL)
```

Before finalising: `rg -n "get_redis" backend/backend/src/routes/chat.py` and import from the same module chat.py uses. If validating the OTP does not persist the destination for `get_verified_destination`, call `await otp_service.mark_verified(conv, _GATE_CHANNEL)` right after a valid result and re-check — read `otp_service.py:260-500` to confirm which call stores the verified destination, and match it.

- [ ] **Step 4: Wire enforcement into `/chat/init` and the WS welcome branch**

In `chat.py`, import at top: `from backend.src.services.applicantRelease.gate import gate_status, is_gate_enforced`.

Inside `init_chat`, immediately after `sid`/`authenticated` are derived and the redis handle exists (before any agent work is queued), insert:

```python
    # Applicant-release front-door gate (spec §6): anonymous sessions must have
    # passed the mobile+OTP gate before any agents run. Flag off or mode=open
    # → zero behaviour change.
    if not authenticated:
        r = await get_redis()
        if await is_gate_enforced(r):
            session_hash = await r.hgetall(f"{CLIENT_SESSION}:{sid}")
            decoded = {
                (k.decode() if isinstance(k, bytes) else k): (
                    v.decode() if isinstance(v, bytes) else v
                )
                for k, v in (session_hash or {}).items()
            }
            if decoded.get("gate_passed") != "true":
                return {"status": "gate_required", "mode": await gate_status(r)}
```

In the WS handler's `elif s:` welcome branch (chat.py:472+), before sending the welcome message, add the backstop (mirrors the `blocked_stop_message` shape):

```python
            if await is_gate_enforced(r):
                sh = await r.hgetall(f"{CLIENT_SESSION}:{session_id}")
                sh = { (k.decode() if isinstance(k, bytes) else k): (v.decode() if isinstance(v, bytes) else v) for k, v in (sh or {}).items() }
                if sh.get("auth_mode") != "authenticated" and sh.get("gate_passed") != "true":
                    await websocket.close(code=4003)
                    return
```

Register the router: find where `chat.router` is included (`rg -n "include_router" backend/backend/src`) and add `app.include_router(gate_router)` with `from backend.src.routes.gate import router as gate_router`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/unit/routes/test_gate_routes.py tests/unit/routes/test_chat_init_gate.py -v`
Expected: PASS (7 tests). Then run the whole existing chat-route suite to catch regressions: `python -m pytest tests/unit/routes -v`.

- [ ] **Step 6: Commit**

```bash
git add backend/backend/src/routes/gate.py backend/backend/src/routes/chat.py backend/tests/unit/routes/test_gate_routes.py backend/tests/unit/routes/test_chat_init_gate.py
git commit -m "feat(applicant-release): gate endpoints and chat/init + WS enforcement"
```

---

### Task 9: Mid-flow OTP skip when the gate already verified the mobile

**Files:**
- Modify: `backend/backend/src/agents/customerLiaisonAgent/session/otp_coordinator.py`
- Test: `backend/tests/unit/agents/customerLiaisonAgent/test_otp_gate_skip.py` (place beside existing otp_coordinator tests — find them with `rg -l "otp_coordinator" backend/tests`)

**Interfaces:**
- Consumes: session hash field `gate_mobile` (Task 8), `otp_service.mark_verified`.
- Produces: in `_initiate_otp_verification`, when the destination equals the session's `gate_mobile`, skip sending a code — mark the contact verified immediately and proceed down the existing success path.

- [ ] **Step 1: Write the failing test**

Read the top of `otp_coordinator.py` first to get the coordinator's constructor and the exact name/signature of `_initiate_otp_verification` and its success continuation (`_handle_otp_success`). Then:

```python
# backend/tests/unit/agents/customerLiaisonAgent/test_otp_gate_skip.py
import os

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_for_tests")

from unittest.mock import AsyncMock, patch  # noqa: E402

import pytest  # noqa: E402
from backend.src.agents.customerLiaisonAgent.session import otp_coordinator as oc  # noqa: E402


@pytest.mark.asyncio
async def test_gate_verified_mobile_skips_otp_send():
    """If the gate already OTP-verified this exact mobile, don't re-challenge."""
    coordinator = oc.OtpCoordinator.__new__(oc.OtpCoordinator)
    # minimal attributes the method touches — mirror the existing tests' setup
    coordinator.redis = AsyncMock()
    coordinator.redis.hget = AsyncMock(return_value=b"+61400000001")
    with patch.object(oc, "otp_service") as otp:
        otp.initiate_verification = AsyncMock()
        otp.mark_verified = AsyncMock()
        with patch.object(
            coordinator, "_handle_otp_success", new=AsyncMock()
        ) as success:
            await coordinator._initiate_otp_verification(
                destination="+61400000001", channel="sms"
            )
    otp.initiate_verification.assert_not_awaited()
    success.assert_awaited_once()


@pytest.mark.asyncio
async def test_different_mobile_still_challenged():
    coordinator = oc.OtpCoordinator.__new__(oc.OtpCoordinator)
    coordinator.redis = AsyncMock()
    coordinator.redis.hget = AsyncMock(return_value=b"+61400009999")  # gate mobile differs
    with patch.object(oc, "otp_service") as otp:
        otp.initiate_verification = AsyncMock(return_value={"success": True})
        await coordinator._initiate_otp_verification(
            destination="+61400000001", channel="sms"
        )
    otp.initiate_verification.assert_awaited()
```

**This test is a template**: the coordinator's real method signature, attribute names (session id source, redis handle) and success continuation differ in detail — align the test to the real code (existing otp_coordinator tests show the working setup), preserving the two behaviours asserted here.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/customerLiaisonAgent/test_otp_gate_skip.py -v`
Expected: FAIL (skip logic absent — `initiate_verification` gets awaited in test 1).

- [ ] **Step 3: Implement the skip**

At the top of `_initiate_otp_verification` in `otp_coordinator.py` (adapting names to the real method):

```python
        # Front-door gate already proved possession of this exact number for
        # this session — don't challenge twice (spec §6). A different number
        # given mid-chat is still verified normally.
        if channel == "sms":
            gate_mobile = await self.redis.hget(
                f"client_session:{self.session_id}", "gate_mobile"
            )
            gate_mobile = (
                gate_mobile.decode() if isinstance(gate_mobile, bytes) else gate_mobile
            )
            if gate_mobile and gate_mobile == destination:
                await otp_service.mark_verified(
                    self.conversation_id, channel, destination=destination
                )
                await self._handle_otp_success(channel=channel, destination=destination)
                return
```

Use the module's existing `client_session` key constant/import if one exists, and the coordinator's real session/conversation attributes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/agents/customerLiaisonAgent/test_otp_gate_skip.py -v`
Expected: PASS. Also run the existing coordinator suite: `python -m pytest tests/unit/agents/customerLiaisonAgent -v`.

- [ ] **Step 5: Commit**

```bash
git add backend/backend/src/agents/customerLiaisonAgent/session/otp_coordinator.py backend/tests/unit/agents/customerLiaisonAgent/test_otp_gate_skip.py
git commit -m "feat(applicant-release): skip mid-flow OTP when gate already verified the mobile"
```

---

### Task 10: Frontend gate & capacity pages

**Files:**
- Modify: `frontend/src/lib/stores.ts`, `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/components/GatePage.svelte`
- Modify: `frontend/src/App.svelte`
- Verify: `cd frontend && pnpm check` (svelte-check + tsc — the frontend has NO test runner; this is the automated verification available)

**Interfaces:**
- Consumes: `GET /gate/status`, `POST /gate/otp/initiate|verify|resend` (Task 8), `/chat/init` `{"status": "gate_required", "mode"}` response.
- Produces: `gateMode` store (`'none' | 'quota_open' | 'invite_only'`), `initChatSession(): Promise<{ ok: boolean; gateMode?: 'quota_open' | 'invite_only' }>` (breaking change to its callers — update every call site in `App.svelte`), `GatePage` component with internal states `entry → code → capacity`, and a `gatePassed` callback that re-runs `setupChat(true)`.

- [ ] **Step 1: Extend the API client**

In `frontend/src/lib/api.ts`, change `initChatSession` (`api.ts:229`) to parse the gate response and add the three gate calls:

```ts
export interface InitChatResult {
  ok: boolean
  gateMode?: 'quota_open' | 'invite_only'
}

export async function initChatSession(): Promise<InitChatResult> {
  try {
    const jwt = await getJWT();
    if (!jwt) return { ok: false };

    const response = await fetch(`${API_BASE_URL}/chat/init`, {
      method: 'POST',
      headers: getHeaders()
    });

    if (response.status === 401) {
      const refreshed = await refreshJWT();
      if (refreshed) {
        const retryResponse = await fetch(`${API_BASE_URL}/chat/init`, {
          method: 'POST',
          headers: getHeaders()
        });
        if (retryResponse.status === 401) {
          clearLocalSession();
          sessionExpired.set(true);
          return { ok: false };
        }
        return parseInitResponse(retryResponse);
      }
      clearLocalSession();
      sessionExpired.set(true);
      return { ok: false };
    } else if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return parseInitResponse(response);
  } catch (error) {
    console.error('Error initializing chat session:', error);
    return { ok: false };
  }
}

async function parseInitResponse(response: Response): Promise<InitChatResult> {
  const body = await response.json().catch(() => null);
  if (body?.status === 'gate_required') {
    return { ok: false, gateMode: body.mode === 'quota_open' ? 'quota_open' : 'invite_only' };
  }
  return { ok: response.ok };
}

export async function gateOtpInitiate(mobile: string): Promise<{
  success: boolean; masked_destination?: string; expires_in_seconds?: number; error?: string;
}> {
  const res = await fetch(`${API_BASE_URL}/gate/otp/initiate`, {
    method: 'POST', headers: getHeaders(), body: JSON.stringify({ mobile })
  });
  if (res.status === 400) return { success: false, error: 'invalid_mobile' };
  if (!res.ok) return { success: false, error: `http_${res.status}` };
  return res.json();
}

export async function gateOtpVerify(code: string): Promise<{
  result?: 'enter' | 'capacity'; message?: string; valid?: boolean; attempts_remaining?: number;
}> {
  const res = await fetch(`${API_BASE_URL}/gate/otp/verify`, {
    method: 'POST', headers: getHeaders(), body: JSON.stringify({ code })
  });
  if (!res.ok) return { valid: false };
  return res.json();
}

export async function gateOtpResend(): Promise<{ success: boolean; retry_after_seconds?: number }> {
  const res = await fetch(`${API_BASE_URL}/gate/otp/resend`, {
    method: 'POST', headers: getHeaders()
  });
  if (!res.ok) return { success: false };
  return res.json();
}
```

`getHeaders()` already includes the JWT + JSON content type (match its existing usage in the file — if it doesn't set `Content-Type`, add `{ ...getHeaders(), 'Content-Type': 'application/json' }`).

In `frontend/src/lib/stores.ts`, next to `sessionExpired` (`stores.ts:92`):

```ts
/** 'none' = gate not active; otherwise which gate state leads (spec §6 frontend). */
export const gateMode = writable<'none' | 'quota_open' | 'invite_only'>('none');
```

- [ ] **Step 2: Build GatePage.svelte**

```svelte
<!-- frontend/src/lib/components/GatePage.svelte -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { gateOtpInitiate, gateOtpVerify, gateOtpResend } from '../api';

  /** 'quota_open' → mobile entry leads; 'invite_only' → capacity leads. */
  export let mode: 'quota_open' | 'invite_only';

  const dispatch = createEventDispatcher<{ passed: void }>();

  type View = 'entry' | 'code' | 'capacity';
  let view: View = mode === 'quota_open' ? 'entry' : 'capacity';
  let mobile = '';
  let code = '';
  let maskedDestination = '';
  let attemptsRemaining: number | null = null;
  let capacityMessage =
    "We're at capacity right now. We let new applications in batches so we can look after every customer properly.";
  let deniedAfterCheck = false;
  let busy = false;
  let errorText = '';

  async function requestCode() {
    if (busy) return;
    busy = true; errorText = '';
    const res = await gateOtpInitiate(mobile);
    busy = false;
    if (!res.success) {
      errorText = res.error === 'invalid_mobile'
        ? 'That doesn’t look like an Australian mobile — try 04xx xxx xxx.'
        : 'We couldn’t send the code just now. Please try again.';
      return;
    }
    maskedDestination = res.masked_destination ?? '';
    view = 'code';
  }

  async function verifyCode() {
    if (busy) return;
    busy = true; errorText = '';
    const res = await gateOtpVerify(code);
    busy = false;
    if (res.result === 'enter') { dispatch('passed'); return; }
    if (res.result === 'capacity') {
      if (res.message) capacityMessage = res.message;
      deniedAfterCheck = true;
      view = 'capacity';
      return;
    }
    attemptsRemaining = res.attempts_remaining ?? null;
    errorText = attemptsRemaining === 0
      ? 'Too many attempts — request a new code.'
      : 'That code didn’t match. Have another look and try again.';
  }

  async function resend() {
    const res = await gateOtpResend();
    errorText = res.success ? '' : 'Please wait a moment before resending.';
  }
</script>

<div class="gate-page">
  <div class="gate-card" role="region" aria-live="polite">
    {#if view === 'entry'}
      <div class="gate-icon" aria-hidden="true">👋</div>
      <h1 class="gate-title">Let's get you started</h1>
      <p class="gate-body">
        Pop in your mobile and we'll text you a quick code — it's how we hold your spot.
      </p>
      <div class="gate-zone">
        <input class="gate-input" type="tel" inputmode="tel" placeholder="04xx xxx xxx"
               bind:value={mobile} on:keydown={(e) => e.key === 'Enter' && requestCode()}
               aria-label="Mobile number" />
        <button class="gate-cta" on:click={requestCode} disabled={busy}>Text me the code</button>
        {#if errorText}<p class="gate-error" role="alert">{errorText}</p>{/if}
        <p class="gate-sub">Already borrowed with us before? Same door — your number gets you straight in.</p>
      </div>
    {:else if view === 'code'}
      <div class="gate-icon" aria-hidden="true">💬</div>
      <h1 class="gate-title">Check your phone</h1>
      <p class="gate-body">We texted a code to <b>{maskedDestination}</b>. It's good for 5 minutes.</p>
      <div class="gate-zone">
        <input class="gate-input gate-code" type="text" inputmode="numeric" autocomplete="one-time-code"
               maxlength="10" bind:value={code} on:keydown={(e) => e.key === 'Enter' && verifyCode()}
               aria-label="Verification code" />
        <button class="gate-cta" on:click={verifyCode} disabled={busy}>Verify</button>
        {#if errorText}<p class="gate-error" role="alert">{errorText}</p>{/if}
        <p class="gate-sub">
          Didn't get it? <button class="gate-link" on:click={resend}>Resend code</button>
          {#if attemptsRemaining !== null}&nbsp;· {attemptsRemaining} attempts left{/if}
        </p>
      </div>
    {:else}
      <div class="gate-icon" aria-hidden="true">🌱</div>
      <h1 class="gate-title">We're at capacity right now</h1>
      <p class="gate-body">{capacityMessage}</p>
      <div class="gate-zone">
        <a class="gate-cta gate-cta-coral" href="https://billie.loans">Join the waitlist at billie.loans</a>
        {#if !deniedAfterCheck}
          <p class="gate-sub">
            Got an invite text or borrowed with us before?
            <button class="gate-link" on:click={() => { view = 'entry'; }}>Enter your mobile</button>
            — we'll check your spot.
          </p>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .gate-page {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--billie-cream); padding: 1rem;
  }
  .gate-card {
    background: #fff; border-radius: 12px; padding: 1.5rem; max-width: 400px; width: 100%;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08); display: flex; flex-direction: column;
  }
  .gate-icon {
    width: 44px; height: 44px; border-radius: 50%; background: var(--billie-gold);
    display: flex; align-items: center; justify-content: center; font-size: 1.3rem;
    margin-bottom: 0.6rem;
  }
  .gate-title { font-family: var(--billie-font-title); font-size: 1.8rem; line-height: 1.1; margin: 0 0 0.4rem; }
  .gate-body { font-family: var(--billie-font-body); color: #555; margin: 0 0 1rem; min-height: 3.2em; }
  .gate-zone { display: flex; flex-direction: column; }
  .gate-input {
    border: 1.5px solid #ccc; border-radius: 8px; padding: 0.7rem; font-size: 1rem;
    font-family: var(--billie-font-body);
  }
  .gate-code { text-align: center; letter-spacing: 0.4em; }
  .gate-cta {
    display: block; text-align: center; background: var(--billie-primary); color: #fff;
    border: none; border-radius: 999px; padding: 0.75rem; font-size: 1rem; margin-top: 0.7rem;
    cursor: pointer; text-decoration: none; font-family: var(--billie-font-body);
  }
  .gate-cta:disabled { opacity: 0.6; cursor: default; }
  .gate-cta-coral { background: var(--billie-coral); }
  .gate-sub { font-size: 0.8rem; color: #888; text-align: center; margin: 0.7rem 0 0; }
  .gate-link { background: none; border: none; color: var(--billie-primary); text-decoration: underline; cursor: pointer; padding: 0; font-size: inherit; }
  .gate-error { color: #c0392b; font-size: 0.85rem; margin: 0.5rem 0 0; }
</style>
```

- [ ] **Step 3: Wire into App.svelte**

(a) Imports: `import GatePage from './lib/components/GatePage.svelte';` and add `gateMode` to the stores import.

(b) `setupChat` (App.svelte:854): it calls `initChatSession()` — update for the new return shape:

```ts
        const init = await initChatSession();
        if (init.gateMode) {
          gateMode.set(init.gateMode);
          isLoading = false;
          return;
        }
        if (!init.ok) { console.error("Failed to initialize chat session"); /* keep existing failure handling */ }
```

Search `App.svelte` for every `initChatSession()` call site (`:854` area plus any others) and apply the same shape change.

(c) Render the gate before the chat shell — at the top of the main markup (just inside `<main>`, before the existing `.app-container`):

```svelte
{#if $gateMode !== 'none'}
  <GatePage mode={$gateMode} on:passed={async () => { gateMode.set('none'); await setupChat(true); }} />
{:else}
  <!-- existing app-container markup unchanged -->
{/if}
```

- [ ] **Step 4: Verify**

Run: `cd frontend && pnpm check`
Expected: no new svelte-check or tsc errors (pre-existing warnings unchanged).

Manual smoke (documented, not automated — the frontend has no test runner): with the backend running locally, `ENABLE_APPLICATION_GATE=1` env and `python backend/scripts/set_application_gate.py on`, a fresh browser session must show the capacity page; after a targeted release event is injected (Task 11's script), entering that mobile + the OTP code (readable via `OTP_TEST_CAPTURE_ENABLED` test keys) must land in the chat.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/stores.ts frontend/src/lib/api.ts frontend/src/lib/components/GatePage.svelte frontend/src/App.svelte
git commit -m "feat(applicant-release): gate and capacity pages in the chat frontend"
```

---

### Task 11: End-to-end integration test (synthetic release → gate decisions)

**Files:**
- Test: `backend/tests/integration/test_applicant_release_flow.py`

**Interfaces:**
- Consumes: everything above. Uses the real-Redis `redis_mock` fixture; patches `push_to_ledger`, `send_sms`, and the identity lookup.

- [ ] **Step 1: Write the integration test**

```python
# backend/tests/integration/test_applicant_release_flow.py
"""Release event → grant store → gate decisions, end to end on real Redis."""
import json
import os
import uuid

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_for_tests")

from unittest.mock import AsyncMock, patch  # noqa: E402

import pytest  # noqa: E402
from backend.src.services.applicantRelease import applicant_release_service as svc_mod  # noqa: E402
from backend.src.services.applicantRelease import gate as gate_mod  # noqa: E402
from backend.src.services.applicantRelease.applicant_release_service import (  # noqa: E402
    ApplicantReleaseService,
)
from backend.src.services.applicantRelease.enums import GateOutcome  # noqa: E402
from backend.src.services.applicantRelease.repository import (  # noqa: E402
    RedisApplicantReleaseRepository,
)


def _mob() -> str:
    return "+614" + uuid.uuid4().hex[:8]


async def _consume(redis, event: dict) -> None:
    svc = ApplicantReleaseService.__new__(ApplicantReleaseService)
    svc.agent_name = "applicantReleaseService"
    svc.repository = RedisApplicantReleaseRepository(redis)
    await svc.process_message("m-1", event)


async def test_full_flow(redis_mock):
    rid = f"rel-{uuid.uuid4().hex[:8]}"
    invited, stranger = _mob(), _mob()

    released = {
        "typ": "applicant_release.released.v1", "agt": "billie-crm", "usr": "staff-1",
        "conv": f"applicant-release:{rid}", "cls": "cmd",
        "payload": json.dumps({
            "release_id": rid, "name": "IT wave", "type": "waitlist",
            "expires_at": "2099-01-01T00:00:00+00:00", "send_invite_sms": True,
            "grants": [{"mobile_e164": invited, "contact_id": "c-1", "send_sms": True}],
            "released_by": "staff-1",
        }),
    }

    with patch.object(svc_mod, "send_sms", new=AsyncMock(return_value=True)), \
         patch.object(svc_mod, "push_to_ledger", new=AsyncMock()):
        await _consume(redis_mock, released)

    with patch.object(gate_mod, "lookup_customer_by_mobile", new=AsyncMock(return_value=None)), \
         patch.object(gate_mod, "push_to_ledger", new=AsyncMock()) as ledger, \
         patch.object(gate_mod, "feature_flag", return_value=True):
        # invited mobile enters; claim fact emitted once across re-entries
        r1 = await gate_mod.evaluate_gate(invited, redis=redis_mock, conversation_id="c1")
        r2 = await gate_mod.evaluate_gate(invited, redis=redis_mock, conversation_id="c2")
        assert r1.outcome == GateOutcome.ENTER_GRANT
        assert r2.outcome == GateOutcome.ENTER_GRANT
        assert ledger.await_count == 1

        # a stranger is denied
        r3 = await gate_mod.evaluate_gate(stranger, redis=redis_mock, conversation_id="c3")
        assert r3.outcome == GateOutcome.DENY and r3.message

    # revoke kills re-entry
    revoked = {
        "typ": "applicant_release.revoked.v1", "agt": "billie-crm", "usr": "staff-1",
        "conv": f"applicant-release:{rid}", "cls": "cmd",
        "payload": json.dumps({"release_id": rid, "revoked_by": "staff-1"}),
    }
    with patch.object(svc_mod, "push_to_ledger", new=AsyncMock()):
        await _consume(redis_mock, revoked)
    with patch.object(gate_mod, "lookup_customer_by_mobile", new=AsyncMock(return_value=None)), \
         patch.object(gate_mod, "push_to_ledger", new=AsyncMock()), \
         patch.object(gate_mod, "feature_flag", return_value=True):
        r4 = await gate_mod.evaluate_gate(invited, redis=redis_mock, conversation_id="c4")
    assert r4.outcome == GateOutcome.DENY
```

- [ ] **Step 2: Run it**

Run: `python -m pytest tests/integration/test_applicant_release_flow.py -v`
Expected: PASS.

- [ ] **Step 3: Run the full new suite + ruff, then commit**

Run: `python -m pytest tests/unit/services/applicantRelease tests/unit/routes/test_gate_routes.py tests/unit/routes/test_chat_init_gate.py tests/unit/routing/test_applicant_release_routing.py tests/unit/scripts/test_set_application_gate.py tests/integration/test_applicant_release_flow.py -v` and `ruff check backend/backend/src/services/applicantRelease backend/backend/src/routes/gate.py backend/backend/scripts/set_application_gate.py` (if ruff is configured in this repo — check for `ruff` in `backend/pyproject.toml`; skip if absent).
Expected: all PASS.

```bash
git add backend/tests/integration/test_applicant_release_flow.py
git commit -m "test(applicant-release): end-to-end release → gate flow on real Redis"
```

---

## Self-review checklist (run after Task 11)

1. **Spec coverage:** released/revoked/gate_mode.set consumed (T5), grant store + quota atomicity (T3), shadow + store-mode (T4), gate decision incl. bypass + facts (T6), CLI (T7), HTTP gate + /chat/init + WS backstop (T8), OTP dedup (T9), frontend three states + billie.loans CTA (T10), replay safety and fact idempotence (T3/T6/T11).
2. **Not covered here (by design):** the CRM half — projections, Releases UI, publishers — lives in the companion plan `2026-08-02-applicant-release-crm.md`.
3. **Deviations from spec to honour repo reality:** CLI lives in `backend/backend/scripts/` (repo precedent) not `services/applicantRelease/gate_cli.py`; unit tests use AsyncMock/real-Redis fixture (repo convention) not fakeredis.
