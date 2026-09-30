"""BTB-392 (SP4 Task 6): identity.resolver.assessed.v1 and
identity.review.opened.v1 projected onto conversations.identity_resolution."""

from __future__ import annotations

import json

import pytest

from billie_servicing.handlers.identity_resolution import (
    RESOLVER_FIELDS,
    REVIEW_FIELDS,
    handle_identity_resolver_assessed,
    handle_identity_review_opened,
)


def _assessed(event_id: str = "1758700000000-0", **overrides):
    payload = {
        "journey_id": "J1",
        "candidate_id": "23D47AB2",
        "verdict": "SAME_PERSON",
        "confidence": 0.91,
        "factors": ["name_exact", "dob_exact", "address_same_street"],
        "mode": "shadow",
        "applied": False,
        "platform_reason_code": "MIDDLE_BAND",
        "latency_ms": 2140,
        "model": "gpt-5.4",
        # never stored — the PII fence
        "applicant_name": "Rohan Sharp",
        "email": "rohansharp+6@gmail.com",
    }
    payload.update(overrides)
    return {
        "id": event_id,
        "conv": "conv-J1",
        "usr": "J1",
        "agt": "identityRecognition",
        "typ": "identity.resolver.assessed.v1",
        "ts": "2026-09-24T02:00:00Z",
        "payload": payload,
    }


def _review():
    return {
        "id": "1758700001000-0",
        "conv": "conv-J1",
        "usr": "J1",
        "typ": "identity.review.opened.v1",
        "payload": json.dumps(
            {
                "case_id": "case-1",
                "journey_id": "J1",
                "conversation_id": "conv-J1",
                "band": "REVIEW",
                "posterior": 0.63,
                "flags": ["ADDRESS_ONLY"],
                "candidate_ids": ["23D47AB2"],
                "per_signal_bits": {"name": 4.1, "dob": 6.2},
                "recommendation": "resolver",
                "disposition": "resolver_same_person",
                "related_journeys": [],
                "opened_at": "2026-09-24T02:00:01Z",
                "notes": "free text that must not be stored",
            }
        ),
    }


def _entry_calls(mock_pool):
    return [
        c
        for c in mock_pool.calls_against("conversations")
        if c.op == "UPDATE" and "jsonb_set" in c.sql
    ]


@pytest.mark.asyncio
async def test_assessed_lands_one_entry_keyed_by_event_id(mock_pool):
    await handle_identity_resolver_assessed(mock_pool, _assessed())

    # Row ensured first (an event that beats conversation_started still lands).
    ins = mock_pool.last_insert("conversations")
    assert ins["conversation_id"] == "conv-J1"

    calls = _entry_calls(mock_pool)
    assert len(calls) == 1
    entry_key, patch_json, key_value = calls[0].args
    assert entry_key == "resolver_assessments"
    assert key_value == "conv-J1"
    patch = json.loads(patch_json)
    assert list(patch) == ["1758700000000-0"]
    entry = patch["1758700000000-0"]
    assert entry["verdict"] == "SAME_PERSON"
    assert entry["confidence"] == 0.91
    assert entry["mode"] == "shadow" and entry["applied"] is False
    assert entry["platform_reason_code"] == "MIDDLE_BAND"
    assert entry["assessed_at"] == "2026-09-24T02:00:00Z"
    assert entry["event_id"] == "1758700000000-0"


@pytest.mark.asyncio
async def test_assessed_stores_only_allow_listed_keys(mock_pool):
    """The PII fence: nothing outside RESOLVER_FIELDS (+ event_id, assessed_at)."""
    await handle_identity_resolver_assessed(mock_pool, _assessed())

    entry = json.loads(_entry_calls(mock_pool)[0].args[1])["1758700000000-0"]
    assert set(entry) <= set(RESOLVER_FIELDS) | {"event_id", "assessed_at"}
    assert "applicant_name" not in entry and "email" not in entry


@pytest.mark.asyncio
async def test_redelivery_replaces_its_own_entry(mock_pool):
    await handle_identity_resolver_assessed(mock_pool, _assessed())
    await handle_identity_resolver_assessed(mock_pool, _assessed())

    calls = _entry_calls(mock_pool)
    assert len(calls) == 2
    # Same entry key both times → jsonb_set replaces, never appends.
    assert {json.loads(c.args[1]).popitem()[0] for c in calls} == {"1758700000000-0"}


@pytest.mark.asyncio
async def test_two_assessments_land_under_distinct_keys(mock_pool):
    await handle_identity_resolver_assessed(mock_pool, _assessed("1758700000000-0"))
    await handle_identity_resolver_assessed(
        mock_pool, _assessed("1758700005000-0", verdict="CANNOT_DECIDE", confidence=0.4)
    )

    keys = [json.loads(c.args[1]).popitem()[0] for c in _entry_calls(mock_pool)]
    assert keys == ["1758700000000-0", "1758700005000-0"]


@pytest.mark.asyncio
async def test_assessed_without_conversation_is_skipped_not_raised(mock_pool):
    event = _assessed()
    event.pop("conv")

    await handle_identity_resolver_assessed(mock_pool, event)

    assert not mock_pool.has_call_against("conversations")


@pytest.mark.asyncio
async def test_review_opened_sets_review_case(mock_pool):
    await handle_identity_review_opened(mock_pool, _review())

    patch = mock_pool.last_jsonb_merge("conversations", "identity_resolution")
    case = patch["review_case"]
    assert case["case_id"] == "case-1"
    assert case["band"] == "REVIEW" and case["posterior"] == 0.63
    assert case["candidate_ids"] == ["23D47AB2"]
    assert case["disposition"] == "resolver_same_person"
    assert case["opened_at"] == "2026-09-24T02:00:01Z"
    assert set(case) <= set(REVIEW_FIELDS) | {"event_id", "opened_at"}
    assert "notes" not in case and "conversation_id" not in case
    ins = mock_pool.last_insert("conversations")
    assert ins["conversation_id"] == "conv-J1"
