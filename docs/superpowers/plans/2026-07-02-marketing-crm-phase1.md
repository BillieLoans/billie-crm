# Marketing CRM Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the marketing CRM: an event-sourced `marketingService` in billie-platform-services (Contact/Interaction/Consent, gRPC commands, self-consume projection), billieChat broker routes, and the billie-crm marketing module (projections, `marketing` role, intake endpoint with Redis fallback, marketing admin view, Sheet import).

**Architecture:** Strict event-first CQRS per platform convention: gRPC command handlers create and publish domain events (internal self-consume stream + chatLedger) and write **no state**; a self-consume consumer group derives the `marketing.*` Postgres projection. The CRM is intake gateway, command surface, and projection UI only; its Python event-processor projects `contact.*` events into read-only Payload collections. Spec: `docs/superpowers/specs/2026-07-02-marketing-crm-customer-lifecycle-design.md`.

**Tech Stack:** Python 3.12 (Pydantic v2, redis-py async, SQLAlchemy Core + asyncpg, Alembic, grpcio 50054, pytest + testcontainers), Payload CMS 3.45 / Next.js 15 (TypeScript, zod v4, React Query, vitest), Redis Streams.

## Global Constraints

- Repos: platform = `/Users/rohansharp/workspace/billie-platform-services` (branch `feat/marketing-service`, cut from clean `main`); billieChat = `/Users/rohansharp/workspace/billieChat` (branch `feat/marketing-event-routes`, from clean `main`); CRM = worktree `/Users/rohansharp/workspace/billie-crm/.claude/worktrees/feat+marketing-crm` on branch `feat/marketing-crm` (from `main`, spec+plan cherry-picked).
- Event names: `{domain}.{entity}.{action}.v{n}`. Envelope fields: `conv, agt, usr, seq, cls, typ, event_id, cause, payload` (payload = JSON string). Marketing publisher `agt` = `marketingService`.
- Internal self-consume stream: `marketingService:events:marketing`; consumer group `marketingService-projection-writers`. Marketing inbox: `inbox:marketing`.
- gRPC port **50054** (`MARKETING_GRPC_PORT`). Alembic: new revision `0008_marketing_schema`, `down_revision = "0007_collections_send_log"`.
- `marketing.*` schema NEVER holds financial fields. Contact→customer link is one-way (`customer_id` on contact only).
- Mobile normalisation: AU E.164 — result must match `^\+61\d{9}$`; emails lowercased+trimmed.
- CRM code style: Prettier — single quotes, no semicolons, trailing commas, 100 char width. Python: ruff-clean, match existing handler idioms.
- CRM worktree gotchas (from memory): run `pnpm install` in the worktree; event-processor pytest needs `PYTHONPATH=<worktree>/event-processor/src`.
- Platform tests: `asyncio_mode = auto`; Redis mocked with `unittest.mock.AsyncMock`; Postgres tests use testcontainers + `alembic upgrade head`.
- Commit after every task; message format `feat(marketing): …` / `test(marketing): …`.

---

### Task 0: Branches in all three repos

**Files:** none (git only)

**Interfaces:**
- Produces: the three working directories all later tasks run in (paths above).

- [ ] **Step 1: platform-services branch**

```bash
cd /Users/rohansharp/workspace/billie-platform-services
git status --short   # expect empty; STOP and report if dirty
git checkout main && git pull && git checkout -b feat/marketing-service
```

- [ ] **Step 2: billieChat branch**

```bash
cd /Users/rohansharp/workspace/billieChat
git status --short   # expect empty; STOP and report if dirty
git checkout main && git pull && git checkout -b feat/marketing-event-routes
```

- [ ] **Step 3: billie-crm worktree + branch, cherry-pick spec/plan**

```bash
cd /Users/rohansharp/workspace/billie-crm
git fetch origin
git worktree add .claude/worktrees/feat+marketing-crm -b feat/marketing-crm origin/main
cd .claude/worktrees/feat+marketing-crm
# spec commit + plan commit live on feat/reapplication-block-recognition
git cherry-pick 9278707
git log --all --oneline | grep "marketing CRM phase 1 plan" # cherry-pick that SHA too once committed
pnpm install
```

Expected: worktree exists, `docs/superpowers/specs/2026-07-02-marketing-crm-customer-lifecycle-design.md` present.

---

## Part A — billie-platform-services

### Task A1: `marketing` SDK package — skeleton, enums, envelope

**Files:**
- Create: `packages/marketing/pyproject.toml`, `packages/marketing/README.md`, `packages/marketing/CHANGELOG.md`
- Create: `packages/marketing/billie_marketing_events/{__init__.py,enums.py,exceptions.py,ledger_message.py}`
- Test: `packages/marketing/tests/test_enums.py`

**Interfaces:**
- Produces: `MarketingEventType` enum, `LedgerMessage`, exceptions — imported by parser (A2), service (A5+), CRM processor (C3).

- [ ] **Step 1: Write the failing test**

`packages/marketing/tests/test_enums.py`:

```python
from billie_marketing_events import MarketingEventType


def test_event_type_values():
    assert MarketingEventType.CONTACT_OBSERVED_V1.value == "contact.observed.v1"
    assert MarketingEventType.CONTACT_CONSENT_GRANTED_V1.value == "contact.consent.granted.v1"
    assert MarketingEventType.REFERRAL_ATTRIBUTED_V1.value == "referral.attributed.v1"


def test_all_types_are_versioned():
    assert all(t.value.endswith(".v1") for t in MarketingEventType)
```

- [ ] **Step 2: Run test to verify it fails**

Run from repo root: `python -m pytest packages/marketing/tests/test_enums.py -v`
Expected: FAIL (`ModuleNotFoundError: billie_marketing_events`)

- [ ] **Step 3: Create the package**

`packages/marketing/pyproject.toml` (mirror customers):

```toml
[build-system]
requires = ["setuptools>=68.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "billie-marketing-events"
version = "0.1.0"
description = "Event SDK for marketingService domain events"
readme = "README.md"
requires-python = ">=3.9"
dependencies = ["pydantic[email]>=2,<3"]

[project.optional-dependencies]
dev = ["pytest>=7.0", "pytest-cov>=4.0", "mypy>=1.0", "ruff>=0.1.0"]

[tool.setuptools.packages.find]
include = ["billie_marketing_events*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = "test_*.py"
```

`billie_marketing_events/enums.py`:

```python
"""Enums for marketing event types."""
from enum import Enum


class MarketingEventType(str, Enum):
    """Event type identifiers for marketing (contact facet) events."""

    CONTACT_OBSERVED_V1 = "contact.observed.v1"
    CONTACT_UPDATED_V1 = "contact.updated.v1"
    CONTACT_LINKED_V1 = "contact.linked.v1"
    CONTACT_UNLINKED_V1 = "contact.unlinked.v1"
    CONTACT_CONSENT_GRANTED_V1 = "contact.consent.granted.v1"
    CONTACT_CONSENT_WITHDRAWN_V1 = "contact.consent.withdrawn.v1"
    CONTACT_INTERACTION_LOGGED_V1 = "contact.interaction.logged.v1"
    CONTACT_STAGE_CHANGED_V1 = "contact.stage.changed.v1"
    CONTACT_ERASED_V1 = "contact.erased.v1"
    REFERRAL_ATTRIBUTED_V1 = "referral.attributed.v1"
    BATCH_CREATED_V1 = "batch.created.v1"
    CONTACT_BATCH_ASSIGNED_V1 = "contact.batch.assigned.v1"
    FEEDBACK_RECEIVED_V1 = "feedback.received.v1"
    FEEDBACK_STATUS_CHANGED_V1 = "feedback.status.changed.v1"
```

`billie_marketing_events/exceptions.py` — copy verbatim from `packages/customers/billie_customers_events/exceptions.py` (three exception classes `EventValidationError`, `UnsupportedEventTypeError`, `SchemaVersionMismatchError`).

`billie_marketing_events/ledger_message.py` — copy verbatim from `packages/customers/billie_customers_events/ledger_message.py` (the `LedgerMessage` envelope model shown in the pattern report; identical fields).

`billie_marketing_events/__init__.py` (grows in A2/A3):

```python
"""Billie Marketing Events SDK."""
__version__ = "0.1.0"

from .enums import MarketingEventType
from .exceptions import (
    EventValidationError,
    SchemaVersionMismatchError,
    UnsupportedEventTypeError,
)
from .ledger_message import LedgerMessage

__all__ = [
    "MarketingEventType",
    "EventValidationError",
    "SchemaVersionMismatchError",
    "UnsupportedEventTypeError",
    "LedgerMessage",
]
```

`README.md`: one paragraph ("Pydantic models + parser for marketing domain events; see enums.py for the catalogue"). `CHANGELOG.md`: `## 0.1.0 — initial release (Phase 1 marketing CRM)`.

- [ ] **Step 4: Install editable + run test**

```bash
pip install -e packages/marketing
python -m pytest packages/marketing/tests/test_enums.py -v
```

Expected: PASS. Also add the line `-e packages/marketing` to root `requirements.txt` next to the existing `-e packages/customers` line.

- [ ] **Step 5: Commit**

```bash
git add packages/marketing requirements.txt
git commit -m "feat(marketing): scaffold billie-marketing-events SDK package"
```

### Task A2: SDK event payload models

**Files:**
- Create: `packages/marketing/billie_marketing_events/models/__init__.py` and `models/{contact_observed_v1.py,contact_updated_v1.py,contact_linked_v1.py,contact_consent_v1.py,contact_interaction_v1.py,contact_stage_v1.py,contact_erased_v1.py,referral_v1.py,batch_v1.py,feedback_v1.py}`
- Modify: `packages/marketing/billie_marketing_events/__init__.py`
- Test: `packages/marketing/tests/test_models.py`

**Interfaces:**
- Produces (exact class names later tasks import): `ConsentCapture`, `ContactObservedV1`, `ContactUpdatedV1`, `ContactLinkedV1`, `ContactUnlinkedV1`, `ContactConsentGrantedV1`, `ContactConsentWithdrawnV1`, `ContactInteractionLoggedV1`, `ContactStageChangedV1`, `ContactErasedV1`, `ReferralAttributedV1`, `BatchCreatedV1`, `ContactBatchAssignedV1`, `FeedbackReceivedV1`, `FeedbackStatusChangedV1`.

- [ ] **Step 1: Write the failing test** — `packages/marketing/tests/test_models.py`:

```python
from billie_marketing_events import (
    ConsentCapture,
    ContactErasedV1,
    ContactInteractionLoggedV1,
    ContactLinkedV1,
    ContactObservedV1,
)


def test_contact_observed_minimal():
    e = ContactObservedV1(
        contact_id="c-1",
        mobile_e164="+61400000001",
        source="campus",
        observed_at="2026-07-02T00:00:00+00:00",
    )
    assert e.email is None
    assert e.platforms == []
    assert e.consent is None


def test_contact_observed_with_consent_roundtrip():
    e = ContactObservedV1(
        contact_id="c-1",
        email="a@b.co",
        mobile_e164="+61400000001",
        source="referral",
        referred_by_code="AB23CD",
        waitlist_joined_at="2026-07-02T00:00:00+00:00",
        consent=ConsentCapture(granted=True, channels=["sms"], method="waitlist_form"),
        observed_at="2026-07-02T00:00:00+00:00",
    )
    assert ContactObservedV1.model_validate(e.model_dump(mode="json")).consent.granted is True


def test_linked_and_erased_shapes():
    link = ContactLinkedV1(contact_id="c-1", customer_id="cust-9", match_basis="mobile",
                           linked_at="2026-07-02T00:00:00+00:00")
    assert link.match_basis == "mobile"
    erased = ContactErasedV1(contact_id="c-1", erased_at="2026-07-02T00:00:00+00:00", actor="admin-1")
    assert set(erased.model_dump()) == {"contact_id", "erased_at", "actor"}  # ids only, no PI


def test_interaction_defaults():
    i = ContactInteractionLoggedV1(
        interaction_id="i-1", contact_id="c-1", kind="note",
        occurred_at="2026-07-02T00:00:00+00:00", source_system="crm",
    )
    assert i.metadata == {}
```

- [ ] **Step 2: Run test to verify it fails**

`python -m pytest packages/marketing/tests/test_models.py -v` → FAIL (ImportError).

- [ ] **Step 3: Implement models** — all use `model_config = ConfigDict(extra="allow")`; timestamps are ISO-8601 strings typed `str` (matches SDK convention of `datetime`-or-string leniency — use `str` for simplicity). Shared shapes in `models/contact_observed_v1.py`:

```python
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class ConsentCapture(BaseModel):
    """Consent facts captured with a command (Spam Act basis)."""

    granted: bool = Field(...)
    channels: List[str] = Field(default_factory=list, description="e.g. ['sms','whatsapp','email']")
    method: str = Field(..., description="How consent was captured, e.g. 'waitlist_form'")
    model_config = ConfigDict(extra="allow")


class ContactObservedV1(BaseModel):
    """First sighting of a contact via intake or import."""

    contact_id: str
    first_name: Optional[str] = None
    email: Optional[str] = None
    mobile_e164: Optional[str] = None
    city: Optional[str] = None
    postcode: Optional[str] = None
    source: str = "other"
    utm: Dict[str, Any] = Field(default_factory=dict)
    platforms: List[str] = Field(default_factory=list)
    channel_preference: Optional[str] = None
    referral_code: Optional[str] = Field(None, description="This contact's own code")
    referred_by_code: Optional[str] = Field(None, description="Referrer's code from intake, if any")
    waitlist_joined_at: Optional[str] = None
    consent: Optional[ConsentCapture] = None
    observed_at: str
    actor: str = "intake"
    model_config = ConfigDict(extra="allow")
```

`models/contact_updated_v1.py`: `ContactUpdatedV1` — same optional identity/attribute fields as observed (`first_name,email,mobile_e164,city,postcode,channel_preference`) plus `contact_id: str`, `attributes: Dict[str, Any] = Field(default_factory=dict)`, `updated_at: str`, `actor: str`.

`models/contact_linked_v1.py`:

```python
from typing import Optional
from pydantic import BaseModel, ConfigDict


class ContactLinkedV1(BaseModel):
    contact_id: str
    customer_id: str
    match_basis: str  # "mobile" | "email"
    linked_at: str
    model_config = ConfigDict(extra="allow")


class ContactUnlinkedV1(BaseModel):
    contact_id: str
    customer_id: str
    reason: Optional[str] = None
    unlinked_at: str
    model_config = ConfigDict(extra="allow")
```

`models/contact_consent_v1.py`: `ContactConsentGrantedV1` and `ContactConsentWithdrawnV1`, both: `contact_id: str`, `purpose: str = "marketing"`, `channels: List[str] = Field(default_factory=list)`, `method: str`, `evidence: Optional[str] = None`, `occurred_at: str`, `actor: str`.

`models/contact_interaction_v1.py`: `ContactInteractionLoggedV1` — `interaction_id: str`, `contact_id: str`, `kind: str`, `channel: Optional[str] = None`, `direction: Optional[str] = None`, `subject: Optional[str] = None`, `body: Optional[str] = None`, `occurred_at: str`, `source_system: str`, `metadata: Dict[str, Any] = Field(default_factory=dict)`.

`models/contact_stage_v1.py`: `ContactStageChangedV1` — `contact_id: str`, `previous_stage: Optional[str] = None`, `stage: str`, `changed_at: str`.

`models/contact_erased_v1.py`: `ContactErasedV1` — `contact_id: str`, `erased_at: str`, `actor: str` and **no other fields** (ids only; use `ConfigDict(extra="allow")` still, but never populate PI).

`models/referral_v1.py`: `ReferralAttributedV1` — `referrer_contact_id: str`, `referee_contact_id: str`, `code: str`, `attributed_at: str`.

`models/batch_v1.py`: `BatchCreatedV1` — `batch_id: str, name: str, created_at: str, actor: str`; `ContactBatchAssignedV1` — `batch_id: str, contact_id: str, assigned_at: str, actor: str`.

`models/feedback_v1.py`: `FeedbackReceivedV1` — `feedback_id: str, contact_id: str, type: str, severity: Optional[str] = None, text: str, product_area: Optional[str] = None, received_at: str`; `FeedbackStatusChangedV1` — `feedback_id: str, status: str, changed_at: str, actor: str`.

`models/__init__.py` re-exports every class; top-level `__init__.py` adds them all to imports + `__all__` (mirror customers pattern).

- [ ] **Step 4: Run tests** — `python -m pytest packages/marketing/tests -v` → all PASS.

- [ ] **Step 5: Commit** — `git add packages/marketing && git commit -m "feat(marketing): SDK event payload models"`

### Task A3: SDK parsers (chatLedger + internal stream)

**Files:**
- Create: `packages/marketing/billie_marketing_events/parser.py`
- Modify: `packages/marketing/billie_marketing_events/__init__.py`
- Test: `packages/marketing/tests/test_parser.py`

**Interfaces:**
- Produces: `parse_marketing_message(data, expected_type=None) -> ParsedMarketingEvent` (attrs: `event_type, conversation_id, sequence, event_id, cause, payload` where payload is the typed model); `parse_internal_message(event_data: dict) -> InternalMessage` (attrs: `typ, payload, timestamp, correlation_id`); `PAYLOAD_MODEL_BY_TYPE: dict[str, type]`.

- [ ] **Step 1: Write the failing test** — `packages/marketing/tests/test_parser.py`:

```python
import json

import pytest

from billie_marketing_events import (
    ContactObservedV1,
    UnsupportedEventTypeError,
    parse_internal_message,
    parse_marketing_message,
)


def _envelope(typ: str, payload: dict) -> dict:
    return {"conv": "conv-1", "agt": "marketingService", "usr": "c-1", "seq": 1,
            "cls": "msg", "typ": typ, "event_id": "ev-1", "payload": json.dumps(payload)}


OBSERVED = {"contact_id": "c-1", "mobile_e164": "+61400000001", "source": "campus",
            "observed_at": "2026-07-02T00:00:00+00:00"}


def test_parse_marketing_message_typed_payload():
    parsed = parse_marketing_message(_envelope("contact.observed.v1", OBSERVED))
    assert parsed.event_type == "contact.observed.v1"
    assert parsed.conversation_id == "conv-1"
    assert isinstance(parsed.payload, ContactObservedV1)
    assert parsed.payload.mobile_e164 == "+61400000001"


def test_parse_marketing_message_rejects_unknown_type():
    with pytest.raises(UnsupportedEventTypeError):
        parse_marketing_message(_envelope("contact.exploded.v9", {}))


def test_parse_internal_message_bytes_and_unknown():
    fields = {b"typ": b"contact.observed.v1", b"payload": json.dumps(OBSERVED).encode(),
              b"timestamp": b"t", b"correlation_id": b"conv-1"}
    msg = parse_internal_message(fields)
    assert isinstance(msg.payload, ContactObservedV1)
    unknown = parse_internal_message({"typ": "x.y.v1", "payload": "{\"a\":1}"})
    assert unknown.payload == {"a": 1}
```

- [ ] **Step 2: Run test to verify it fails** — `python -m pytest packages/marketing/tests/test_parser.py -v` → FAIL (ImportError).

- [ ] **Step 3: Implement** — `parser.py`:

```python
"""Parsers for marketing events (chatLedger envelope + internal stream)."""
import json
from typing import Any, Optional

from .enums import MarketingEventType
from .exceptions import EventValidationError, UnsupportedEventTypeError
from .ledger_message import LedgerMessage
from .models import (
    BatchCreatedV1, ContactBatchAssignedV1, ContactConsentGrantedV1,
    ContactConsentWithdrawnV1, ContactErasedV1, ContactInteractionLoggedV1,
    ContactLinkedV1, ContactObservedV1, ContactStageChangedV1, ContactUnlinkedV1,
    ContactUpdatedV1, FeedbackReceivedV1, FeedbackStatusChangedV1, ReferralAttributedV1,
)

PAYLOAD_MODEL_BY_TYPE: dict[str, type] = {
    MarketingEventType.CONTACT_OBSERVED_V1.value: ContactObservedV1,
    MarketingEventType.CONTACT_UPDATED_V1.value: ContactUpdatedV1,
    MarketingEventType.CONTACT_LINKED_V1.value: ContactLinkedV1,
    MarketingEventType.CONTACT_UNLINKED_V1.value: ContactUnlinkedV1,
    MarketingEventType.CONTACT_CONSENT_GRANTED_V1.value: ContactConsentGrantedV1,
    MarketingEventType.CONTACT_CONSENT_WITHDRAWN_V1.value: ContactConsentWithdrawnV1,
    MarketingEventType.CONTACT_INTERACTION_LOGGED_V1.value: ContactInteractionLoggedV1,
    MarketingEventType.CONTACT_STAGE_CHANGED_V1.value: ContactStageChangedV1,
    MarketingEventType.CONTACT_ERASED_V1.value: ContactErasedV1,
    MarketingEventType.REFERRAL_ATTRIBUTED_V1.value: ReferralAttributedV1,
    MarketingEventType.BATCH_CREATED_V1.value: BatchCreatedV1,
    MarketingEventType.CONTACT_BATCH_ASSIGNED_V1.value: ContactBatchAssignedV1,
    MarketingEventType.FEEDBACK_RECEIVED_V1.value: FeedbackReceivedV1,
    MarketingEventType.FEEDBACK_STATUS_CHANGED_V1.value: FeedbackStatusChangedV1,
}


class ParsedMarketingEvent:
    """Envelope metadata + typed payload."""

    def __init__(self, event_type, payload, conversation_id="", sequence="", event_id="", cause=None):
        self.event_type = event_type
        self.payload = payload
        self.conversation_id = conversation_id
        self.sequence = sequence
        self.event_id = event_id
        self.cause = cause


class InternalMessage:
    """Lightweight wrapper for internal self-consume stream events."""

    def __init__(self, typ, payload, timestamp="", correlation_id=""):
        self.typ = typ
        self.payload = payload
        self.timestamp = timestamp
        self.correlation_id = correlation_id


def _decode_payload(payload_data: Any) -> dict:
    if isinstance(payload_data, str):
        try:
            return json.loads(payload_data)
        except json.JSONDecodeError as e:
            raise EventValidationError(f"Invalid JSON in payload: {e}")
    return payload_data or {}


def parse_marketing_message(data: Any, expected_type: Optional[MarketingEventType] = None) -> ParsedMarketingEvent:
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as e:
            raise EventValidationError(f"Invalid JSON: {e}")
    try:
        envelope = LedgerMessage.model_validate(data)
    except Exception as e:
        raise EventValidationError(f"Invalid ledger message envelope: {e}")
    if expected_type and envelope.typ != expected_type.value:
        raise EventValidationError(f"Expected type {expected_type.value}, got {envelope.typ}")
    model = PAYLOAD_MODEL_BY_TYPE.get(envelope.typ)
    if model is None:
        raise UnsupportedEventTypeError(f"Unsupported event type: {envelope.typ}")
    try:
        payload = model.model_validate(_decode_payload(envelope.payload))
    except EventValidationError:
        raise
    except Exception as e:
        raise EventValidationError(f"Invalid {model.__name__} payload: {e}")
    raw = data if isinstance(data, dict) else {}
    return ParsedMarketingEvent(
        event_type=envelope.typ, payload=payload, conversation_id=envelope.conv,
        sequence=str(envelope.seq), event_id=str(raw.get("event_id", "")), cause=envelope.cause,
    )


def parse_internal_message(event_data: dict) -> InternalMessage:
    normalized: dict[str, Any] = {}
    for key, value in event_data.items():
        if isinstance(key, bytes):
            key = key.decode("utf-8")
        if isinstance(value, bytes):
            value = value.decode("utf-8")
        normalized[key] = value
    event_type = normalized.get("typ", "")
    payload_dict = _decode_payload(normalized.get("payload", {}))
    model = PAYLOAD_MODEL_BY_TYPE.get(event_type)
    payload = model.model_validate(payload_dict) if (model and payload_dict) else payload_dict
    return InternalMessage(typ=event_type, payload=payload,
                           timestamp=normalized.get("timestamp", ""),
                           correlation_id=normalized.get("correlation_id", ""))
```

Add `parse_marketing_message`, `parse_internal_message`, `ParsedMarketingEvent`, `InternalMessage`, `PAYLOAD_MODEL_BY_TYPE` to `__init__.py` imports/`__all__`.

- [ ] **Step 4: Run tests** — `python -m pytest packages/marketing/tests -v` → all PASS.

- [ ] **Step 5: Commit** — `git add packages/marketing && git commit -m "feat(marketing): SDK parsers for chatLedger and internal streams"`

### Task A4: Alembic migration `0008_marketing_schema`

**Files:**
- Create: `migrations/versions/0008_marketing_schema.py`
- Test: covered by A5's testcontainer suite (which runs `alembic upgrade head`); syntax check here.

**Interfaces:**
- Produces: tables `marketing.contact`, `marketing.interaction` with exact columns below — consumed by repository (A5).

- [ ] **Step 1: Write the migration**

```python
"""Marketing schema: contact + interaction projections (Phase 1).

Revision ID: 0008_marketing_schema
Revises: 0007_collections_send_log
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0008_marketing_schema"
down_revision: Union[str, None] = "0007_collections_send_log"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS marketing")
    op.execute("""
        CREATE TABLE marketing.contact (
            contact_id          text PRIMARY KEY,
            first_name          text,
            email               text,
            mobile_e164         text,
            city                text,
            postcode            text,
            source              text NOT NULL DEFAULT 'other',
            utm                 jsonb NOT NULL DEFAULT '{}',
            platforms           jsonb NOT NULL DEFAULT '[]',
            channel_preference  text,
            referral_code       text UNIQUE,
            referred_by_contact_id text,
            waitlist_joined_at  timestamptz,
            waitlist_position   integer,
            batch_id            text,
            panel_member        boolean NOT NULL DEFAULT false,
            incentive           jsonb NOT NULL DEFAULT '{}',
            customer_id         text,
            link_basis          text,
            linked_at           timestamptz,
            derived_stage       text NOT NULL DEFAULT 'lead',
            loan_status         text,
            consent             jsonb NOT NULL DEFAULT '{}',
            attributes          jsonb NOT NULL DEFAULT '{}',
            erased              boolean NOT NULL DEFAULT false,
            observed_at         timestamptz NOT NULL,
            updated_at          timestamptz NOT NULL DEFAULT now(),
            last_event_id       text
        )
    """)
    op.execute("CREATE UNIQUE INDEX marketing_contact_mobile_idx ON marketing.contact (mobile_e164) WHERE mobile_e164 IS NOT NULL")
    op.execute("CREATE INDEX marketing_contact_email_idx ON marketing.contact (email)")
    op.execute("CREATE INDEX marketing_contact_customer_idx ON marketing.contact (customer_id)")
    op.execute("""
        CREATE TABLE marketing.interaction (
            interaction_id  text PRIMARY KEY,
            contact_id      text NOT NULL,
            occurred_at     timestamptz NOT NULL,
            kind            text NOT NULL,
            channel         text,
            direction       text,
            subject         text,
            body            text,
            source_system   text NOT NULL,
            metadata        jsonb NOT NULL DEFAULT '{}',
            created_at      timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX marketing_interaction_contact_idx ON marketing.interaction (contact_id, occurred_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS marketing.interaction")
    op.execute("DROP TABLE IF EXISTS marketing.contact")
    op.execute("DROP SCHEMA IF EXISTS marketing")
```

- [ ] **Step 2: Verify chain integrity**

Run: `python -c "from alembic.config import Config; from alembic.script import ScriptDirectory; s=ScriptDirectory.from_config(Config('alembic.ini')); print(s.get_current_head())"`
Expected: `0008_marketing_schema`

- [ ] **Step 3: Commit** — `git add migrations && git commit -m "feat(marketing): alembic migration for marketing.contact + marketing.interaction"`

### Task A5: `PostgresMarketingRepository`

**Files:**
- Create: `src/services/marketingService/__init__.py` (empty), `src/services/marketingService/postgres_repository.py`
- Test: `tests/marketingService/test_postgres_repository.py` (+ empty `tests/marketingService/__init__.py` if other test dirs have one — mirror `tests/collectionsService/`)

**Interfaces:**
- Produces (exact signatures used by A6/A7):
  - `build_marketing_repository(config) -> PostgresMarketingRepository`
  - `async find_contact_by_natural_key(mobile_e164: str | None, email: str | None) -> dict | None` (row mapping incl. `contact_id`, `erased`)
  - `async get_contact(contact_id: str) -> dict | None`
  - `async apply_contact_observed(event: ContactObservedV1, last_event_id: str) -> None` (upsert on mobile→email natural key)
  - `async apply_contact_updated(event: ContactUpdatedV1, last_event_id: str) -> None`
  - `async apply_consent(event, granted: bool, last_event_id: str) -> None`
  - `async apply_link(event: ContactLinkedV1 | ContactUnlinkedV1, linked: bool, last_event_id: str) -> None`
  - `async apply_stage(event: ContactStageChangedV1, last_event_id: str) -> None`
  - `async insert_interaction(event: ContactInteractionLoggedV1) -> None`
  - `async apply_erased(event: ContactErasedV1, last_event_id: str) -> None`
  - `async find_contacts_for_match(mobile_e164: str | None, email: str | None) -> list[dict]` (unlinked, unerased candidates for the matcher)

- [ ] **Step 1: Write the failing tests** — `tests/marketingService/test_postgres_repository.py`, mirroring `tests/test_customer_postgres_repository.py`'s testcontainer fixture verbatim (importorskips, module-scoped `pg_env` fixture booting `PostgresContainer("postgres:16-alpine")`, env vars, `alembic upgrade head` subprocess, `dispose_engine` between tests):

```python
import pytest

pytest.importorskip("sqlalchemy"); pytest.importorskip("asyncpg")
pytest.importorskip("alembic");    pytest.importorskip("testcontainers")

# ... pg_env fixture copied from tests/test_customer_postgres_repository.py ...

from billie_marketing_events import (
    ConsentCapture, ContactErasedV1, ContactInteractionLoggedV1,
    ContactLinkedV1, ContactObservedV1,
)
from src.services.marketingService.postgres_repository import (
    PostgresMarketingRepository, build_marketing_repository,
)

NOW = "2026-07-02T00:00:00+00:00"


def _observed(contact_id="c-1", mobile="+61400000001", email=None, **kw):
    return ContactObservedV1(contact_id=contact_id, mobile_e164=mobile, email=email,
                             source="campus", observed_at=NOW, **kw)


async def test_observed_upsert_dedupes_on_mobile(pg_env):
    repo = build_marketing_repository(None)
    await repo.apply_contact_observed(_observed(contact_id="c-1"), "ev-1")
    await repo.apply_contact_observed(_observed(contact_id="c-2", first_name="Jess"), "ev-2")
    row = await repo.find_contact_by_natural_key("+61400000001", None)
    assert row["contact_id"] == "c-1"          # second observe folded into first
    assert row["first_name"] == "Jess"         # but updated fields applied
    assert row["last_event_id"] == "ev-2"


async def test_consent_link_interaction_erase_roundtrip(pg_env):
    repo = build_marketing_repository(None)
    await repo.apply_contact_observed(_observed(contact_id="c-3", mobile="+61400000003",
                                                consent=ConsentCapture(granted=True, channels=["sms"], method="waitlist_form")), "ev-1")
    row = await repo.get_contact("c-3")
    assert row["consent"]["marketing"]["granted"] is True
    await repo.apply_link(ContactLinkedV1(contact_id="c-3", customer_id="cust-9",
                                          match_basis="mobile", linked_at=NOW), True, "ev-2")
    assert (await repo.get_contact("c-3"))["customer_id"] == "cust-9"
    await repo.insert_interaction(ContactInteractionLoggedV1(
        interaction_id="i-1", contact_id="c-3", kind="signup", occurred_at=NOW, source_system="crm"))
    await repo.apply_erased(ContactErasedV1(contact_id="c-3", erased_at=NOW, actor="admin"), "ev-3")
    row = await repo.get_contact("c-3")
    assert row["erased"] is True and row["mobile_e164"] is None and row["first_name"] is None
```

- [ ] **Step 2: Run to verify fail** — `python -m pytest tests/marketingService/test_postgres_repository.py -v` → FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement** — `postgres_repository.py` using SQLAlchemy Core + `get_engine` exactly like `customerService/postgres_repository.py`. Key mechanics:

```python
"""Postgres projection repository for the marketing facet (schema marketing.*)."""
import json
import logging
import uuid

from sqlalchemy import Boolean, Column, DateTime, Integer, MetaData, Table, Text, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert

from src.utils.postgres import get_engine

logger = logging.getLogger(__name__)

_metadata = MetaData(schema="marketing")

contact_table = Table(
    "contact", _metadata,
    Column("contact_id", Text, primary_key=True),
    Column("first_name", Text), Column("email", Text), Column("mobile_e164", Text),
    Column("city", Text), Column("postcode", Text),
    Column("source", Text, nullable=False), Column("utm", JSONB), Column("platforms", JSONB),
    Column("channel_preference", Text), Column("referral_code", Text),
    Column("referred_by_contact_id", Text),
    Column("waitlist_joined_at", DateTime(timezone=True)), Column("waitlist_position", Integer),
    Column("batch_id", Text), Column("panel_member", Boolean), Column("incentive", JSONB),
    Column("customer_id", Text), Column("link_basis", Text), Column("linked_at", DateTime(timezone=True)),
    Column("derived_stage", Text, nullable=False), Column("loan_status", Text),
    Column("consent", JSONB), Column("attributes", JSONB), Column("erased", Boolean),
    Column("observed_at", DateTime(timezone=True)), Column("updated_at", DateTime(timezone=True)),
    Column("last_event_id", Text),
)

interaction_table = Table(
    "interaction", _metadata,
    Column("interaction_id", Text, primary_key=True),
    Column("contact_id", Text, nullable=False),
    Column("occurred_at", DateTime(timezone=True), nullable=False),
    Column("kind", Text, nullable=False), Column("channel", Text), Column("direction", Text),
    Column("subject", Text), Column("body", Text),
    Column("source_system", Text, nullable=False), Column("metadata", JSONB),
)
```

Method sketches (implement fully):
- `apply_contact_observed`: `existing = await self.find_contact_by_natural_key(event.mobile_e164, event.email)`. If found → UPDATE that `contact_id` with non-None asserted fields, merged consent snapshot (`consent = {"marketing": {"granted": ..., "channels": ..., "method": ..., "at": event.observed_at}}` when `event.consent` present), `waitlist_joined_at = COALESCE(existing, new)`, `derived_stage = 'waitlist' if waitlist_joined_at else 'lead'`, `updated_at = now()`, `last_event_id`. If not found → `pg_insert(contact_table).values(...).on_conflict_do_update(index_elements=[contact_table.c.mobile_e164], set_={...})` guarding the concurrent-observe race (converges on the first row). `referral_code` inserted, never updated on conflict.
- `apply_contact_updated`: UPDATE only fields that are non-None on the event; merge `attributes` via `contact_table.c.attributes.op("||")(event.attributes)` when non-empty.
- `apply_consent(event, granted, ...)`: overwrite `consent["marketing"]` snapshot with `{"granted": granted, "channels": event.channels, "method": event.method, "at": event.occurred_at}` (JSONB `||` merge on the `marketing` key).
- `apply_link(event, linked, ...)`: linked → set `customer_id, link_basis, linked_at`; unlinked → NULL all three.
- `apply_stage`: set `derived_stage`.
- `insert_interaction`: `pg_insert(interaction_table).values(...).on_conflict_do_nothing(index_elements=[interaction_table.c.interaction_id])` (idempotent replays).
- `apply_erased`: UPDATE nulling `first_name,email,mobile_e164,city,postcode,utm→'{}',attributes→'{}'`, set `erased=true`; plus `UPDATE marketing.interaction SET subject=NULL, body=NULL, metadata='{}' WHERE contact_id=:cid` via `text()`.
- `find_contact_by_natural_key`: mobile first (`WHERE mobile_e164 = :m AND NOT erased`), then email (lowercased). `.mappings().first()`, return `dict` or `None`.
- `find_contacts_for_match`: same but `customer_id IS NULL`, returns list.
- `build_marketing_repository(config)`: return `PostgresMarketingRepository(config)` (pure factory per M6 pattern).

- [ ] **Step 4: Run tests** — `python -m pytest tests/marketingService/test_postgres_repository.py -v` → PASS (needs Docker).

- [ ] **Step 5: Commit** — `git add src/services/marketingService tests/marketingService && git commit -m "feat(marketing): postgres projection repository"`

### Task A6: Commands module — normalisation, event builders, stage derivation

**Files:**
- Create: `src/services/marketingService/commands.py`
- Test: `tests/marketingService/test_commands.py`

**Interfaces:**
- Produces:
  - `normalise_mobile(raw: str | None) -> str | None` (AU E.164 or None)
  - `normalise_email(raw: str | None) -> str | None`
  - `mint_referral_code() -> str` (6 chars from `ABCDEFGHJKMNPQRSTVWXYZ23456789`)
  - `derive_stage(*, waitlist_joined_at, b_star=None, c_history=None, live=False, batch_invited=False) -> str` (full spec §4 precedence; phase 1 inputs only ever produce `lead`/`waitlist`)
  - `build_contact_observed(cmd: dict, existing: dict | None) -> ContactObservedV1` (reuses existing `contact_id`/`referral_code` when present; else mints)
  - `now_iso() -> str`

- [ ] **Step 1: Write the failing tests** — `tests/marketingService/test_commands.py`:

```python
from src.services.marketingService.commands import (
    build_contact_observed, derive_stage, mint_referral_code,
    normalise_email, normalise_mobile,
)


def test_normalise_mobile_variants():
    assert normalise_mobile("0400 000 001") == "+61400000001"
    assert normalise_mobile("61400000001") == "+61400000001"
    assert normalise_mobile("+61 400-000-001") == "+61400000001"
    assert normalise_mobile("12345") is None
    assert normalise_mobile(None) is None


def test_normalise_email():
    assert normalise_email("  Jess@Example.COM ") == "jess@example.com"
    assert normalise_email("") is None


def test_mint_referral_code_alphabet():
    code = mint_referral_code()
    assert len(code) == 6
    assert set(code) <= set("ABCDEFGHJKMNPQRSTVWXYZ23456789")


def test_derive_stage_precedence():
    assert derive_stage(waitlist_joined_at=None) == "lead"
    assert derive_stage(waitlist_joined_at="2026-07-02") == "waitlist"
    assert derive_stage(waitlist_joined_at="2026-07-02", live=True) == "customer"
    assert derive_stage(waitlist_joined_at=None, b_star="B0") == "applicant"
    assert derive_stage(waitlist_joined_at=None, c_history="C-P") == "former_customer"


def test_build_contact_observed_reuses_existing_identity():
    existing = {"contact_id": "c-1", "referral_code": "AB23CD"}
    e = build_contact_observed({"mobile": "0400000001", "source": "campus", "waitlist": True}, existing)
    assert e.contact_id == "c-1" and e.referral_code == "AB23CD"
    assert e.mobile_e164 == "+61400000001"
    assert e.waitlist_joined_at is not None
    fresh = build_contact_observed({"email": "A@B.co", "source": "meta"}, None)
    assert fresh.contact_id != "c-1" and len(fresh.referral_code) == 6
    assert fresh.email == "a@b.co"
```

- [ ] **Step 2: Run to verify fail** → ModuleNotFoundError.

- [ ] **Step 3: Implement** — `commands.py`:

```python
"""Command → event construction for marketingService (no state writes here)."""
import re
import secrets
import uuid
from datetime import datetime, timezone

from billie_marketing_events import ConsentCapture, ContactObservedV1

_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
_AU_MOBILE = re.compile(r"^\+61\d{9}$")

# Spec §4: ordered precedence, first match wins.
def derive_stage(*, waitlist_joined_at, b_star=None, c_history=None, live=False, batch_invited=False):
    if live or b_star == "B3":
        return "customer"
    if b_star in ("B0", "B1"):
        return "applicant"
    if c_history and c_history != "C0":
        return "former_customer"
    if batch_invited:
        return "invited"
    if waitlist_joined_at:
        return "waitlist"
    return "lead"


def normalise_mobile(raw):
    if not raw:
        return None
    digits = re.sub(r"[^\d+]", "", str(raw))
    if digits.startswith("+"):
        candidate = digits
    elif digits.startswith("61"):
        candidate = f"+{digits}"
    elif digits.startswith("0") and len(digits) == 10:
        candidate = f"+61{digits[1:]}"
    else:
        return None
    return candidate if _AU_MOBILE.match(candidate) else None


def normalise_email(raw):
    if not raw or not str(raw).strip():
        return None
    return str(raw).strip().lower()


def mint_referral_code():
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def build_contact_observed(cmd: dict, existing: dict | None) -> ContactObservedV1:
    consent = None
    if cmd.get("consent") is not None:
        c = cmd["consent"]
        consent = ConsentCapture(granted=bool(c.get("granted")),
                                 channels=list(c.get("channels") or []),
                                 method=str(c.get("method") or "unknown"))
    waitlist_at = now_iso() if cmd.get("waitlist") else None
    if existing and existing.get("waitlist_joined_at"):
        waitlist_at = str(existing["waitlist_joined_at"])
    return ContactObservedV1(
        contact_id=(existing or {}).get("contact_id") or str(uuid.uuid4()),
        first_name=cmd.get("first_name"),
        email=normalise_email(cmd.get("email")),
        mobile_e164=normalise_mobile(cmd.get("mobile")),
        city=cmd.get("city"), postcode=cmd.get("postcode"),
        source=cmd.get("source") or "other",
        utm=dict(cmd.get("utm") or {}), platforms=list(cmd.get("platforms") or []),
        channel_preference=cmd.get("channel_preference"),
        referral_code=(existing or {}).get("referral_code") or mint_referral_code(),
        referred_by_code=cmd.get("referred_by_code"),
        waitlist_joined_at=waitlist_at,
        consent=consent, observed_at=now_iso(), actor=cmd.get("actor") or "intake",
    )
```

- [ ] **Step 4: Run tests** → PASS. Run `ruff check src/services/marketingService packages/marketing` → clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(marketing): command normalisation and event builders"`

### Task A7: EventHandlers — emit path + self-consume projection writer

**Files:**
- Create: `src/services/marketingService/event_handlers.py`
- Test: `tests/marketingService/test_event_handlers.py`

**Interfaces:**
- Consumes: repository methods (A5), `parse_internal_message` (A3).
- Produces:
  - `MARKETING_EVENT_STREAM = "marketingService:events:marketing"`
  - `class EventHandlers: __init__(self, repository, config, agent_name="marketingService")`
  - `async emit(self, event_type: str, payload_model, *, correlation_id="", cause_event_id=None, customer_id=None) -> str` — XADDs `{typ, payload(json), timestamp, correlation_id}` to `MARKETING_EVENT_STREAM` **and** calls `self.chatledger.publish_event(...)`; returns internal event id. **Writes no state.**
  - `async handle_marketing_event(self, event_data: dict) -> bool` — the single self-consume handler: parses via `parse_internal_message`, applies a Redis `setex` idempotency fence (`marketingService:idempotency:{typ}:{contact_id}:{timestamp}`, 7-day TTL), dispatches on `typ` to the matching repository `apply_*`/`insert_*` method, and emits `contact.stage.changed.v1` when a recomputed stage differs (observed/consent events only in Phase 1).

- [ ] **Step 1: Write the failing tests** — mock Redis with `AsyncMock` exactly like `tests/test_customer_self_consumption.py` (patch `src.services.marketingService.event_handlers.redis_utils` and a `FakeRepo` with recorded calls):

```python
import json
from unittest.mock import AsyncMock, patch

from billie_marketing_events import MarketingEventType
from src.services.marketingService.event_handlers import MARKETING_EVENT_STREAM, EventHandlers

OBSERVED = {"contact_id": "c-1", "mobile_e164": "+61400000001", "source": "campus",
            "observed_at": "2026-07-02T00:00:00+00:00"}


class FakeRepo:
    def __init__(self):
        self.calls = []
    async def apply_contact_observed(self, event, last_event_id):
        self.calls.append(("observed", event.contact_id, last_event_id))
    async def get_contact(self, contact_id):
        return {"contact_id": contact_id, "derived_stage": "lead", "waitlist_joined_at": None,
                "customer_id": None}


async def test_emit_writes_internal_stream_and_chatledger_but_no_state():
    repo = FakeRepo()
    with patch("src.services.marketingService.event_handlers.redis_utils") as mock_ru:
        mock_redis = AsyncMock(); mock_redis.xadd.return_value = b"1-1"
        mock_ru.async_redis = AsyncMock(return_value=mock_redis)
        handlers = EventHandlers(repository=repo, config={})
        handlers.chatledger = AsyncMock()
        eid = await handlers.emit(MarketingEventType.CONTACT_OBSERVED_V1.value, _model(OBSERVED))
        assert eid == "1-1"
        stream_arg = mock_redis.xadd.call_args[0][0]
        assert stream_arg == MARKETING_EVENT_STREAM
        handlers.chatledger.publish_event.assert_awaited_once()
        assert repo.calls == []          # strict event-first: emit writes no state


async def test_self_consume_applies_projection_with_idempotency():
    repo = FakeRepo()
    with patch("src.services.marketingService.event_handlers.redis_utils") as mock_ru:
        mock_redis = AsyncMock(); mock_redis.get.return_value = None
        mock_ru.async_redis = AsyncMock(return_value=mock_redis)
        handlers = EventHandlers(repository=repo, config={})
        handlers.chatledger = AsyncMock()
        fields = {"typ": "contact.observed.v1", "payload": json.dumps(OBSERVED),
                  "timestamp": "t1", "correlation_id": "conv-1"}
        assert await handlers.handle_marketing_event(fields) is True
        assert repo.calls and repo.calls[0][0] == "observed"
        mock_redis.setex.assert_awaited()        # fence recorded
        mock_redis.get.return_value = "1"        # replay
        repo.calls.clear()
        assert await handlers.handle_marketing_event(fields) is True
        assert repo.calls == []                  # skipped


def _model(d):
    from billie_marketing_events import ContactObservedV1
    return ContactObservedV1.model_validate(d)
```

- [ ] **Step 2: Run to verify fail** → ModuleNotFoundError.

- [ ] **Step 3: Implement** — `event_handlers.py` mirroring `customerService/event_handlers.py`: `ChatLedgerPublisher("marketingService")` in `__init__`; `emit` builds `{"typ": event_type, "payload": payload_model.model_dump_json(), "timestamp": now_iso(), "correlation_id": correlation_id}` → `xadd(MARKETING_EVENT_STREAM, message)` then `chatledger.publish_event(event_type=..., payload=json.loads(payload_model.model_dump_json()), conversation_id=correlation_id, cause_event_id=cause_event_id, customer_id=customer_id)`. `handle_marketing_event` dispatch table:

```python
# inside handle_marketing_event, after parse_internal_message + idempotency fence
t = MarketingEventType
if msg.typ == t.CONTACT_OBSERVED_V1.value:
    await self.repository.apply_contact_observed(msg.payload, last_event_id)
    await self._maybe_emit_stage_change(msg.payload.contact_id)
elif msg.typ == t.CONTACT_UPDATED_V1.value:
    await self.repository.apply_contact_updated(msg.payload, last_event_id)
elif msg.typ == t.CONTACT_CONSENT_GRANTED_V1.value:
    await self.repository.apply_consent(msg.payload, True, last_event_id)
elif msg.typ == t.CONTACT_CONSENT_WITHDRAWN_V1.value:
    await self.repository.apply_consent(msg.payload, False, last_event_id)
elif msg.typ == t.CONTACT_LINKED_V1.value:
    await self.repository.apply_link(msg.payload, True, last_event_id)
elif msg.typ == t.CONTACT_UNLINKED_V1.value:
    await self.repository.apply_link(msg.payload, False, last_event_id)
elif msg.typ == t.CONTACT_STAGE_CHANGED_V1.value:
    await self.repository.apply_stage(msg.payload, last_event_id)
elif msg.typ == t.CONTACT_INTERACTION_LOGGED_V1.value:
    await self.repository.insert_interaction(msg.payload)
elif msg.typ == t.CONTACT_ERASED_V1.value:
    await self.repository.apply_erased(msg.payload, last_event_id)
else:
    logger.warning("marketingService: unhandled internal event type %s", msg.typ)
return True
```

`_maybe_emit_stage_change(contact_id)`: `row = await self.repository.get_contact(contact_id)`; `new = derive_stage(waitlist_joined_at=row["waitlist_joined_at"])`; if `new != row["derived_stage"]` → `await self.emit(t.CONTACT_STAGE_CHANGED_V1.value, ContactStageChangedV1(contact_id=contact_id, previous_stage=row["derived_stage"], stage=new, changed_at=now_iso()))`. `last_event_id` = the internal `timestamp` field's event id — use `event_data` stream id when available; pass `msg.timestamp or ""`.

- [ ] **Step 4: Run tests** → `python -m pytest tests/marketingService/test_event_handlers.py -v` PASS.

- [ ] **Step 5: Commit** — `git add -A src/services/marketingService tests/marketingService && git commit -m "feat(marketing): event-first emit path + self-consume projection writer"`

### Task A8: MarketingService (BaseService subclass) + matcher

**Files:**
- Create: `src/services/marketingService/marketingService.py`, `src/services/marketingService/matcher.py`
- Test: `tests/marketingService/test_marketing_service.py`, `tests/marketingService/test_matcher.py`

**Interfaces:**
- Consumes: `EventHandlers` (A7), repository (A5), `build_contact_observed` (A6).
- Produces:
  - `SELF_CONSUME_STREAMS` dict (stream → `{group: "marketingService-projection-writers", handler: "handle_marketing_event", description}`)
  - `class MarketingService(BaseService)` — `__init__(shared_data)` reads `config.get("agent_marketingService")`/`config.get("inbox_marketingService")`; `process_message(event_id, event_data)` routes inbox events; self-consume lifecycle methods copied from customerService (`_initialize_self_consume_groups`, `_self_consume_stream`, `start_self_consumption`, `stop_self_consumption`).
  - `matcher.match_customer_changed(payload: dict, repository) -> list[tuple[str, str, str]]` — returns `[(contact_id, customer_id, basis)]` links to emit.

- [ ] **Step 1: Write the failing tests**

`tests/marketingService/test_matcher.py`:

```python
from src.services.marketingService.matcher import match_customer_changed


class FakeRepo:
    def __init__(self, rows):
        self.rows = rows
    async def find_contacts_for_match(self, mobile, email):
        return [r for r in self.rows
                if (mobile and r.get("mobile_e164") == mobile)
                or (email and r.get("email") == email)]


async def test_mobile_match_links():
    repo = FakeRepo([{"contact_id": "c-1", "mobile_e164": "+61400000001", "email": None}])
    links = await match_customer_changed(
        {"customer_id": "cust-9", "mobile_phone_number": "0400 000 001"}, repo)
    assert links == [("c-1", "cust-9", "mobile")]


async def test_email_match_only_when_unambiguous():
    rows = [{"contact_id": "c-1", "mobile_e164": None, "email": "a@b.co"},
            {"contact_id": "c-2", "mobile_e164": None, "email": "a@b.co"}]
    links = await match_customer_changed(
        {"customer_id": "cust-9", "email_address": "A@B.co"}, FakeRepo(rows))
    assert links == []          # ambiguous → no link


async def test_no_identifiers_no_links():
    assert await match_customer_changed({"customer_id": "cust-9"}, FakeRepo([])) == []
```

`tests/marketingService/test_marketing_service.py` (AsyncMock style): `process_message` with `typ=customer.changed.v1` and a payload matching a contact → asserts `EventHandlers.emit` awaited with `contact.linked.v1`; with `typ=contact.intake.requested.v1` (the CRM fallback command) → asserts emit awaited with `contact.observed.v1`; unknown typ → no emit, no raise.

- [ ] **Step 2: Run to verify fail** → ModuleNotFoundError.

- [ ] **Step 3: Implement**

`matcher.py`:

```python
"""Marketing-grade contact↔customer matching (spec §2.5): exact mobile auto-links;
exact email links only when unambiguous; anything else → no link."""
from src.services.marketingService.commands import normalise_email, normalise_mobile


async def match_customer_changed(payload: dict, repository):
    customer_id = payload.get("customer_id")
    if not customer_id:
        return []
    mobile = normalise_mobile(payload.get("mobile_phone_number"))
    email = normalise_email(payload.get("email_address"))
    if not mobile and not email:
        return []
    links = []
    if mobile:
        rows = await repository.find_contacts_for_match(mobile, None)
        links.extend((r["contact_id"], customer_id, "mobile") for r in rows)
    if not links and email:
        rows = await repository.find_contacts_for_match(None, email)
        if len(rows) == 1:
            links.append((rows[0]["contact_id"], customer_id, "email"))
    return links
```

`marketingService.py` — mirror `customerService.py` structure exactly (imports, `SELF_CONSUME_STREAMS`, class with self-consume methods copied; the four self-consume methods are verbatim ports with `CustomerService` → `MarketingService` in log strings). `process_message` routing:

```python
event_type = event_data.get("typ")
payload = self._parse_payload(event_data)   # json.loads when str, mirror customerService
if event_type == config.get("msg_type_customer_changed"):
    links = await match_customer_changed(payload, self.repository)
    for contact_id, customer_id, basis in links:
        await self.event_handlers.emit(
            MarketingEventType.CONTACT_LINKED_V1.value,
            ContactLinkedV1(contact_id=contact_id, customer_id=customer_id,
                            match_basis=basis, linked_at=now_iso()),
            correlation_id=event_data.get("conv", ""),
            cause_event_id=event_data.get("event_id"), customer_id=customer_id)
elif event_type in (config.get("msg_type_identity_linked"), config.get("msg_type_identity_merged")):
    await self._repoint_links(payload)   # UPDATE-style: emit ContactLinkedV1 to canonical for
                                         # every contact currently linked to the alias id
elif event_type == config.get("msg_type_contact_intake_requested"):
    await self._handle_intake_command(payload, event_data)
else:
    logger.debug("marketingService: ignoring inbox event type %s", event_type)
```

`_handle_intake_command(payload, event_data)`: idempotency fence on `payload.get("idempotency_key")` (Redis `set nx` with 24h TTL, key `marketingService:intake:{key}`) → `existing = await self.repository.find_contact_by_natural_key(normalise_mobile(payload.get("mobile")), normalise_email(payload.get("email")))` → `event = build_contact_observed(payload, existing)` → `emit(CONTACT_OBSERVED_V1, event, correlation_id=event_data.get("conv",""), cause_event_id=event_data.get("cause"))`. `_repoint_links(payload)`: `alias = payload.get("journey_id") or payload.get("merged_canonical_id")`; `canonical = payload.get("canonical_id")`; select contacts `WHERE customer_id = :alias` (add repository method `find_contacts_by_customer(customer_id)` — one `select` returning mappings) and emit `ContactLinkedV1(..., customer_id=canonical, match_basis="identity_merge")` per row.

- [ ] **Step 4: Run tests** — `python -m pytest tests/marketingService -v` → all PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(marketing): MarketingService inbox consumer + contact matcher"`

### Task A9: gRPC — proto, codegen, idempotency, servicer, server

**Files:**
- Create: `proto/marketing_service.proto`, `src/services/marketingService/grpc/__init__.py` (+ generated stubs), `src/services/marketingService/grpc_idempotency.py`, `src/services/marketingService/grpc_servicer.py`, `src/services/marketingService/grpc_server.py`
- Test: `tests/marketingService/test_grpc_servicer.py`

**Interfaces:**
- Consumes: `EventHandlers.emit` (A7), repository reads (A5), `build_contact_observed` (A6).
- Produces: `MarketingService` gRPC service on port 50054 with RPCs `UpsertContact`, `UpdateContact`, `SetConsent`, `LogInteraction`, `EraseContact`; `serve(port)` for main.py (A10). Response messages carry `contact_id`, `event_id`, `idempotent_replay`.

- [ ] **Step 1: Write the proto** — `proto/marketing_service.proto`:

```proto
syntax = "proto3";

package billie.marketing;

service MarketingService {
  rpc UpsertContact(UpsertContactRequest) returns (UpsertContactResponse);
  rpc UpdateContact(UpdateContactRequest) returns (CommandResponse);
  rpc SetConsent(SetConsentRequest) returns (CommandResponse);
  rpc LogInteraction(LogInteractionRequest) returns (CommandResponse);
  rpc EraseContact(EraseContactRequest) returns (CommandResponse);
}

message ConsentCapture {
  bool granted = 1;
  repeated string channels = 2;
  string method = 3;
}

message UpsertContactRequest {
  string idempotency_key = 1;
  string first_name = 2;
  string email = 3;
  string mobile = 4;
  string city = 5;
  string postcode = 6;
  string source = 7;
  string utm_json = 8;              // JSON object as string
  repeated string platforms = 9;
  string channel_preference = 10;
  string referred_by_code = 11;
  bool waitlist = 12;
  ConsentCapture consent = 13;
  string actor = 14;
}

message UpsertContactResponse {
  string contact_id = 1;
  string event_id = 2;
  bool created = 3;
  bool idempotent_replay = 4;
}

message UpdateContactRequest {
  string idempotency_key = 1;
  string contact_id = 2;
  string first_name = 3;
  string email = 4;
  string mobile = 5;
  string city = 6;
  string postcode = 7;
  string channel_preference = 8;
  string attributes_json = 9;
  string actor = 10;
}

message SetConsentRequest {
  string idempotency_key = 1;
  string contact_id = 2;
  bool granted = 3;
  repeated string channels = 4;
  string method = 5;
  string evidence = 6;
  string actor = 7;
}

message LogInteractionRequest {
  string idempotency_key = 1;
  string contact_id = 2;
  string kind = 3;
  string channel = 4;
  string direction = 5;
  string subject = 6;
  string body = 7;
  string source_system = 8;
  string occurred_at = 9;           // ISO-8601; empty = now
  string metadata_json = 10;
  string actor = 11;
}

message EraseContactRequest {
  string idempotency_key = 1;
  string contact_id = 2;
  string actor = 3;
}

message CommandResponse {
  string contact_id = 1;
  string event_id = 2;
  bool idempotent_replay = 3;
}
```

- [ ] **Step 2: Generate stubs**

```bash
mkdir -p src/services/marketingService/grpc && touch src/services/marketingService/grpc/__init__.py
python -m grpc_tools.protoc -I./proto \
  --python_out=./src/services/marketingService/grpc \
  --grpc_python_out=./src/services/marketingService/grpc \
  ./proto/marketing_service.proto
```

Then fix the generated `marketing_service_pb2_grpc.py` import to relative (`from . import marketing_service_pb2 as ...`) if it emits absolute — match whatever `collectionsService/grpc/` does.

- [ ] **Step 3: Write the failing servicer test** — `tests/marketingService/test_grpc_servicer.py`: instantiate `MarketingGrpcServicer(handlers=AsyncMock-wrapped EventHandlers, repository=FakeRepo)` directly (no server); call `await servicer.UpsertContact(request, MagicMock())` with a `pb2.UpsertContactRequest(mobile="0400000001", source="campus", waitlist=True, idempotency_key="k1")`; assert `handlers.emit` awaited once with typ `contact.observed.v1`, response `contact_id` non-empty. Second call same `idempotency_key` (Redis mock returns cached JSON) → `idempotent_replay is True`, `handlers.emit` not re-awaited. `UpsertContact` with neither mobile nor email → `context.abort` called with `INVALID_ARGUMENT` (assert via `AsyncMock` side effect on abort raising, per existing ledger servicer tests if present; else assert abort awaited). `EraseContact` for unknown contact (`repo.get_contact → None`) → `NOT_FOUND`.

- [ ] **Step 4: Implement**

`grpc_idempotency.py` — function-based, copy the collections pattern with `KEY_PREFIX = "marketingService:grpc:idem:"`, `TTL_SECONDS = 86400`; `get_cached_command_response(key) -> dict | None`, `cache_command_response(key, **fields)`.

`grpc_servicer.py` — `class MarketingGrpcServicer(pb2_grpc.MarketingServiceServicer)`; `__init__(self, handlers, repository)`. `UpsertContact` flow (the effective-idempotency-key mitigation from the spec dialogue):

```python
async def UpsertContact(self, request, context):
    mobile = normalise_mobile(request.mobile)
    email = normalise_email(request.email)
    if not mobile and not email:
        await context.abort(grpc.StatusCode.INVALID_ARGUMENT,
                            "UpsertContact requires a valid AU mobile or an email")
    effective_key = request.idempotency_key or f"upsert:{mobile or email}"
    cached = await get_cached_command_response(effective_key)
    if cached:
        return pb2.UpsertContactResponse(**cached, idempotent_replay=True)
    existing = await self.repository.find_contact_by_natural_key(mobile, email)
    cmd = {
        "first_name": request.first_name or None, "email": request.email or None,
        "mobile": request.mobile or None, "city": request.city or None,
        "postcode": request.postcode or None, "source": request.source or None,
        "utm": _loads(request.utm_json), "platforms": list(request.platforms),
        "channel_preference": request.channel_preference or None,
        "referred_by_code": request.referred_by_code or None,
        "waitlist": request.waitlist, "actor": request.actor or "intake",
        "consent": ({"granted": request.consent.granted, "channels": list(request.consent.channels),
                     "method": request.consent.method} if request.HasField("consent") else None),
    }
    event = build_contact_observed(cmd, existing)
    event_id = await self.handlers.emit(MarketingEventType.CONTACT_OBSERVED_V1.value, event)
    resp = {"contact_id": event.contact_id, "event_id": event_id, "created": existing is None}
    await cache_command_response(effective_key, **resp)
    return pb2.UpsertContactResponse(**resp, idempotent_replay=False)
```

`UpdateContact`/`SetConsent`/`LogInteraction`/`EraseContact`: same shape — validate `contact_id` exists via `repository.get_contact` (abort `NOT_FOUND` if None; for `EraseContact` also allow already-erased → replay-safe), build the matching SDK model (`ContactUpdatedV1`, `ContactConsentGrantedV1`/`WithdrawnV1` on `request.granted`, `ContactInteractionLoggedV1` with minted `interaction_id=str(uuid4())` and `occurred_at or now_iso()`, `ContactErasedV1`), `emit`, cache, return `CommandResponse`. `_loads(s)` = `json.loads(s) if s else {}` with `INVALID_ARGUMENT` abort on bad JSON.

`grpc_server.py` — copy `collectionsService/grpc_server.py` shape: `DEFAULT_PORT = 50054`, builds `PostgresMarketingRepository` + `EventHandlers` directly (no inbox consumer group), `add_MarketingServiceServicer_to_server`, `serve(port)` with signal handlers.

- [ ] **Step 5: Run tests** — `python -m pytest tests/marketingService -v` → PASS. Commit: `git add -A proto src/services/marketingService tests/marketingService && git commit -m "feat(marketing): gRPC command API on :50054"`

### Task A10: Wire into main.py + config

**Files:**
- Modify: `src/main.py`, `src/config.dev.json` (and mirror keys into `src/config.demo.json` / `src/config.prod.json` if those files exist — check `ls src/config.*.json`)
- Test: `tests/marketingService/test_wiring.py`

**Interfaces:**
- Produces: running service processes; config keys `agent_marketingService="marketingService"`, `inbox_marketingService="inbox:marketing"`, `msg_type_contact_intake_requested="contact.intake.requested.v1"`, chatLedger enablement block.

- [ ] **Step 1: Failing test** — `tests/marketingService/test_wiring.py`:

```python
from src.config import config


def test_marketing_config_keys():
    assert config.get("agent_marketingService") == "marketingService"
    assert config.get("inbox_marketingService") == "inbox:marketing"
    assert config.get("msg_type_contact_intake_requested") == "contact.intake.requested.v1"
    events = config.get("chatLedger_services", {}).get("marketingService", {}).get("events", {})
    for typ in ("contact.observed.v1", "contact.linked.v1", "contact.consent.granted.v1",
                "contact.consent.withdrawn.v1", "contact.interaction.logged.v1",
                "contact.stage.changed.v1", "contact.erased.v1", "contact.updated.v1",
                "contact.unlinked.v1"):
        assert events.get(typ, {}).get("enabled") is True


def test_main_registers_marketing():
    import src.main as m
    assert hasattr(m, "run_marketing_service")
    assert hasattr(m, "run_marketing_grpc_server")
```

- [ ] **Step 2: Run to verify fail**, then implement: add the JSON keys + `chatLedger_services.marketingService.events.{...9 types...}: {"enabled": true}` block to `src/config.dev.json` (and other env config files with the same keys); add to `src/main.py`:

```python
from src.services.marketingService.marketingService import MarketingService
from src.services.marketingService.grpc_server import serve as serve_marketing_grpc


async def start_marketing_service():
    marketing_service = MarketingService({})
    await marketing_service.start_self_consumption()
    await marketing_service.subscribe()


def run_marketing_service():
    setup_logging()
    asyncio.run(start_marketing_service())


async def start_marketing_grpc_server():
    port = int(os.environ.get("MARKETING_GRPC_PORT", "50054"))
    await serve_marketing_grpc(port=port)


def run_marketing_grpc_server():
    setup_logging()
    asyncio.run(start_marketing_grpc_server())
```

…and two `processes.append(multiprocessing.Process(target=...))` lines in `main()`.

- [ ] **Step 3: Run the full platform suite** — `python -m pytest tests/marketingService packages/marketing/tests -v` → PASS; `ruff check src/services/marketingService packages/marketing` → clean.

- [ ] **Step 4: Commit** — `git commit -am "feat(marketing): register marketingService + gRPC in main and config"`

---

## Part B — billieChat (broker routes only)

### Task B1: Route marketing events + feed `inbox:marketing`

**Files:**
- Modify: `/Users/rohansharp/workspace/billieChat/backend/backend/src/routing/routes.json`
- Modify: every `backend/backend/src/config.<env>.json` in billieChat (run `ls backend/backend/src/config.*.json` to enumerate)
- Test: existing router tests + a strict-mode load check

**Interfaces:**
- Consumes: broker router semantics (exact → prefix → wildcard matching; sender-keyed routes; `agent_inbox_mapping`).
- Produces: `contact.*`/`referral.*`/`batch.*`/`feedback.*` from sender `marketingService` → `inbox:billie-servicing`; `customer.changed.v1` + `customer.identity.linked/merged.v1` additionally → `inbox:marketing`.

- [ ] **Step 1: Add config placeholders** to each `config.<env>.json`:

```json
"agent_marketingService": "marketingService",
"inbox_marketing": "inbox:marketing"
```

(`agent_marketingService` MUST equal the literal `agt` the platform publisher uses: `marketingService`.)

- [ ] **Step 2: Edit routes.json** — three changes:

1. New sender block (prefix conditions hit the router's pass-2 `startswith` matching):

```json
"${agent_marketingService}": [
  { "condition": { "typ": "contact." },  "targetAgent": [ "${agent_billie-crm}" ] },
  { "condition": { "typ": "referral." }, "targetAgent": [ "${agent_billie-crm}" ] },
  { "condition": { "typ": "batch." },    "targetAgent": [ "${agent_billie-crm}" ] },
  { "condition": { "typ": "feedback." }, "targetAgent": [ "${agent_billie-crm}" ] }
],
```

2. Append `"${agent_marketingService}"` to the `targetAgent` list of the existing `${agent_customer_service}` rule for `${msg_type_customer_changed}`, and to the `identityRecognition` rules for `${msg_type_identity_linked}` and `${msg_type_identity_merged}` (exact rules win over prefixes, so appending to the exact rules is required — a marketing prefix rule would never fire for these).

3. Add to `agent_inbox_mapping`:

```json
"${agent_marketingService}": "${inbox_marketing}"
```

- [ ] **Step 3: Verify strict compile** — from billieChat backend root, run the existing router test suite (`python -m pytest backend/backend/tests -k rout -v` — adjust to the repo's actual test invocation; check `Makefile`/CI config) and a direct strict load:

```bash
cd /Users/rohansharp/workspace/billieChat
python -c "
import sys; sys.path.insert(0, 'backend/backend')
from src.routing import router
table = router.load_routes()
assert '${' not in str(table.agent_inbox_mapping), 'unresolved placeholder'
print('routes OK:', len(table.routes), 'senders')
"
```

Expected: `routes OK: <n> senders`, no unresolved-placeholder error. (Adjust the import path if `router.py` exposes a different loader name — read the file first.)

- [ ] **Step 4: Commit**

```bash
git add backend/backend/src/routing/routes.json backend/backend/src/config.*.json
git commit -m "feat(routing): fan marketing events to CRM and feed inbox:marketing"
```

**Note:** no stream creation needed — `MarketingService.subscribe()` creates `inbox:marketing` via `xgroup_create(mkstream=True)`.

---

## Part C — billie-crm (worktree `feat+marketing-crm`)

All paths below are relative to `/Users/rohansharp/workspace/billie-crm/.claude/worktrees/feat+marketing-crm`.

### Task C1: `marketing` role + access helpers

**Files:**
- Modify: `src/lib/access.ts`, `src/collections/Users.ts` (role select options)
- Test: `tests/unit/lib/access.test.ts`

**Interfaces:**
- Produces: `canMarketing(user)` (admin | marketing), `canReadMarketing(user)` (admin | marketing | supervisor | operations | readonly). `hasAnyRole` is **unchanged** (must NOT include `marketing` — that's the lending wall).

- [ ] **Step 1: Write the failing test** — `tests/unit/lib/access.test.ts`:

```typescript
import { describe, test, expect } from 'vitest'
import { canMarketing, canReadMarketing, hasAnyRole, getUserRole } from '@/lib/access'

const user = (role: string) => ({ role }) as unknown

describe('marketing role wall', () => {
  test('marketing is a valid role', () => {
    expect(getUserRole(user('marketing'))).toBe('marketing')
  })
  test('canMarketing: admin and marketing only', () => {
    expect(canMarketing(user('admin'))).toBe(true)
    expect(canMarketing(user('marketing'))).toBe(true)
    expect(canMarketing(user('supervisor'))).toBe(false)
    expect(canMarketing(user('operations'))).toBe(false)
  })
  test('canReadMarketing: everything except service', () => {
    for (const r of ['admin', 'marketing', 'supervisor', 'operations', 'readonly'])
      expect(canReadMarketing(user(r))).toBe(true)
    expect(canReadMarketing(user('service'))).toBe(false)
  })
  test('LENDING WALL: hasAnyRole must NOT admit marketing', () => {
    expect(hasAnyRole(user('marketing'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify fail** — `pnpm exec vitest run tests/unit/lib/access.test.ts --config ./vitest.config.mts` → FAIL (no export `canMarketing`).

- [ ] **Step 3: Implement** — in `src/lib/access.ts`: add `'marketing'` to `VALID_ROLES`, then:

```typescript
export function canMarketing(user: unknown): boolean {
  const role = getUserRole(user)
  return role === 'admin' || role === 'marketing'
}

export function canReadMarketing(user: unknown): boolean {
  const role = getUserRole(user)
  return (
    role !== undefined &&
    ['admin', 'marketing', 'supervisor', 'operations', 'readonly'].includes(role)
  )
}
```

In `src/collections/Users.ts`, add `{ label: 'Marketing', value: 'marketing' }` to the `role` field's `options` array. Note: `User['role']` in `payload-types.ts` regenerates in C2's `pnpm generate:types`.

- [ ] **Step 4: Run test** → PASS (types may need C2's regen if TS complains about the role union — acceptable to run generate:types early here: `pnpm generate:types`).

- [ ] **Step 5: Commit** — `git add src/lib/access.ts src/collections/Users.ts src/payload-types.ts tests/unit/lib/access.test.ts && git commit -m "feat(marketing): marketing role + access helpers, lending wall intact"`

### Task C2: Payload projection collections + migration + types

**Files:**
- Create: `src/collections/Contacts.ts`, `src/collections/Interactions.ts`, `src/collections/ContactAuditLog.ts`
- Modify: `src/payload.config.ts` (imports + `collections` array)
- Create: `src/migrations/<ts>_marketing_module.ts` (+ generated `.json` snapshot, `index.ts` entry via CLI)
- Test: `tests/int/marketing-collections.int.spec.ts`

**Interfaces:**
- Produces: Payload tables the Python processor writes (snake_case columns: `contacts.contact_id`, `contacts.mobile_e164`, `contacts.derived_stage`, `interactions.interaction_id`, `interactions.contact_id_string`, `contact_audit_log.*`); read access via `canReadMarketing`, CUD `() => false`.

- [ ] **Step 1: Write the failing integration test** — `tests/int/marketing-collections.int.spec.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

let payload: Payload

describe('marketing projection collections', () => {
  beforeAll(async () => {
    payload = await getPayload({ config })
  })

  it('contacts collection exists and rejects API writes', async () => {
    await expect(
      payload.create({
        collection: 'contacts',
        data: { contactId: 'c-test-1' },
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('processor-style raw insert then read via payload.find', async () => {
    await payload.db.drizzle.execute(
      `INSERT INTO contacts (contact_id, source, derived_stage, observed_at, updated_at, created_at)
       VALUES ('c-int-1', 'campus', 'lead', now(), now(), now())`,
    )
    const res = await payload.find({ collection: 'contacts', where: { contactId: { equals: 'c-int-1' } } })
    expect(res.docs).toHaveLength(1)
    expect(res.docs[0].derivedStage).toBe('lead')
  })
})
```

- [ ] **Step 2: Run to verify fail** — `pnpm exec vitest run tests/int/marketing-collections.int.spec.ts --config ./vitest.config.mts` → FAIL (unknown collection `contacts`).

- [ ] **Step 3: Implement collections** — `src/collections/Contacts.ts` (read-only projection per Customers pattern):

```typescript
import type { CollectionConfig, Access } from 'payload'
import { canReadMarketing, hideFromNonAdmins } from '@/lib/access'

const marketingRead: Access = ({ req: { user } }) => canReadMarketing(user)

export const Contacts: CollectionConfig = {
  slug: 'contacts',
  admin: {
    useAsTitle: 'firstName',
    defaultColumns: ['firstName', 'mobileE164', 'derivedStage', 'source'],
    group: 'Marketing',
    hidden: hideFromNonAdmins,
    description: 'Marketing contact facet — read-only projection of marketingService events',
  },
  access: {
    read: marketingRead,
    create: () => false, // Only written by the event processor
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'contactId', type: 'text', required: true, unique: true, admin: { readOnly: true } },
    { name: 'firstName', type: 'text', admin: { readOnly: true } },
    { name: 'email', type: 'email', index: true, admin: { readOnly: true } },
    { name: 'mobileE164', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'city', type: 'text', admin: { readOnly: true } },
    { name: 'postcode', type: 'text', admin: { readOnly: true } },
    {
      name: 'source',
      type: 'select',
      options: ['meta', 'google', 'campus', 'referral', 'social_dm', 'ai_search', 'organic', 'other'],
      admin: { readOnly: true },
    },
    { name: 'utm', type: 'json', admin: { readOnly: true } },
    { name: 'platforms', type: 'json', admin: { readOnly: true } },
    {
      name: 'channelPreference',
      type: 'select',
      options: ['whatsapp', 'sms'],
      admin: { readOnly: true },
    },
    { name: 'referralCode', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'referredByContactId', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'waitlistJoinedAt', type: 'date', admin: { readOnly: true } },
    { name: 'waitlistPosition', type: 'number', admin: { readOnly: true } },
    { name: 'batchId', type: 'text', admin: { readOnly: true } },
    { name: 'panelMember', type: 'checkbox', admin: { readOnly: true } },
    {
      name: 'customerId',
      type: 'text',
      index: true,
      admin: { readOnly: true, description: 'Canonical platform customer id once linked (one-way)' },
    },
    { name: 'linkBasis', type: 'text', admin: { readOnly: true } },
    { name: 'linkedAt', type: 'date', admin: { readOnly: true } },
    {
      name: 'derivedStage',
      type: 'select',
      options: ['lead', 'waitlist', 'invited', 'applicant', 'customer', 'former_customer'],
      index: true,
      admin: { readOnly: true, description: 'Derived by marketingService — never hand-edited' },
    },
    {
      name: 'loanStatus',
      type: 'select',
      options: ['approved', 'disbursed', 'repaid'],
      admin: { readOnly: true, description: 'Minimal mirror only — no financial detail, ever' },
    },
    { name: 'consent', type: 'json', admin: { readOnly: true } },
    { name: 'attributes', type: 'json', admin: { readOnly: true } },
    { name: 'erased', type: 'checkbox', admin: { readOnly: true } },
    { name: 'observedAt', type: 'date', admin: { readOnly: true } },
  ],
  timestamps: true,
}
```

`src/collections/Interactions.ts` — same access block, slug `interactions`, group `Marketing`, fields: `interactionId` (text, required, unique), `contactIdString` (text, required, index), `contact` (relationship to `contacts`, index — set by processor when the contact row exists), `occurredAt` (date, index), `kind` (select: `signup, message_out, message_in, feedback_prompt, referral, stage_change, note, import`), `channel` (text), `direction` (select: `inbound, outbound`), `subject` (text), `body` (textarea), `sourceSystem` (text), `metadata` (json). All `readOnly: true`.

`src/collections/ContactAuditLog.ts` — slug `contact-audit-log`, group `Marketing`, same access; fields: `contactIdString` (text, required, index), `eventType` (text, required), `actor` (text), `occurredAt` (date, index), `detail` (json). All readOnly.

Register in `src/payload.config.ts`: import the three, append `Contacts, Interactions, ContactAuditLog` to the `collections` array.

- [ ] **Step 4: Regenerate types + run test**

```bash
pnpm generate:types
pnpm exec vitest run tests/int/marketing-collections.int.spec.ts --config ./vitest.config.mts
```

Expected: PASS (push:true syncs schema in globalSetup).

- [ ] **Step 5: Create the committed migration** (prod deploys need it; dev/test use push) — follow the local recipe (throwaway Docker Postgres, branch off latest main — see memory `payload-migration-local-recipe`):

```bash
make -C infra/fly pg-migrate-create ENV=dev NAME=marketing_module
```

Verify `src/migrations/index.ts` gained the entry and the new migration's `up` contains `CREATE TABLE "contacts"`, `"interactions"`, `"contact_audit_log"`.

- [ ] **Step 6: Commit** — `git add src/collections src/payload.config.ts src/payload-types.ts src/migrations tests/int/marketing-collections.int.spec.ts && git commit -m "feat(marketing): contacts/interactions/audit projection collections + migration"`

### Task C3: Event-processor marketing handlers

**Files:**
- Modify: `event-processor/requirements.txt`, `event-processor/src/billie_servicing/processor.py`, `event-processor/src/billie_servicing/main.py`, `event-processor/src/billie_servicing/handlers/__init__.py`
- Create: `event-processor/src/billie_servicing/handlers/marketing.py`
- Test: `event-processor/tests/test_marketing_handlers.py`

**Interfaces:**
- Consumes: `billie_marketing_events` SDK (A1–A3), `db.py` helpers (`upsert`, `update_by_key`).
- Produces: handlers `handle_contact_observed`, `handle_contact_updated`, `handle_contact_linked`, `handle_contact_unlinked`, `handle_contact_consent_granted`, `handle_contact_consent_withdrawn`, `handle_contact_interaction_logged`, `handle_contact_stage_changed`, `handle_contact_erased` — signature `async def handle_x(pool: asyncpg.Pool, event: ParsedMarketingEvent) -> None`.

- [ ] **Step 1: Install the SDK for local dev** (final pin happens in Task D1):

```bash
cd event-processor
pip install -e /Users/rohansharp/workspace/billie-platform-services/packages/marketing
```

Add a placeholder line to `requirements.txt` under the SDK block (commented until D1 publishes):

```
# git+https://x-access-token:${GITHUB_TOKEN}@github.com/BillieLoans/billie-event-sdks.git@marketing-v0.1.0#subdirectory=packages/marketing  # uncommented in Task D1
```

- [ ] **Step 2: Write the failing tests** — `event-processor/tests/test_marketing_handlers.py`. Mirror existing handler tests' style (check `event-processor/tests/` for the established fake-pool pattern; if none, use this minimal fake):

```python
import json

import pytest

from billie_marketing_events import parse_marketing_message
from billie_servicing.handlers.marketing import (
    handle_contact_erased, handle_contact_interaction_logged, handle_contact_observed,
)


class FakeConn:
    def __init__(self):
        self.executed = []
    async def execute(self, sql, *args):
        self.executed.append((sql, args))
        return "UPDATE 1"
    async def fetchval(self, sql, *args):
        return None


class FakePool(FakeConn):
    def acquire(self):
        return _Ctx(self)


class _Ctx:
    def __init__(self, conn):
        self.conn = conn
    async def __aenter__(self):
        return self.conn
    async def __aexit__(self, *a):
        return False


def _parsed(typ, payload):
    return parse_marketing_message({
        "conv": "conv-1", "agt": "marketingService", "usr": "c-1", "seq": 1,
        "cls": "msg", "typ": typ, "event_id": "ev-1", "payload": json.dumps(payload),
    })


async def test_contact_observed_upserts_contact_and_audit():
    pool = FakePool()
    await handle_contact_observed(pool, _parsed("contact.observed.v1", {
        "contact_id": "c-1", "mobile_e164": "+61400000001", "source": "campus",
        "observed_at": "2026-07-02T00:00:00+00:00"}))
    sql_all = " ".join(s for s, _ in pool.executed)
    assert 'INSERT INTO "contacts"' in sql_all or "INSERT INTO contacts" in sql_all
    assert "contact_audit_log" in sql_all


async def test_interaction_logged_inserts_row():
    pool = FakePool()
    await handle_contact_interaction_logged(pool, _parsed("contact.interaction.logged.v1", {
        "interaction_id": "i-1", "contact_id": "c-1", "kind": "signup",
        "occurred_at": "2026-07-02T00:00:00+00:00", "source_system": "crm"}))
    assert any("interactions" in s for s, _ in pool.executed)


async def test_erased_redacts_pi():
    pool = FakePool()
    await handle_contact_erased(pool, _parsed("contact.erased.v1", {
        "contact_id": "c-1", "erased_at": "2026-07-02T00:00:00+00:00", "actor": "admin"}))
    sql_all = " ".join(s for s, _ in pool.executed)
    assert "erased" in sql_all and "interactions" in sql_all
```

Run: `cd event-processor && PYTHONPATH=src python -m pytest tests/test_marketing_handlers.py -v` → FAIL (ImportError). (If existing tests use a different asyncio plugin config, mirror it — check `event-processor/pytest.ini`/`pyproject.toml`.)

- [ ] **Step 3: Implement** — `handlers/marketing.py`. Use `db.upsert` with the exact Payload snake_case column names from C2; every handler also appends an audit row. Core:

```python
"""Handlers for marketing facet events (contact.*) → Payload projections.

Columns MUST match Payload's generated snake_case names (see db.py header).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg
import structlog

from ..db import coerce_date, upsert

logger = structlog.get_logger()


def _now():
    return datetime.now(timezone.utc)


async def _audit(pool, contact_id: str, event_type: str, actor: str | None, detail: dict[str, Any]):
    await upsert(pool, "contact_audit_log",
                 conflict_columns=["id"],
                 values={"id": str(uuid.uuid4()), "contact_id_string": contact_id,
                         "event_type": event_type, "actor": actor,
                         "occurred_at": _now(), "detail": json.dumps(detail),
                         "updated_at": _now(), "created_at": _now()},
                 do_nothing_on_conflict=True)


async def handle_contact_observed(pool: asyncpg.Pool, event) -> None:
    p = event.payload
    values = {
        "contact_id": p.contact_id,
        "first_name": p.first_name, "email": p.email, "mobile_e164": p.mobile_e164,
        "city": p.city, "postcode": p.postcode, "source": p.source,
        "utm": json.dumps(p.utm), "platforms": json.dumps(p.platforms),
        "channel_preference": p.channel_preference,
        "referral_code": p.referral_code,
        "waitlist_joined_at": coerce_date(p.waitlist_joined_at),
        "consent": json.dumps({"marketing": p.consent.model_dump()} if p.consent else {}),
        "observed_at": coerce_date(p.observed_at),
        "updated_at": _now(),
    }
    await upsert(pool, "contacts", conflict_columns=["contact_id"],
                 values={k: v for k, v in values.items() if v is not None},
                 insert_only_columns=["referral_code", "observed_at"])
    await _audit(pool, p.contact_id, event.event_type, p.actor, {"source": p.source})
```

Remaining handlers follow the same shape:
- `handle_contact_updated`: upsert non-None asserted fields + audit with the changed field names in `detail`.
- `handle_contact_linked` / `handle_contact_unlinked`: `update_by_key(pool, "contacts", key_column="contact_id", key_value=p.contact_id, values={"customer_id": p.customer_id or None, "link_basis": ..., "linked_at": ...})` + audit.
- `handle_contact_consent_granted/withdrawn`: read-modify-write is unnecessary — write `consent` jsonb via `merge_jsonb(pool, "contacts", column="consent", key_column="contact_id", key_value=p.contact_id, patch={"marketing": {"granted": granted, "channels": p.channels, "method": p.method, "at": p.occurred_at}})` + audit.
- `handle_contact_stage_changed`: `update_by_key(... values={"derived_stage": p.stage})` + audit.
- `handle_contact_interaction_logged`: `upsert(pool, "interactions", conflict_columns=["interaction_id"], values={...all fields, "contact_id_string": p.contact_id, "metadata": json.dumps(p.metadata)}, do_nothing_on_conflict=True)` — also resolve the `contact` relationship id: `contact_ref = await pool.fetchval('SELECT id FROM contacts WHERE contact_id = $1', p.contact_id)` and include `"contact_id_id": contact_ref` if the generated FK column exists (check generated schema; Payload names relationship columns `<field>_id`).
- `handle_contact_erased`: null PI columns on `contacts` (`first_name,email,mobile_e164,city,postcode`, `utm='{}'`, `attributes='{}'`, `erased=true`) via `update_by_key`, then `await pool.execute("UPDATE interactions SET subject = NULL, body = NULL, metadata = '{}' WHERE contact_id_string = $1", p.contact_id)` + audit (detail = `{}`, ids only).

Wire up: `handlers/__init__.py` barrel exports all nine; `main.py setup_handlers` registers:

```python
# Marketing events (billie_marketing_events SDK)
processor.register_handler("contact.observed.v1", handle_contact_observed)
processor.register_handler("contact.updated.v1", handle_contact_updated)
processor.register_handler("contact.linked.v1", handle_contact_linked)
processor.register_handler("contact.unlinked.v1", handle_contact_unlinked)
processor.register_handler("contact.consent.granted.v1", handle_contact_consent_granted)
processor.register_handler("contact.consent.withdrawn.v1", handle_contact_consent_withdrawn)
processor.register_handler("contact.interaction.logged.v1", handle_contact_interaction_logged)
processor.register_handler("contact.stage.changed.v1", handle_contact_stage_changed)
processor.register_handler("contact.erased.v1", handle_contact_erased)
```

`processor.py _parse_event`: add BEFORE the final `else` (and note `contact.` must not collide with existing prefixes — it doesn't):

```python
elif event_type.startswith(("contact.", "referral.", "batch.", "feedback.")):
    return parse_marketing_message(sdk_data)
```

with `from billie_marketing_events import parse_marketing_message` at top.

- [ ] **Step 4: Run tests** — `PYTHONPATH=src python -m pytest tests/test_marketing_handlers.py -v` → PASS; run the full processor suite `PYTHONPATH=src python -m pytest tests -v` → no regressions; `ruff check src` → clean.

- [ ] **Step 5: Commit** — `git add event-processor && git commit -m "feat(marketing): project contact.* events into Payload collections"`

### Task C4: Marketing gRPC client + public intake route with Redis fallback

**Files:**
- Create: `proto/marketing_service.proto` (copy verbatim from platform repo — keep in sync), `src/server/marketing-grpc-client.ts`, `src/lib/intake-auth.ts`, `src/app/api/intake/waitlist/route.ts`, `src/lib/schemas/intake.ts`
- Test: `tests/unit/lib/intake-auth.test.ts`, `tests/unit/api/intake-waitlist.test.ts`

**Interfaces:**
- Consumes: platform gRPC `MarketingService` (A9); `getRedisClient()` from `src/server/redis-client.ts`.
- Produces:
  - `upsertContact(req: UpsertContactInput): Promise<{ contactId: string; eventId: string; created: boolean; idempotentReplay: boolean }>` plus `updateContact`, `setConsent`, `logInteraction`, `eraseContact` from `marketing-grpc-client.ts`
  - `verifyIntakeAuth(request: NextRequest, rawBody: string): boolean` (API key + HMAC)
  - `POST /api/intake/waitlist` — 200 `{ contactId?, status: 'accepted' | 'queued' }`, 400 validation, 401 auth
  - `WaitlistIntakeSchema` (zod)

- [ ] **Step 1: Copy the proto + write the gRPC client** — first read `src/server/grpc-client.ts` and mirror its loader/credentials conventions exactly (proto-loader options, env-based address, deadline handling). Shape:

```typescript
// src/server/marketing-grpc-client.ts
import path from 'path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

const PROTO_PATH = path.resolve(process.cwd(), 'proto/marketing_service.proto')
const MARKETING_GRPC_ADDRESS = process.env.MARKETING_GRPC_ADDRESS ?? 'localhost:50054'
const DEADLINE_MS = 5000

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})
const proto = grpc.loadPackageDefinition(packageDefinition) as never as {
  billie: { marketing: { MarketingService: grpc.ServiceClientConstructor } }
}

let client: grpc.Client | null = null
function getClient() {
  if (!client) {
    client = new proto.billie.marketing.MarketingService(
      MARKETING_GRPC_ADDRESS,
      grpc.credentials.createInsecure(),
    )
  }
  return client as InstanceType<grpc.ServiceClientConstructor>
}

function call<TReq, TRes>(method: string, req: TReq): Promise<TRes> {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + DEADLINE_MS)
    ;(getClient() as never as Record<string, Function>)[method](
      req,
      { deadline },
      (err: grpc.ServiceError | null, res: TRes) => (err ? reject(err) : resolve(res)),
    )
  })
}

export interface UpsertContactInput {
  idempotency_key: string
  first_name?: string
  email?: string
  mobile?: string
  city?: string
  postcode?: string
  source?: string
  utm_json?: string
  platforms?: string[]
  channel_preference?: string
  referred_by_code?: string
  waitlist?: boolean
  consent?: { granted: boolean; channels: string[]; method: string }
  actor?: string
}

export async function upsertContact(input: UpsertContactInput) {
  const res = await call<UpsertContactInput, {
    contact_id: string
    event_id: string
    created: boolean
    idempotent_replay: boolean
  }>('UpsertContact', input)
  return {
    contactId: res.contact_id,
    eventId: res.event_id,
    created: res.created,
    idempotentReplay: res.idempotent_replay,
  }
}
// updateContact / setConsent / logInteraction / eraseContact: same call() shape,
// methods 'UpdateContact' | 'SetConsent' | 'LogInteraction' | 'EraseContact',
// returning { contactId, eventId, idempotentReplay }.
```

(Adapt loader options/credentials to match `src/server/grpc-client.ts` if it differs — that file is authoritative for CRM gRPC conventions.)

- [ ] **Step 2: Write failing auth tests** — `tests/unit/lib/intake-auth.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

describe('verifyIntakeAuth', () => {
  beforeEach(() => {
    process.env.INTAKE_API_KEY = 'test-key'
    process.env.INTAKE_HMAC_SECRET = 'test-secret'
  })

  test('accepts valid key + signature', async () => {
    const { verifyIntakeAuth } = await import('@/lib/intake-auth')
    const body = '{"mobile":"0400000001"}'
    const sig = createHmac('sha256', 'test-secret').update(body).digest('hex')
    const req = new Request('http://x/api/intake/waitlist', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key', 'x-signature': sig },
    })
    expect(verifyIntakeAuth(req as never, body)).toBe(true)
  })

  test('rejects wrong key and wrong signature', async () => {
    const { verifyIntakeAuth } = await import('@/lib/intake-auth')
    const body = '{}'
    const sig = createHmac('sha256', 'test-secret').update(body).digest('hex')
    const bad1 = new Request('http://x', { method: 'POST', headers: { 'x-api-key': 'nope', 'x-signature': sig } })
    const bad2 = new Request('http://x', { method: 'POST', headers: { 'x-api-key': 'test-key', 'x-signature': 'deadbeef' } })
    expect(verifyIntakeAuth(bad1 as never, body)).toBe(false)
    expect(verifyIntakeAuth(bad2 as never, body)).toBe(false)
  })
})
```

Run → FAIL (module missing). Implement `src/lib/intake-auth.ts`:

```typescript
import { createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

export function verifyIntakeAuth(request: NextRequest | Request, rawBody: string): boolean {
  const apiKey = process.env.INTAKE_API_KEY
  const hmacSecret = process.env.INTAKE_HMAC_SECRET
  if (!apiKey || !hmacSecret) return false

  const providedKey = request.headers.get('x-api-key') ?? ''
  const providedSig = request.headers.get('x-signature') ?? ''
  const expectedSig = createHmac('sha256', hmacSecret).update(rawBody).digest('hex')

  const keyOk =
    providedKey.length === apiKey.length &&
    timingSafeEqual(Buffer.from(providedKey), Buffer.from(apiKey))
  const sigBuf = Buffer.from(providedSig)
  const expBuf = Buffer.from(expectedSig)
  const sigOk = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)
  return keyOk && sigOk
}
```

- [ ] **Step 3: Zod schema + route (test first)** — `tests/unit/api/intake-waitlist.test.ts` validates the schema contract:

```typescript
import { describe, test, expect } from 'vitest'
import { WaitlistIntakeSchema } from '@/lib/schemas/intake'

describe('WaitlistIntakeSchema', () => {
  test('minimal valid payload', () => {
    const r = WaitlistIntakeSchema.safeParse({ mobile: '0400 000 001', consent: { granted: true, method: 'waitlist_form' } })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.source).toBe('other')
  })
  test('requires mobile or email', () => {
    expect(WaitlistIntakeSchema.safeParse({ consent: { granted: true, method: 'x' } }).success).toBe(false)
    expect(WaitlistIntakeSchema.safeParse({ email: 'a@b.co', consent: { granted: true, method: 'x' } }).success).toBe(true)
  })
  test('rejects unknown source', () => {
    expect(WaitlistIntakeSchema.safeParse({ mobile: '0400000001', source: 'tv', consent: { granted: true, method: 'x' } }).success).toBe(false)
  })
})
```

`src/lib/schemas/intake.ts`:

```typescript
import { z } from 'zod'

export const WaitlistIntakeSchema = z
  .object({
    idempotency_key: z.string().max(128).optional(),
    first_name: z.string().max(100).optional(),
    email: z.string().email().optional(),
    mobile: z.string().max(20).optional(),
    city: z.string().max(100).optional(),
    postcode: z.string().max(10).optional(),
    source: z
      .enum(['meta', 'google', 'campus', 'referral', 'social_dm', 'ai_search', 'organic', 'other'])
      .default('other'),
    utm: z.record(z.string(), z.string()).optional(),
    platforms: z.array(z.string()).optional(),
    channel_preference: z.enum(['whatsapp', 'sms']).optional(),
    ref: z.string().max(12).optional(),
    consent: z.object({
      granted: z.boolean(),
      channels: z.array(z.enum(['sms', 'whatsapp', 'email'])).default(['sms']),
      method: z.string().max(50),
    }),
  })
  .refine((d) => !!d.mobile || !!d.email, { message: 'mobile or email is required' })

export type WaitlistIntake = z.infer<typeof WaitlistIntakeSchema>
```

`src/app/api/intake/waitlist/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { WaitlistIntakeSchema } from '@/lib/schemas/intake'
import { verifyIntakeAuth } from '@/lib/intake-auth'
import { upsertContact } from '@/server/marketing-grpc-client'
import { getRedisClient } from '@/server/redis-client'

const MARKETING_INBOX_STREAM = process.env.MARKETING_INBOX_STREAM ?? 'inbox:marketing'

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  if (!verifyIntakeAuth(request, rawBody)) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid intake credentials' } }, { status: 401 })
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Body must be JSON' } }, { status: 400 })
  }
  const parsed = WaitlistIntakeSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid intake payload', details: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    )
  }
  const intake = parsed.data
  const idempotencyKey = intake.idempotency_key ?? `intake:${intake.mobile ?? intake.email}`
  const command = {
    idempotency_key: idempotencyKey,
    first_name: intake.first_name,
    email: intake.email,
    mobile: intake.mobile,
    city: intake.city,
    postcode: intake.postcode,
    source: intake.source,
    utm_json: JSON.stringify(intake.utm ?? {}),
    platforms: intake.platforms ?? [],
    channel_preference: intake.channel_preference,
    referred_by_code: intake.ref,
    waitlist: true,
    consent: intake.consent,
    actor: 'intake',
  }

  try {
    const result = await upsertContact(command)
    return NextResponse.json({ status: 'accepted', contactId: result.contactId }, { status: 200 })
  } catch (grpcError) {
    // Never lose a signup: durable fallback onto the marketing inbox stream.
    console.warn('[Intake] gRPC failed, queueing to Redis fallback:', grpcError)
    try {
      const redis = getRedisClient()
      if (redis.status === 'wait') await redis.connect()
      await redis.xadd(
        MARKETING_INBOX_STREAM,
        '*',
        ...Object.entries({
          conv: nanoid(),
          agt: 'billie-crm',
          usr: 'intake',
          seq: '1',
          cls: 'cmd',
          typ: 'contact.intake.requested.v1',
          cause: nanoid(),
          payload: JSON.stringify({ ...intakeToCommandPayload(intake), idempotency_key: idempotencyKey }),
        }).flat(),
      )
      return NextResponse.json({ status: 'queued' }, { status: 200 })
    } catch (redisError) {
      console.error('[Intake] BOTH paths failed — signup at risk:', redisError)
      return NextResponse.json(
        { error: { code: 'INTAKE_UNAVAILABLE', message: 'Please retry' } },
        { status: 503 },
      )
    }
  }
}

function intakeToCommandPayload(intake: import('@/lib/schemas/intake').WaitlistIntake) {
  return {
    first_name: intake.first_name,
    email: intake.email,
    mobile: intake.mobile,
    city: intake.city,
    postcode: intake.postcode,
    source: intake.source,
    utm: intake.utm ?? {},
    platforms: intake.platforms ?? [],
    channel_preference: intake.channel_preference,
    referred_by_code: intake.ref,
    waitlist: true,
    consent: intake.consent,
    actor: 'intake',
  }
}
```

(The fallback payload's snake_case keys deliberately match `_handle_intake_command`'s `build_contact_observed` cmd dict keys — A8.)

- [ ] **Step 4: Run tests** — `pnpm exec vitest run tests/unit/lib/intake-auth.test.ts tests/unit/api/intake-waitlist.test.ts --config ./vitest.config.mts` → PASS. `pnpm lint` → clean.

- [ ] **Step 5: Commit** — `git add proto src/server/marketing-grpc-client.ts src/lib/intake-auth.ts src/lib/schemas/intake.ts src/app/api/intake tests/unit && git commit -m "feat(marketing): public waitlist intake with gRPC primary + Redis fallback"`

### Task C5: Staff command routes + read routes for the view

**Files:**
- Create: `src/app/api/marketing/contacts/route.ts` (GET list + POST create), `src/app/api/marketing/contacts/[contactId]/route.ts` (GET detail + PATCH update), `src/app/api/marketing/contacts/[contactId]/consent/route.ts` (POST), `src/app/api/marketing/contacts/[contactId]/interactions/route.ts` (POST), `src/app/api/marketing/contacts/[contactId]/erase/route.ts` (POST, admin-only)
- Test: `tests/unit/api/marketing-contacts.test.ts`

**Interfaces:**
- Consumes: `requireAuth` (`src/lib/auth.ts`), `canMarketing`/`canReadMarketing`/`isAdmin` (C1), gRPC client fns (C4), Payload local API for reads.
- Produces (consumed by C6 hooks):
  - `GET /api/marketing/contacts?q=&stage=&source=&city=&page=` → `{ docs: Contact[], totalDocs, page, totalPages }`
  - `GET /api/marketing/contacts/[contactId]` → `{ contact, interactions: Interaction[], audit: AuditRow[] }`
  - `POST /api/marketing/contacts` → 202 `{ contactId, eventId }`; `PATCH .../[contactId]` → 202; `POST .../consent` → 202; `POST .../interactions` → 202; `POST .../erase` → 202 (admin only)

- [ ] **Step 1: Write the failing schema/shape tests** — `tests/unit/api/marketing-contacts.test.ts` (route-module-level: import the zod schemas exported from the route files and assert contracts; full request-cycle testing belongs to int tests):

```typescript
import { describe, test, expect } from 'vitest'
import { CreateContactSchema, SetConsentSchema, LogInteractionSchema } from '@/lib/schemas/marketing'

describe('marketing command schemas', () => {
  test('create requires mobile or email', () => {
    expect(CreateContactSchema.safeParse({ first_name: 'J' }).success).toBe(false)
    expect(CreateContactSchema.safeParse({ mobile: '0400000001' }).success).toBe(true)
  })
  test('consent requires method', () => {
    expect(SetConsentSchema.safeParse({ granted: true }).success).toBe(false)
    expect(SetConsentSchema.safeParse({ granted: false, method: 'staff_request', channels: ['sms'] }).success).toBe(true)
  })
  test('interaction requires kind and source_system defaults to crm', () => {
    const r = LogInteractionSchema.safeParse({ kind: 'note', body: 'called them' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.source_system).toBe('crm')
  })
})
```

- [ ] **Step 2: Implement** — `src/lib/schemas/marketing.ts` (zod: `CreateContactSchema` = intake fields minus consent-required, `.refine` mobile-or-email; `UpdateContactSchema` = partial asserted fields; `SetConsentSchema` = `{ granted: boolean, channels: string[] default ['sms'], method: string, evidence?: string }`; `LogInteractionSchema` = `{ kind: enum(['note','message_out','message_in']), channel?, direction?, subject?, body?, occurred_at?, source_system: default 'crm', metadata? }`).

Routes all follow the write-off command pattern (auth → zod → gRPC → 202). Example `.../consent/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing } from '@/lib/access'
import { SetConsentSchema } from '@/lib/schemas/marketing'
import { setConsent } from '@/server/marketing-grpc-client'

export async function POST(request: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  const auth = await requireAuth(canMarketing)
  if ('error' in auth) return auth.error
  const { contactId } = await params
  const parsed = SetConsentSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid consent payload', details: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    )
  }
  try {
    const result = await setConsent({
      idempotency_key: `consent:${contactId}:${Date.now()}`,
      contact_id: contactId,
      granted: parsed.data.granted,
      channels: parsed.data.channels,
      method: parsed.data.method,
      evidence: parsed.data.evidence ?? '',
      actor: String(auth.user.id),
    })
    return NextResponse.json({ contactId, eventId: result.eventId }, { status: 202 })
  } catch (e) {
    console.error('[Marketing Consent] gRPC error:', e)
    return NextResponse.json(
      { error: { code: 'COMMAND_FAILED', message: 'Consent update failed. Please retry.' } },
      { status: 503 },
    )
  }
}
```

POST create / PATCH update / POST interactions are identical in shape (create uses `upsertContact` with `waitlist: false`, `actor: String(user.id)`; erase route guards `requireAuth(isAdmin)` and calls `eraseContact`). Read routes use the Payload local API with `overrideAccess: false` + `user` so collection access applies:

```typescript
// GET /api/marketing/contacts
const auth = await requireAuth(canReadMarketing)
if ('error' in auth) return auth.error
const { payload, user } = auth
const sp = request.nextUrl.searchParams
const where: Record<string, unknown> = {}
if (sp.get('stage')) where.derivedStage = { equals: sp.get('stage') }
if (sp.get('source')) where.source = { equals: sp.get('source') }
if (sp.get('city')) where.city = { like: sp.get('city') }
if (sp.get('q'))
  where.or = [
    { firstName: { like: sp.get('q') } },
    { email: { like: sp.get('q') } },
    { mobileE164: { like: sp.get('q') } },
  ]
const result = await payload.find({
  collection: 'contacts',
  where: where as never,
  page: Number(sp.get('page') ?? 1),
  limit: 50,
  sort: '-updatedAt',
  overrideAccess: false,
  user,
})
return NextResponse.json(result)
```

Detail GET fetches the contact by `contactId` field, plus `payload.find({ collection: 'interactions', where: { contactIdString: { equals: contactId } }, sort: '-occurredAt', limit: 100, overrideAccess: false, user })` and the same for `contact-audit-log`.

- [ ] **Step 3: Run tests** — schema tests PASS; `pnpm lint` clean.

- [ ] **Step 4: Commit** — `git add src/lib/schemas/marketing.ts src/app/api/marketing tests/unit/api/marketing-contacts.test.ts && git commit -m "feat(marketing): staff command + read API routes"`

### Task C6: Marketing admin view (grid + contact timeline) + nav

**Files:**
- Create: `src/hooks/queries/useMarketingContacts.ts`, `src/hooks/queries/useMarketingContact.ts`
- Modify: `src/hooks/queries/index.ts` (barrel), `src/hooks/index.ts` if it re-exports queries
- Create: `src/components/MarketingView/{MarketingViewWithTemplate.tsx,MarketingView.tsx,ContactDetail.tsx,styles.module.css}`
- Create: `src/components/navigation/NavMarketingLink/{index.tsx,styles.module.css}`; modify `src/components/navigation/index.ts`
- Modify: `src/payload.config.ts` (views + beforeNavLinks)
- Test: `tests/unit/hooks/useMarketingContacts.test.ts`

**Interfaces:**
- Consumes: C5 read routes.
- Produces: admin view at `/admin/marketing` and `/admin/marketing/contacts/<contactId>`; nav link "Marketing".

- [ ] **Step 1: Write the failing hook test** — `tests/unit/hooks/useMarketingContacts.test.ts` (mirror `useLoanAccountSearch.test.ts` style):

```typescript
import { describe, test, expect } from 'vitest'

describe('useMarketingContacts', () => {
  test('exports hook + query key factory', async () => {
    const mod = await import('@/hooks/queries/useMarketingContacts')
    expect(typeof mod.useMarketingContacts).toBe('function')
    expect(mod.marketingContactsQueryKey({ stage: 'waitlist' })).toEqual([
      'marketing-contacts',
      'list',
      { stage: 'waitlist' },
    ])
  })
  test('detail hook exports', async () => {
    const mod = await import('@/hooks/queries/useMarketingContact')
    expect(typeof mod.useMarketingContact).toBe('function')
    expect(mod.marketingContactQueryKey('c-1')).toEqual(['marketing-contacts', 'detail', 'c-1'])
  })
})
```

- [ ] **Step 2: Implement hooks** — `useMarketingContacts.ts` (filters object `{ q?, stage?, source?, city?, page? }` → query string → `GET /api/marketing/contacts`, `credentials: 'include'`, `placeholderData: (prev) => prev`, `refetchInterval: 30_000`); `useMarketingContact.ts` (detail, `enabled: !!contactId`). Both export `*QueryKey` factories as shown in the test; add barrel lines to `src/hooks/queries/index.ts`.

- [ ] **Step 3: Implement view** —

`MarketingViewWithTemplate.tsx` (mirror ServicingViewWithTemplate verbatim shape):

```tsx
import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { canReadMarketing } from '@/lib/access'
import { MarketingView } from './MarketingView'

export async function MarketingViewWithTemplate({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) {
  if (!initPageResult?.req?.user) {
    redirect('/admin/login?invalidate')
  }
  if (!canReadMarketing(initPageResult.req.user)) {
    redirect('/admin')
  }
  const resolvedParams = await params
  const segments = resolvedParams?.segments as string[] | undefined
  // /marketing → grid; /marketing/contacts/<id> → detail
  const contactId = segments?.[1] === 'contacts' ? (segments?.[2] ?? '') : ''

  return (
    <DefaultTemplate
      i18n={initPageResult.req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={initPageResult.req.payload}
      permissions={initPageResult.permissions}
      searchParams={searchParams}
      user={initPageResult.req.user}
      visibleEntities={initPageResult.visibleEntities}
    >
      <MarketingView contactId={contactId} />
    </DefaultTemplate>
  )
}

export default MarketingViewWithTemplate
```

`MarketingView.tsx` (`'use client'`): if `contactId` render `<ContactDetail contactId={contactId} />`; else the grid — search input + three `<select>` filters (stage/source/city) + table (Name | Mobile | Stage | Source | Consent | Updated) from `useMarketingContacts(filters)`, each row a `Link` to `/admin/marketing/contacts/${contact.contactId}`; pagination via page buttons. **Fixed-layout rule** (user preference): every cell renders a placeholder (`—`) when data is absent — no conditional reflow.

`ContactDetail.tsx` (`'use client'`): `useMarketingContact(contactId)`; header (name, mobile, email, stage badge, consent badge showing `consent.marketing.granted`, linked-customer badge when `customerId` set); two-column body — left: interactions timeline reverse-chron (kind icon, occurredAt via `src/lib/formatters.ts` date formatter, subject/body), right: fixed panels Consent history (from audit rows filtered to consent events), Referral (referralCode + referredByContactId), Loan status (`loanStatus ?? '—'`), Audit (last 10 audit rows). A "Log note" button posting to the C5 interactions route via a small `useMutation` + query invalidation is included; other commands are Phase-1-optional UI (routes exist).

`NavMarketingLink/index.tsx` — copy NavDashboardLink verbatim, href `/admin/marketing`, icon `📣`, label `Marketing`, active when `pathname.startsWith('/admin/marketing')`. Register: barrel export; `payload.config.ts` views entry:

```typescript
marketing: {
  Component: '@/components/MarketingView/MarketingViewWithTemplate#MarketingViewWithTemplate',
  path: '/marketing/:segments*',
},
```

plus `'@/components/navigation/NavMarketingLink#NavMarketingLink'` in `beforeNavLinks`.

- [ ] **Step 4: Regenerate import map + run tests**

```bash
pnpm generate:importmap
pnpm exec vitest run tests/unit/hooks/useMarketingContacts.test.ts --config ./vitest.config.mts
pnpm lint
```

Expected: PASS / clean. Visual check happens in D2's verification pass.

- [ ] **Step 5: Commit** — `git add src/hooks src/components/MarketingView src/components/navigation src/payload.config.ts src/app/\(payload\)/admin/importMap.js tests/unit/hooks && git commit -m "feat(marketing): marketing admin view, contact timeline, nav"`

### Task C7: Waitlist Sheet import script

**Files:**
- Create: `scripts/import_waitlist.py` in **billie-platform-services** (it has the gRPC stubs + SDK locally)
- Test: `tests/marketingService/test_import_waitlist.py`

**Interfaces:**
- Consumes: gRPC `UpsertContact` (A9).
- Produces: CLI `python scripts/import_waitlist.py <csv-path> [--host localhost:50054] [--dry-run]`; CSV columns (from the waitlist capture set): `first_name,postcode,mobile_au,email,utm_source,utm_medium,utm_campaign,utm_content,utm_term,referring_url,landing_page,form_loaded_ts,user_agent`.

- [ ] **Step 1: Failing test** — `tests/marketingService/test_import_waitlist.py`: `row_to_request(row: dict) -> dict` mapping test — `mobile_au` → `mobile`, utm columns folded into `utm_json`, `source` defaults `"organic"` when no `utm_source`, `waitlist=True`, `consent={"granted": True, "channels": ["sms"], "method": "waitlist_form_imported"}`, `idempotency_key=f"import:{mobile or email}"`, `actor="import"`. Assert a row with neither mobile nor email returns `None` (skipped + counted).

- [ ] **Step 2: Implement** — `scripts/import_waitlist.py`: argparse; `csv.DictReader`; `row_to_request` pure function (import-testable); grpc.insecure_channel → `MarketingServiceStub`; loop rows calling `UpsertContact`, print summary `imported=N updated=M skipped=K failed=F` (failures collected and re-printed at end; non-zero exit if any). `--dry-run` prints mapped requests without calling.

- [ ] **Step 3: Run test** — `python -m pytest tests/marketingService/test_import_waitlist.py -v` → PASS.

- [ ] **Step 4: Commit** (platform repo) — `git add scripts/import_waitlist.py tests/marketingService/test_import_waitlist.py && git commit -m "feat(marketing): one-off waitlist Sheet import via gRPC"`

---

## Part D — Publish, integrate, verify

### Task D1: Publish `marketing` SDK to billie-event-sdks + pin in CRM

**Files:**
- billie-event-sdks repo (bootstrap path), CRM `event-processor/requirements.txt`

- [ ] **Step 1:** Invoke the platform repo's `bump-event-sdk` skill/runbook (`.claude/skills/bump-event-sdk/SKILL.md`) for package `marketing`, version `0.1.0`, bootstrap path — it covers mirror, CHANGELOG, tag `marketing-v0.1.0`, GitHub release. STOP and report if `gh auth status` fails.
- [ ] **Step 2:** In the CRM worktree, uncomment/finalise the requirements line from C3 Step 1:

```
git+https://x-access-token:${GITHUB_TOKEN}@github.com/BillieLoans/billie-event-sdks.git@marketing-v0.1.0#subdirectory=packages/marketing
```

- [ ] **Step 3: Commit** (CRM) — `git add event-processor/requirements.txt && git commit -m "chore(marketing): pin billie-marketing-events v0.1.0"`

### Task D2: Full verification sweep + wrap-up

- [ ] **Step 1: platform** — `python -m pytest tests packages/marketing/tests -x -q` (full suite, no regressions) + `ruff check .`
- [ ] **Step 2: billieChat** — router test suite (whatever B1 Step 3 identified) green.
- [ ] **Step 3: CRM** — `pnpm test:int` (or targeted vitest configs if the full suite is slow: all `tests/unit` + the marketing int spec) + `cd event-processor && PYTHONPATH=src python -m pytest tests -q` + `pnpm lint` + `pnpm build` (catches importMap/type breaks).
- [ ] **Step 4: End-to-end smoke (local, optional but recommended)** — with local Redis + Postgres: run `alembic upgrade head`, start `MarketingService` + gRPC server, POST a signed request to `/api/intake/waitlist` (dev server), verify: `marketing.contact` row exists, `chatLedger` contains `contact.observed.v1`, and (with the processor running) a `contacts` row lands in the CRM DB.
- [ ] **Step 5:** Report: branch names + commit lists for all three repos + billie-event-sdks, test results, and the flagged items that need human follow-up (billieChat env config parity beyond dev; Fly env vars `MARKETING_GRPC_PORT`/`MARKETING_GRPC_ADDRESS`/`INTAKE_API_KEY`/`INTAKE_HMAC_SECRET`; website `/r/{code}` + form `ref` param; Looker dashboard-feed route deferred to Phase 2 per spec).

---

## Plan self-review notes

- **Spec coverage (Phase 1 list, spec §10):** SDK ✅ A1–A3; marketingService core ✅ A5–A10; broker routes ✅ B1; Alembic ✅ A4; CRM intake + fallback ✅ C4; projections + processor + Payload migration ✅ C2–C3; marketing role ✅ C1; marketing view ✅ C6; linking ✅ A8 (matcher + identity repoint); referral codes minted ✅ A6/A9; Sheet import ✅ C7. Deliberately NOT in Phase 1 (per spec): outbound sends, batches, feedback UI + feedback intake route, dashboard feed, referral attribution, state projection, webhooks. The `dashboard-feed` and `intake/feedback` routes named in spec §5.3 are Phase 2 deliverables (feedback capture and dashboard feed sit in spec §10 Phase 2).
- **Type consistency:** `ContactObservedV1` field set is identical in A2 (SDK), A5 (repo columns), A6 (builder), C3 (projection); `contact.intake.requested.v1` payload keys in C4 = `build_contact_observed` cmd keys in A6/A8; gRPC field names in A9 proto = C4 client inputs.
- **Known judgment calls encoded here:** `marketing.contact` upsert converges races on the mobile unique index; email-only match links only when unambiguous; `contact_audit_log` rows are written by the CRM processor (projection-side) from event metadata — the event log itself remains the authoritative audit.

