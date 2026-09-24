"""BTB-120: customer.identity.linked/merged.v1 re-attribution in the CRM
event processor (AC-C1/AC-C2/AC-C3/AC-C4)."""
from __future__ import annotations

import json

import pytest

from billie_servicing.handlers.identity import (
    handle_customer_identity_linked,
    handle_customer_identity_merged,
)

# conversations + loan_accounts carry a denormalised customer_id_string column;
# the applications table links to the customer ONLY by the customer_id_id
# relationship (no customer_id_string column exists on it).
_STRING_KEYED_TABLES = ("conversations", "loan_accounts")


def _last_update_call(mock_pool, table):
    updates = [c for c in mock_pool.calls_against(table) if c.op == "UPDATE"]
    return updates[-1] if updates else None


@pytest.mark.asyncio
async def test_linked_reattributes_string_keyed_tables_to_canonical(mock_pool):
    """AC-C2/AC-C3: conversations and loan_accounts move alias→canonical by string."""
    # fetchval 1: canonical ref, fetchval 2: alias ref.
    mock_pool.set_fetchval_sequence(["canonical-ref-uuid", "alias-ref-uuid"])

    event = {
        "typ": "customer.identity.linked.v1",
        "conv": "identity-B",
        "usr": "B",
        "payload": {"journey_id": "B", "canonical_id": "A"},
    }
    await handle_customer_identity_linked(mock_pool, event)

    for table in _STRING_KEYED_TABLES:
        upd = mock_pool.last_update(table)
        assert upd is not None, f"no UPDATE recorded for {table}"
        assert upd["customer_id_string"] == "A"
        assert upd["customer_id_id"] == "canonical-ref-uuid"
        call = _last_update_call(mock_pool, table)
        assert call.where["customer_id_string"] == "B"


@pytest.mark.asyncio
async def test_linked_reattributes_applications_by_ref_not_string(mock_pool):
    """applications has no customer_id_string column — re-point it by the
    customer_id_id relationship. Including it in the string-keyed UPDATE made the
    whole re-attribution transaction raise ``column "customer_id_string" does not
    exist`` and roll back, so nothing moved and the event hit the DLQ.
    """
    # fetchval 1: canonical ref, fetchval 2: alias ref.
    mock_pool.set_fetchval_sequence(["canonical-ref-uuid", "alias-ref-uuid"])

    await handle_customer_identity_linked(
        mock_pool, {"payload": {"journey_id": "B", "canonical_id": "A"}}
    )

    appl = _last_update_call(mock_pool, "applications")
    assert appl is not None, "no UPDATE recorded for applications"
    # Must NEVER reference customer_id_string (the column doesn't exist here).
    assert "customer_id_string" not in appl.values, appl.values
    assert "customer_id_string" not in appl.where, appl.where
    # Re-pointed by the customer_id_id ref (alias ref → canonical ref).
    assert appl.values.get("customer_id_id") == "canonical-ref-uuid"
    assert appl.where.get("customer_id_id") == "alias-ref-uuid"


@pytest.mark.asyncio
async def test_linked_tombstones_alias_customer_row(mock_pool):
    """AC-C2/AC-C4: the orphan customers row is redirected via merged_into."""
    mock_pool.set_fetchval("canonical-ref-uuid")

    await handle_customer_identity_linked(
        mock_pool,
        {"payload": {"journey_id": "B", "canonical_id": "A"}},
    )

    cust = mock_pool.last_update("customers")
    assert cust is not None
    assert cust["merged_into"] == "A"
    call = _last_update_call(mock_pool, "customers")
    assert call.where["customer_id"] == "B"


@pytest.mark.asyncio
async def test_merged_event_folds_dropped_canonical(mock_pool):
    """AC-C1: customer.identity.merged.v1 re-attributes merged_canonical_id."""
    mock_pool.set_fetchval(None)  # canonical row not yet projected

    await handle_customer_identity_merged(
        mock_pool,
        {
            "typ": "customer.identity.merged.v1",
            "payload": {"canonical_id": "A", "merged_canonical_id": "Z"},
        },
    )

    assert mock_pool.last_update("customers")["merged_into"] == "A"
    conv = _last_update_call(mock_pool, "conversations")
    assert conv.where["customer_id_string"] == "Z"
    # customer_id_id is set to NULL when the canonical row isn't projected yet.
    assert conv.values["customer_id_id"] is None


@pytest.mark.asyncio
async def test_self_link_is_noop(mock_pool):
    """AC-B7 mirror: journey == canonical writes nothing."""
    await handle_customer_identity_linked(
        mock_pool, {"payload": {"journey_id": "A", "canonical_id": "A"}}
    )
    assert mock_pool.calls == []


@pytest.mark.asyncio
async def test_missing_ids_is_noop(mock_pool):
    """A malformed payload (no canonical) is a safe no-op."""
    await handle_customer_identity_linked(
        mock_pool, {"payload": {"journey_id": "B"}}
    )
    assert mock_pool.calls == []


@pytest.mark.asyncio
async def test_payload_as_json_string(mock_pool):
    """The payload may arrive as a JSON string; it is still parsed."""
    mock_pool.set_fetchval("ref")
    await handle_customer_identity_linked(
        mock_pool,
        {"payload": json.dumps({"journey_id": "B", "canonical_id": "A"})},
    )
    assert mock_pool.last_update("customers")["merged_into"] == "A"


# ---------------------------------------------------------------------------
# BTB-392 (SP4 Task 5): reversible links — origin ids, link id and reason
# ---------------------------------------------------------------------------


def _updates_to(mock_pool, table):
    return [c for c in mock_pool.calls_against(table) if c.op == "UPDATE"]


@pytest.mark.asyncio
async def test_linked_records_origin_id_on_every_reattributed_table(mock_pool):
    mock_pool.set_fetchval_sequence(["canonical-ref-uuid", "alias-ref-uuid"])

    await handle_customer_identity_linked(
        mock_pool,
        {
            "conv": "conv-B",
            "payload": {
                "journey_id": "B",
                "canonical_id": "A",
                "link_id": "lnk_1",
                "reason": "DOCUMENT_AGREE",
            },
        },
    )

    for table in _STRING_KEYED_TABLES:
        call = _last_update_call(mock_pool, table)
        # First move only: COALESCE keeps an origin a second hop would overwrite.
        assert (
            "identity_origin_customer_id = COALESCE(identity_origin_customer_id, customer_id_string)"
            in call.sql
        )
        assert call.where["customer_id_string"] == "B"
    appl = _last_update_call(mock_pool, "applications")
    assert "identity_origin_customer_id = COALESCE(identity_origin_customer_id, $3)" in appl.sql
    assert appl.args[2] == "B"


@pytest.mark.asyncio
async def test_linked_records_link_id_and_reason_on_the_tombstone(mock_pool):
    mock_pool.set_fetchval_sequence(["canonical-ref-uuid", "alias-ref-uuid"])

    await handle_customer_identity_linked(
        mock_pool,
        {"payload": {"journey_id": "B", "canonical_id": "A", "link_id": "lnk_1", "reason": "SCORED_LINK"}},
    )

    cust = mock_pool.last_update("customers")
    assert cust["merged_into"] == "A"
    assert cust["merged_link_id"] == "lnk_1"
    assert cust["merged_reason"] == "SCORED_LINK"


@pytest.mark.asyncio
async def test_legacy_linked_payload_lands_null_link_id_and_reason(mock_pool):
    """billieChat's pre-cut-over linked.v1 carries neither field."""
    mock_pool.set_fetchval_sequence(["canonical-ref-uuid", "alias-ref-uuid"])

    await handle_customer_identity_linked(
        mock_pool, {"payload": {"journey_id": "B", "canonical_id": "A"}}
    )

    cust = mock_pool.last_update("customers")
    assert cust["merged_into"] == "A"
    assert cust["merged_link_id"] is None
    assert cust["merged_reason"] is None


@pytest.mark.asyncio
async def test_merged_tombstone_carries_the_merged_reason(mock_pool):
    mock_pool.set_fetchval_sequence(["a-ref", "z-ref"])

    await handle_customer_identity_merged(
        mock_pool,
        {"payload": {"canonical_id": "A", "merged_canonical_id": "Z", "link_id": "lnk_9"}},
    )

    cust = mock_pool.last_update("customers")
    assert cust["merged_reason"] == "MERGED"
    assert cust["merged_link_id"] == "lnk_9"


@pytest.mark.asyncio
async def test_linked_writes_the_link_outcome_on_the_journeys_conversations(mock_pool):
    mock_pool.set_fetchval_sequence(["canonical-ref-uuid", "alias-ref-uuid"])

    await handle_customer_identity_linked(
        mock_pool,
        {
            "conv": "conv-B",
            "payload": {
                "journey_id": "B",
                "canonical_id": "A",
                "link_id": "lnk_1",
                "reason": "LOGIN_CONTINUITY",
            },
        },
    )

    merges = mock_pool.jsonb_merges("conversations", "identity_resolution")
    assert len(merges) == 2  # by alias id, and by the envelope's conversation
    for patch in merges:
        link = patch["link"]
        assert link["canonical_id"] == "A"
        assert link["alias_id"] == "B"
        assert link["link_id"] == "lnk_1"
        assert link["reason"] == "LOGIN_CONTINUITY"
        assert link["at"]
    merge_calls = [
        c
        for c in _updates_to(mock_pool, "conversations")
        if "identity_resolution = COALESCE" in c.sql
    ]
    assert merge_calls[0].where["customer_id_string"] == "B"
    assert merge_calls[1].where["conversation_id"] == "conv-B"
    # The outcome is written BEFORE the move, so the alias predicate matches.
    conv_updates = _updates_to(mock_pool, "conversations")
    assert conv_updates[-1].values["customer_id_string"] == "A"


@pytest.mark.asyncio
async def test_merged_writes_a_merge_outcome_without_an_envelope_conversation(mock_pool):
    mock_pool.set_fetchval_sequence(["a-ref", "z-ref"])

    await handle_customer_identity_merged(
        mock_pool, {"payload": {"canonical_id": "A", "merged_canonical_id": "Z"}}
    )

    merges = mock_pool.jsonb_merges("conversations", "identity_resolution")
    assert len(merges) == 1
    assert merges[0]["merge"]["reason"] == "MERGED"
    assert merges[0]["merge"]["alias_id"] == "Z"
