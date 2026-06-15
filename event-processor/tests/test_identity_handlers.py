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
