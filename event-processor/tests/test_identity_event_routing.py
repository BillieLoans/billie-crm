"""BTB-392: every identity event billieChat routes to the CRM is either
handled or deliberately skipped — and none of them goes through the typed
customers-SDK parser.

Routed (billieChat routes.json → ${agent_billie-crm}):
  handled  identity.resolver.assessed.v1, identity.review.opened.v1
  skipped  identity.created.v1, customer.session.authenticated.v1,
           customer.contact.verified.v1  (nothing to project)
"""

from __future__ import annotations

import ast
import sys
import types
from pathlib import Path

import pytest

import billie_servicing.handlers as handlers_pkg

_MAIN_PY = Path(handlers_pkg.__file__).parent.parent / "main.py"

HANDLED = {
    "identity.resolver.assessed.v1": "handle_identity_resolver_assessed",
    "identity.review.opened.v1": "handle_identity_review_opened",
}
SKIPPED = (
    "identity.created.v1",
    "customer.session.authenticated.v1",
    "customer.contact.verified.v1",
)


def _registrations() -> dict[str, str]:
    """{event type: handler name} from main.py's register_handler calls."""
    tree = ast.parse(_MAIN_PY.read_text())
    found: dict[str, str] = {}
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "register_handler"
            and len(node.args) == 2
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[1], ast.Name)
        ):
            found[node.args[0].value] = node.args[1].id
    return found


def test_routed_identity_events_are_handled_or_deliberately_skipped():
    registrations = _registrations()
    for event_type, handler in HANDLED.items():
        assert registrations.get(event_type) == handler, event_type
        assert hasattr(handlers_pkg, handler)
    for event_type in SKIPPED:
        assert event_type not in registrations, f"{event_type} unexpectedly handled"


@pytest.fixture
def make_processor(monkeypatch):
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


@pytest.mark.parametrize("event_type", list(HANDLED))
def test_identity_events_parse_via_the_envelope_path(make_processor, event_type):
    """A plain JSON payload — never the customers SDK's strict allowlist."""
    parsed = make_processor._parse_event(
        event_type,
        {
            "conv": "conv-1",
            "usr": "J1",
            "typ": event_type,
            "payload": '{"journey_id": "J1", "verdict": "SAME_PERSON"}',
        },
    )
    assert isinstance(parsed, dict)
    assert parsed["typ"] == event_type
