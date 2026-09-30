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


def test_login_email_rebound_reaches_its_handler_as_a_dict(make_processor):
    """SP5: customer.login_email.rebound.v1 shares the `customer.` prefix but its
    handler reads a plain payload dict. Through the customers-SDK branch it got a
    ParsedEvent object and failed every delivery with "'ParsedEvent' object has
    no attribute 'get'" (demo DLQ, 2026-09-30 02:28)."""
    assert _registrations().get("customer.login_email.rebound.v1") == (
        "handle_customer_login_email_rebound"
    )
    parsed = make_processor._parse_event(
        "customer.login_email.rebound.v1",
        {
            "conv": "4A103C6E",
            "usr": "4A103C6E",
            "typ": "customer.login_email.rebound.v1",
            "payload": (
                '{"customer_id": "4A103C6E", "email_address": "new@example.com", '
                '"zitadel_user_id": "z1", "rebound_at": "2026-09-30T02:24:22.978025Z"}'
            ),
        },
    )
    assert isinstance(parsed, dict)
    assert parsed["typ"] == "customer.login_email.rebound.v1"


@pytest.mark.asyncio
async def test_login_email_rebound_stamps_the_customer_end_to_end(make_processor, mock_pool):
    """Parse → handler, as the processor runs it: the stamp is written."""
    from billie_servicing.handlers import handle_customer_login_email_rebound

    parsed = make_processor._parse_event(
        "customer.login_email.rebound.v1",
        {
            "conv": "4A103C6E",
            "usr": "4A103C6E",
            "typ": "customer.login_email.rebound.v1",
            "payload": (
                '{"customer_id": "4A103C6E", "email_address": "new@example.com", '
                '"zitadel_user_id": "z1", "rebound_at": "2026-09-30T02:24:22.978025Z"}'
            ),
        },
    )
    await handle_customer_login_email_rebound(mock_pool, parsed)
    stamp = mock_pool.last_update("customers")
    assert stamp is not None and stamp["login_email_rebound_at"] is not None
