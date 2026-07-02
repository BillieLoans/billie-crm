"""Routing regression for `_parse_event`.

`application.reapplication_blocked.v1` is an agent-emitted event with a plain
JSON payload. The `application.` prefix would otherwise capture it into the
customers-SDK branch (`parse_customer_message`), which raises
EventValidationError on it — so the message would DLQ and the handler (which
expects a dict) would never run. It must parse via the envelope path instead.
"""

import json
import sys
import types

import pytest


@pytest.fixture
def make_processor(monkeypatch):
    # The notifications/aging Billie SDKs aren't installed in the local dev venv;
    # the processor imports them at module load. Stub the missing ones so the
    # module imports cleanly (mirrors tests/test_processor_dedup.py).
    if "billie_notifications_events" not in sys.modules:
        parent = types.ModuleType("billie_notifications_events")
        submod = types.ModuleType("billie_notifications_events.parser")
        submod.parse_notification_event = lambda *a, **k: None
        parent.parser = submod
        monkeypatch.setitem(sys.modules, "billie_notifications_events", parent)
        monkeypatch.setitem(sys.modules, "billie_notifications_events.parser", submod)
    if "billie_aging_events" not in sys.modules:
        aging = types.ModuleType("billie_aging_events")
        aging.parse_aging_event = lambda *a, **k: None
        monkeypatch.setitem(sys.modules, "billie_aging_events", aging)

    import billie_servicing.processor as procmod

    monkeypatch.setattr(procmod, "_check_tls_urls", lambda *a, **k: None)
    return procmod.EventProcessor(
        redis_url="redis://localhost:6379",
        database_uri="postgresql://localhost/test",
    )


def test_reapplication_blocked_routes_to_envelope_dict(make_processor):
    proc = make_processor
    payload = {"application_number": "A1", "reason": "ID_VERIFICATION", "conversation_id": "c1"}
    sanitized = {
        "typ": "application.reapplication_blocked.v1",
        "usr": "4A8C91AB",
        "conv": "c1",
        # payload arrives as a JSON string on the Redis stream
        "payload": json.dumps(payload),
    }

    parsed = proc._parse_event("application.reapplication_blocked.v1", sanitized)

    # Envelope path returns a plain dict (not a customers-SDK ParsedEvent) and
    # decodes the payload JSON string to a dict for the handler.
    assert isinstance(parsed, dict)
    assert parsed["typ"] == "application.reapplication_blocked.v1"
    assert parsed["payload"]["reason"] == "ID_VERIFICATION"
    assert parsed["payload"]["application_number"] == "A1"


def test_aging_event_drops_billiechat_rec_routing_field(make_processor, monkeypatch):
    """`rec` is a billieChat routing field (a recipients list) the aging
    projection never reads. The aging SDK envelope mistypes it as `str`, so the
    sanitized list value (`[]` for broadcast scheduler events) fails Pydantic
    validation and DLQs *every* aging event. The processor must not hand `rec`
    to the aging parser — it should fall back to the SDK's "" default.
    """
    import billie_servicing.processor as procmod

    captured: dict = {}

    def _capture(data):
        captured["data"] = data
        return None

    monkeypatch.setattr(procmod, "parse_aging_event", _capture)

    proc = make_processor
    sanitized = {
        "typ": "loan.aging.updated.v1",
        "conv": "c1",
        # the broker sends `rec` as a JSON-string list (broadcast => [])
        "rec": "[]",
        "payload": json.dumps(
            {
                "event_id": "age_1",
                "timestamp": "2026-06-17T00:01:00Z",
                "account_id": "acc_1",
                "dpd": 2,
                "bucket": "early_arrears",
            }
        ),
    }

    proc._parse_event("loan.aging.updated.v1", sanitized)

    # `rec` must not reach the aging SDK as a list — its str-typed envelope
    # rejects it. The payload (what the handler actually reads) is untouched.
    assert not isinstance(captured["data"].get("rec"), list)
    assert captured["data"]["payload"]["account_id"] == "acc_1"


def test_other_application_events_still_use_customers_sdk(make_processor):
    # Precedence guard: a different application.* type must NOT be captured by the
    # exact-match reapplication_blocked branch — it stays on the customers-SDK
    # branch, which raises on this bogus envelope. That it raises proves routing.
    proc = make_processor
    with pytest.raises(Exception):
        proc._parse_event(
            "application.something_else.v1", {"typ": "application.something_else.v1"}
        )


# ---------------------------------------------------------------------------
# Collection case events (Stream D / BTB-199) — collectionsService → ChatLedger.
# The billie_collection_events SDK ships flat pydantic models but no parser, so
# the processor maps event-type → model and validates the payload.
# ---------------------------------------------------------------------------

COLLECTION_EVENT_TYPES = [
    "collection.case.opened.v1",
    "collection.case.exhausted.v1",
    "collection.case.cured.v1",
    "collection.case.hardship_paused.v1",
    "collection.case.resumed.v1",
    "collection.case.stop_contact_applied.v1",
    "collection.case.step_advanced.v1",
]


def test_collection_handlers_registered(make_processor):
    """setup_handlers wires a handler for each of the six collection.case.* types."""
    from billie_servicing.main import setup_handlers

    proc = make_processor
    setup_handlers(proc)
    for event_type in COLLECTION_EVENT_TYPES:
        assert event_type in proc.handlers, f"{event_type} not registered"


def _stub_collection_models(monkeypatch):
    """Inject a fake billie_collection_events.models (the SDK isn't in the venv).

    Each model's model_validate echoes the payload tagged with the class name so
    routing can be asserted without the real SDK.
    """
    models = types.ModuleType("billie_collection_events.models")

    def _make(name):
        class _M:
            _name = name

            @classmethod
            def model_validate(cls, data):
                return {"__model__": cls._name, **data}

        _M.__name__ = name
        return _M

    for cls_name in [
        "CollectionCaseOpenedV1",
        "CollectionCaseExhaustedV1",
        "CollectionCaseCuredV1",
        "CollectionCaseHardshipPausedV1",
        "CollectionCaseResumedV1",
        "CollectionCaseStopContactAppliedV1",
        "CollectionCaseStepAdvancedV1",
    ]:
        setattr(models, cls_name, _make(cls_name))

    parent = types.ModuleType("billie_collection_events")
    monkeypatch.setitem(sys.modules, "billie_collection_events", parent)
    monkeypatch.setitem(sys.modules, "billie_collection_events.models", models)


def test_collection_event_routes_to_typed_model(make_processor, monkeypatch):
    _stub_collection_models(monkeypatch)
    proc = make_processor
    sanitized = {
        "typ": "collection.case.opened.v1",
        "conv": "c1",
        "payload": json.dumps(
            {
                "event_id": "evt_1",
                "timestamp": "2026-06-01T00:00:00Z",
                "account_id": "acc_1",
                "correlation_id": "corr_1",
                "customer_id": "cust_1",
                "overdue_amount": "312.40",
                "due_date": "2026-05-20",
            }
        ),
    }

    parsed = proc._parse_event("collection.case.opened.v1", sanitized)

    # Routed to the opened model (not the envelope-dict fallback), payload validated.
    assert parsed["__model__"] == "CollectionCaseOpenedV1"
    assert parsed["account_id"] == "acc_1"
    assert parsed["customer_id"] == "cust_1"


def test_collection_exhausted_routes_to_its_model(make_processor, monkeypatch):
    _stub_collection_models(monkeypatch)
    proc = make_processor
    sanitized = {
        "typ": "collection.case.exhausted.v1",
        "payload": json.dumps(
            {
                "event_id": "evt_2",
                "timestamp": "2026-06-19T00:00:00Z",
                "account_id": "acc_1",
                "customer_id": "cust_1",
                "overdue_amount": "540.00",
                "days_overdue": 45,
                "last_step": 5,
            }
        ),
    }

    parsed = proc._parse_event("collection.case.exhausted.v1", sanitized)

    assert parsed["__model__"] == "CollectionCaseExhaustedV1"
    assert parsed["days_overdue"] == 45


def test_collection_step_advanced_routes_to_its_model(make_processor, monkeypatch):
    """collection.case.step_advanced.v1 (SDK 0.3.0) -> CollectionCaseStepAdvancedV1."""
    _stub_collection_models(monkeypatch)
    proc = make_processor
    sanitized = {
        "typ": "collection.case.step_advanced.v1",
        "payload": json.dumps(
            {
                "event_id": "evt_3",
                "timestamp": "2026-06-20T00:00:00Z",
                "account_id": "acc_1",
                "correlation_id": "corr_1",
                "customer_id": "cust_1",
                "step": 3,
                "channel": "sms",
                "template": "reminder_3",
                "advanced_at": "2026-06-20T00:00:00Z",
            }
        ),
    }

    parsed = proc._parse_event("collection.case.step_advanced.v1", sanitized)

    assert parsed["__model__"] == "CollectionCaseStepAdvancedV1"
    assert parsed["account_id"] == "acc_1"
    assert parsed["step"] == 3
