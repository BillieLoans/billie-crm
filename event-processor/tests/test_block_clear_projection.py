"""Tests for billieChat ``reapplication_block.cleared.v1`` /
``reapplication_block.clear_rejected.v1`` projection handlers (Task 6).

billieChat emits these after an operator clears or rejects a block-clear
request; the CRM projects them back into the ``customers`` /
``conversations`` / ``reapplication_block_clear_requests`` tables.
"""

from __future__ import annotations

import pytest

from billie_servicing.handlers.reapplication import (
    handle_reapplication_block_clear_rejected,
    handle_reapplication_block_cleared,
)


# ---------------------------------------------------------------------------
# handle_reapplication_block_cleared
# ---------------------------------------------------------------------------


async def test_cleared_nulls_block_and_stamps_audit(mock_pool):
    """Prior reason in cleared_reasons → NULL the block, stamp cleared audit."""
    event = {
        "typ": "reapplication_block.cleared.v1",
        "usr": "c1",
        "payload": {
            "canonical_customer_id": "c1",
            "request_id": "req-1",
            "cleared_reasons": ["SERVICEABILITY"],
            "cleared_at": "2026-06-28T01:00:00+00:00",
            "operator_id": "ops-1",
            "justification": "manual assessment",
            "prior_block_reason": "SERVICEABILITY",
        },
    }
    await handle_reapplication_block_cleared(mock_pool, event)
    cust = mock_pool.last_upsert("customers")
    assert cust["reapplication_block_reason"] is None
    assert cust["reapplication_block_clear_status"] == "cleared"
    req = mock_pool.last_update("reapplication_block_clear_requests")
    assert req["status"] == "approved"


async def test_cleared_leaves_reason_when_prior_still_blocks(mock_pool):
    """Prior reason NOT in cleared_reasons → leave block reason, stamp audit only."""
    event = {
        "typ": "reapplication_block.cleared.v1",
        "usr": "c2",
        "payload": {
            "canonical_customer_id": "c2",
            "request_id": "req-2",
            # SERVICEABILITY cleared, but the blocking reason is ACTIVE_LOAN
            "cleared_reasons": ["SERVICEABILITY"],
            "prior_block_reason": "ACTIVE_LOAN",
            "cleared_at": "2026-06-28T01:00:00+00:00",
            "operator_id": "ops-1",
        },
    }
    await handle_reapplication_block_cleared(mock_pool, event)
    cust = mock_pool.last_upsert("customers")
    # reapplication_block_reason must NOT be in the upsert (left as-is on conflict).
    assert "reapplication_block_reason" not in cust
    # Audit fields must still be stamped.
    assert cust["reapplication_block_clear_status"] == "cleared"
    assert cust["reapplication_block_cleared_at"] is not None


async def test_cleared_prior_none_also_nulls_reason(mock_pool):
    """prior_block_reason absent (None) → treat as gone, NULL the block reason."""
    event = {
        "typ": "reapplication_block.cleared.v1",
        "usr": "c3",
        "payload": {
            "canonical_customer_id": "c3",
            "request_id": "req-3",
            "cleared_reasons": ["SERVICEABILITY"],
            "cleared_at": "2026-06-28T02:00:00+00:00",
            "operator_id": "ops-2",
            # prior_block_reason absent
        },
    }
    await handle_reapplication_block_cleared(mock_pool, event)
    cust = mock_pool.last_upsert("customers")
    assert cust["reapplication_block_reason"] is None
    assert cust["reapplication_block_clear_status"] == "cleared"


async def test_cleared_flips_request_row_to_approved(mock_pool):
    """Request row must be flipped to 'approved' so the queue shows it applied."""
    event = {
        "typ": "reapplication_block.cleared.v1",
        "usr": "c1",
        "payload": {
            "canonical_customer_id": "c1",
            "request_id": "req-99",
            "cleared_reasons": ["PEP"],
            "prior_block_reason": "PEP",
            "cleared_at": "2026-06-28T01:00:00+00:00",
            "operator_id": "ops-1",
        },
    }
    await handle_reapplication_block_cleared(mock_pool, event)
    req = mock_pool.last_update("reapplication_block_clear_requests")
    assert req is not None
    assert req["status"] == "approved"


async def test_cleared_stamps_conversation_audit_when_present(mock_pool):
    """Conversations updated via update_by_key on reapplication_block_canonical_customer_id.

    The handler no longer keys by conversation_id from the payload (billieChat sets
    conv = "ops:block-clear:..." which is a synthetic ops key, not a real conv row).
    Instead it UPDATE-by-canonical so all blocked conversations for the canonical
    receive the audit fields.
    """
    event = {
        "typ": "reapplication_block.cleared.v1",
        "usr": "c4",
        "payload": {
            "canonical_customer_id": "c4",
            "conversation_id": "conv-abc",
            "request_id": "req-4",
            "cleared_reasons": ["SERVICEABILITY"],
            "prior_block_reason": "SERVICEABILITY",
            "cleared_at": "2026-06-28T01:00:00+00:00",
            "operator_id": "ops-3",
            "justification": "approved after review",
        },
    }
    await handle_reapplication_block_cleared(mock_pool, event)
    conv = mock_pool.last_update("conversations")
    assert conv is not None
    assert conv["reapplication_block_clear_status"] == "cleared"
    assert conv["reapplication_block_cleared_by"] == "ops-3"
    assert conv["reapplication_block_clear_justification"] == "approved after review"
    assert conv["reapplication_block_clear_request_id"] == "req-4"


async def test_cleared_no_conversation_id_updates_customer_only(mock_pool):
    """No conversation_id → customer mirror updated; conversations updated by canonical (no INSERT)."""
    event = {
        "typ": "reapplication_block.cleared.v1",
        "usr": "c5",
        "payload": {
            "canonical_customer_id": "c5",
            "request_id": "req-5",
            "cleared_reasons": ["SERVICEABILITY"],
            "prior_block_reason": "SERVICEABILITY",
            "cleared_at": "2026-06-28T01:00:00+00:00",
            "operator_id": "ops-1",
        },
    }
    await handle_reapplication_block_cleared(mock_pool, event)
    # No INSERT (no phantom conversation row for the ops:block-clear:... conv key).
    assert not mock_pool.inserts_into("conversations")
    # An UPDATE by canonical IS issued (harmless 0-match if no blocked convs yet).
    assert mock_pool.last_update("conversations") is not None
    assert mock_pool.last_upsert("customers") is not None


async def test_cleared_follows_tombstone_to_canonical(mock_pool):
    """Merged customer → cleared audit lands on the surviving canonical row."""
    mock_pool.set_fetchval("CANONICAL-C6")
    event = {
        "typ": "reapplication_block.cleared.v1",
        "usr": "alias-c6",
        "payload": {
            "canonical_customer_id": "alias-c6",
            "request_id": "req-6",
            "cleared_reasons": ["ACTIVE_LOAN"],
            "prior_block_reason": "ACTIVE_LOAN",
            "cleared_at": "2026-06-28T01:00:00+00:00",
            "operator_id": "ops-1",
        },
    }
    await handle_reapplication_block_cleared(mock_pool, event)
    cust = mock_pool.last_upsert("customers")
    assert cust["customer_id"] == "CANONICAL-C6"


# ---------------------------------------------------------------------------
# handle_reapplication_block_clear_rejected
# ---------------------------------------------------------------------------


async def test_rejected_stamps_clear_status(mock_pool):
    """Rejection → request row gets status='rejected'."""
    event = {
        "typ": "reapplication_block.clear_rejected.v1",
        "usr": "c1",
        "payload": {
            "canonical_customer_id": "c1",
            "request_id": "req-1",
            "rejection_code": "APPROVAL_REQUIRED",
            "detail": "needs approval",
        },
    }
    await handle_reapplication_block_clear_rejected(mock_pool, event)
    req = mock_pool.last_update("reapplication_block_clear_requests")
    # Handler may set either status="rejected" or reapplication_block_clear_status="rejected"
    # on the request row; use .get() so the or short-circuits without KeyError.
    assert req.get("reapplication_block_clear_status") == "rejected" or req.get("status") == "rejected"


async def test_rejected_stamps_customer_clear_status(mock_pool):
    """Rejection → customer row gets reapplication_block_clear_status='rejected'."""
    event = {
        "typ": "reapplication_block.clear_rejected.v1",
        "usr": "c7",
        "payload": {
            "canonical_customer_id": "c7",
            "request_id": "req-7",
            "rejection_code": "APPROVAL_REQUIRED",
            "detail": "insufficient justification",
        },
    }
    await handle_reapplication_block_clear_rejected(mock_pool, event)
    cust = mock_pool.last_upsert("customers")
    assert cust is not None
    assert cust["reapplication_block_clear_status"] == "rejected"


async def test_rejected_stores_detail_on_request_row(mock_pool):
    """The rejection detail is stored on the request row for the operator to see."""
    event = {
        "typ": "reapplication_block.clear_rejected.v1",
        "usr": "c8",
        "payload": {
            "canonical_customer_id": "c8",
            "request_id": "req-8",
            "detail": "manager declined",
        },
    }
    await handle_reapplication_block_clear_rejected(mock_pool, event)
    req = mock_pool.last_update("reapplication_block_clear_requests")
    assert req["approval_details_reason"] == "manager declined"


async def test_cleared_realistic_ops_conv_no_phantom_insert(mock_pool):
    """ops:block-clear:... synthetic conv MUST NOT create a phantom conversations row.

    billieChat emits cleared events with conv = "ops:block-clear:{request_id}"
    (not a real conversation id).  The handler must stamp conversations via
    UPDATE-by-canonical only — never INSERT a phantom row keyed by the ops conv.
    """
    event = {
        "typ": "reapplication_block.cleared.v1",
        "usr": "c1",
        "conv": "ops:block-clear:req-1",
        "payload": {
            "canonical_customer_id": "c1",
            "request_id": "req-1",
            "cleared_reasons": ["SERVICEABILITY"],
            "cleared_at": "2026-06-28T01:00:00+00:00",
            "operator_id": "ops-1",
            "justification": "x",
            "prior_block_reason": "SERVICEABILITY",
        },
    }
    await handle_reapplication_block_cleared(mock_pool, event)
    # No phantom INSERT into conversations.
    assert mock_pool.inserts_into("conversations") == []
    # An UPDATE by canonical IS issued.
    conv = mock_pool.last_update("conversations")
    assert conv is not None
    assert conv["reapplication_block_clear_status"] == "cleared"
    assert conv["reapplication_block_reason"] is None


async def test_rejected_updates_conversations_by_canonical_with_rejection_code(mock_pool):
    """Rejected handler updates conversations by canonical and stores rejection_code in request row."""
    event = {
        "typ": "reapplication_block.clear_rejected.v1",
        "usr": "c9",
        "conv": "ops:block-clear:req-9",
        "payload": {
            "canonical_customer_id": "c9",
            "request_id": "req-9",
            "rejection_code": "APPROVAL_REQUIRED",
            "detail": "single operator attempt",
        },
    }
    await handle_reapplication_block_clear_rejected(mock_pool, event)
    # No phantom INSERT into conversations.
    assert mock_pool.inserts_into("conversations") == []
    # Conversations UPDATE by canonical with rejected status.
    conv = mock_pool.last_update("conversations")
    assert conv is not None
    assert conv["reapplication_block_clear_status"] == "rejected"
    # Request row has both machine code and human detail.
    req = mock_pool.last_update("reapplication_block_clear_requests")
    assert req["approval_details_reason"] == "APPROVAL_REQUIRED: single operator attempt"
