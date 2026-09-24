"""BTB-392 (customer data ownership SP4): the platform's 3.x
``customer.changed.v1`` through the CRM projection.

Task 1 — the customers SDK re-pin to 3.1.0 parses the platform's real payload
(provenance tiers, ``contacts``, ``customer_id_status``) and the six legacy
columns upsert exactly as before.
"""

from __future__ import annotations

import json
import sys
import types
from typing import Any

import pytest
from billie_customers_events import ContactTier, CustomerIdStatus

from billie_servicing.handlers.customer import handle_customer_changed

NOW = "2026-09-23T13:15:00Z"


def platform_changed_payload(**overrides: Any) -> dict[str, Any]:
    """A ``customer.changed.v1`` payload as customerService publishes it since
    SDK 3.0.0 (this one is the reconciliation's shape: ``changed_by``
    ``reconciliation``, two EMAIL records, one MOBILE)."""
    payload: dict[str, Any] = {
        "customer_id": "23D47AB2",
        "event_id": "evt_88b5e40bdb174a5c9f03db3a119f23a0",
        "changed_at": NOW,
        "changed_by": "reconciliation",
        "first_name": "Rohan",
        "last_name": "Sharp",
        "date_of_birth": "1980-01-02",
        "email_address": "rohansharp+6@gmail.com",
        "mobile_phone_number": "0412345678",
        "ekyc_status": "APPROVED",
        "canonical_id": "23D47AB2",
        "customer_id_status": "ADMITTED",
        "email_tier": "BOUND",
        "email_source": "ZITADEL_LOGIN",
        "email_verified_at": NOW,
        "mobile_phone_tier": "VERIFIED",
        "mobile_phone_source": "OTP_SMS",
        "mobile_phone_verified_at": NOW,
        "contacts": [
            {
                "contact_type": "EMAIL",
                "value": "rohansharp+6@gmail.com",
                "tier": "BOUND",
                "source": "ZITADEL_LOGIN",
                "is_primary": True,
                "verified_at": NOW,
                "first_seen_at": NOW,
                "last_seen_at": NOW,
                "origin_customer_id": "23D47AB2",
            },
            {
                "contact_type": "EMAIL",
                "value": "rohan.sharp@example.com",
                "tier": "ASSERTED",
                "source": "CHAT_ASSERTED",
                "is_primary": False,
                "first_seen_at": NOW,
                "last_seen_at": NOW,
                "origin_customer_id": "258DE915",
            },
            {
                "contact_type": "MOBILE",
                "value": "0412345678",
                "tier": "VERIFIED",
                "source": "OTP_SMS",
                "is_primary": True,
                "verified_at": NOW,
                "first_seen_at": NOW,
                "last_seen_at": NOW,
                "origin_customer_id": "23D47AB2",
            },
        ],
    }
    payload.update(overrides)
    return payload


def legacy_changed_payload() -> dict[str, Any]:
    """The 2.x shape billieChat forged before the cut-over (no provenance)."""
    return {
        "customer_id": "J0URN3Y1",
        "event_id": "evt_legacy",
        "changed_at": NOW,
        "first_name": "Jane",
        "last_name": "Doe",
        "email_address": "jane@example.com",
        "mobile_phone_number": "0400000000",
    }


def envelope(payload: dict[str, Any], *, as_json_string: bool = False) -> dict[str, Any]:
    """The broker's sanitized envelope for a customerService event."""
    return {
        "conv": "conv-1",
        "agt": "customerService",
        "usr": payload["customer_id"],
        "seq": 1,
        "cls": "msg",
        "typ": "customer.changed.v1",
        "payload": json.dumps(payload) if as_json_string else payload,
    }


@pytest.fixture
def make_processor(monkeypatch):
    """An EventProcessor with the optional SDKs stubbed (mirrors
    tests/test_processor_routing.py)."""
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


# ---------------------------------------------------------------------------
# Task 1 — SDK 3.1.0 parses the platform's payload; legacy columns unchanged
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("as_json_string", [False, True])
def test_platform_payload_parses_with_provenance(make_processor, as_json_string):
    parsed = make_processor._parse_event(
        "customer.changed.v1", envelope(platform_changed_payload(), as_json_string=as_json_string)
    )
    payload = parsed.payload
    assert payload.customer_id == "23D47AB2"
    assert payload.email_tier is ContactTier.BOUND
    assert payload.mobile_phone_tier is ContactTier.VERIFIED
    assert payload.customer_id_status is CustomerIdStatus.ADMITTED
    assert payload.canonical_id == "23D47AB2"
    assert [c.value for c in payload.contacts if c.is_primary] == [
        "rohansharp+6@gmail.com",
        "0412345678",
    ]


def test_legacy_payload_still_parses(make_processor):
    parsed = make_processor._parse_event("customer.changed.v1", envelope(legacy_changed_payload()))
    assert parsed.payload.email_address == "jane@example.com"
    assert parsed.payload.email_tier is None
    assert parsed.payload.contacts is None


@pytest.mark.asyncio
async def test_platform_payload_upserts_legacy_columns_unchanged(make_processor, mock_pool):
    parsed = make_processor._parse_event("customer.changed.v1", envelope(platform_changed_payload()))

    await handle_customer_changed(mock_pool, parsed)

    doc = mock_pool.last_insert("customers")
    assert doc is not None
    assert doc["customer_id"] == "23D47AB2"
    assert doc["first_name"] == "Rohan"
    assert doc["last_name"] == "Sharp"
    assert doc["full_name"] == "Rohan Sharp"
    assert doc["email_address"] == "rohansharp+6@gmail.com"
    assert doc["mobile_phone_number"] == "0412345678"
    assert doc["ekyc_status"] == "successful"
    call = mock_pool.calls_against("customers")[-1]
    assert call.op == "INSERT"
    assert call.conflict_columns == ["customer_id"]
