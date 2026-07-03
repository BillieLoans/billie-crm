"""reapplication_block.auto_cleared.v1 → customer servicing banner refresh.

Emitted by billieChat when a customer's LAST open loan is repaid (the
ACTIVE_LOAN eligibility condition lapses). The CRM must refresh ONLY the
customer-level "currently blocked" mirror, guarded to rows currently shown as
ACTIVE_LOAN, and must leave the conversation-level decline history untouched.
"""

from __future__ import annotations

import pytest

from billie_servicing.handlers.reapplication import (
    handle_reapplication_block_auto_cleared,
)


def _event(**payload):
    payload.setdefault("canonical_customer_id", "8E0BC002")
    payload.setdefault("cleared_reasons", ["ACTIVE_LOAN"])
    payload.setdefault("trigger", "account_closed")
    payload.setdefault("cleared_at", "2026-07-03T00:22:41+00:00")
    return {
        "typ": "reapplication_block.auto_cleared.v1",
        "usr": payload["canonical_customer_id"],
        "conv": "auto-clear:8E0BC002:acct-1",
        "seq": 8,
        "payload": payload,
    }


class TestAutoClear:
    async def test_nulls_reason_when_fully_unblocked(self, mock_pool):
        await handle_reapplication_block_auto_cleared(
            mock_pool, _event(residual_block_reason=None)
        )
        upd = mock_pool.last_update("customers")
        assert upd is not None
        assert upd["reapplication_block_reason"] is None
        assert upd["reapplication_block_clear_status"] == "auto_cleared"
        # Guarded to ACTIVE_LOAN rows only — never overrides a higher reason.
        sql = mock_pool.calls_against("customers")[-1].sql
        assert "reapplication_block_reason = 'ACTIVE_LOAN'" in sql

    async def test_sets_residual_reason_when_still_blocked(self, mock_pool):
        await handle_reapplication_block_auto_cleared(
            mock_pool, _event(residual_block_reason="PRIOR_DEFAULT")
        )
        upd = mock_pool.last_update("customers")
        assert upd["reapplication_block_reason"] == "PRIOR_DEFAULT"
        assert upd["reapplication_block_clear_status"] == "auto_cleared"

    async def test_does_not_touch_conversations(self, mock_pool):
        # The per-application decline reason is audit history and must remain.
        await handle_reapplication_block_auto_cleared(
            mock_pool, _event(residual_block_reason=None)
        )
        assert not mock_pool.has_call_against("conversations")

    async def test_no_customer_id_is_noop(self, mock_pool):
        event = _event(residual_block_reason=None)
        event["payload"]["canonical_customer_id"] = None
        event["usr"] = None
        await handle_reapplication_block_auto_cleared(mock_pool, event)
        assert not mock_pool.has_call_against("customers")

    async def test_string_payload_parsed_defensively(self, mock_pool):
        import json

        event = _event(residual_block_reason=None)
        event["payload"] = json.dumps(event["payload"])
        await handle_reapplication_block_auto_cleared(mock_pool, event)
        assert mock_pool.last_update("customers") is not None
