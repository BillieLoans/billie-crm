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


def test_other_application_events_still_use_customers_sdk(make_processor):
    # Precedence guard: a different application.* type must NOT be captured by the
    # exact-match reapplication_blocked branch — it stays on the customers-SDK
    # branch, which raises on this bogus envelope. That it raises proves routing.
    proc = make_processor
    with pytest.raises(Exception):
        proc._parse_event(
            "application.something_else.v1", {"typ": "application.something_else.v1"}
        )
