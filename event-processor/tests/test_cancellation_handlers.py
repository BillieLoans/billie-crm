"""Tests for customer_cancelled / offer_cancelled projection."""
import json

import pytest

from billie_servicing.handlers.cancellation import (
    handle_customer_cancelled,
    handle_offer_cancelled,
)

CONV = "2cf3919d-a94e-4995-bd02-1865b9d755a4"
APP = "C6F7C8E6-77F"


def _event(typ, reason):
    return {
        "typ": typ,
        "conv": CONV,
        "usr": "B81FC35E",
        "payload": {
            "application_number": APP,
            "cancellation_reason": reason,
            "cancelled_at": "2026-08-28T01:37:30.993832+00:00",
        },
    }


def _row(status=None, record=None):
    return {"status": status, "cancellation_record": json.dumps(record) if record else None}


class TestReasonMapping:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "reason",
        [
            "attestation_declined",
            "preliminary_approval_cancelled",
            "statement_consent_declined",
            "final_offer_declined",
        ],
    )
    async def test_customer_reasons_map_to_cancelled(self, mock_pool, reason):
        mock_pool.set_fetchrow(_row(status="approved"))
        await handle_customer_cancelled(mock_pool, _event("customer_cancelled", reason))
        update = mock_pool.last_update("conversations")
        assert update["status"] == "cancelled"
        record = json.loads(update["cancellation_record"])
        assert record["category"] == "customer_declined"
        assert record["reason"] == reason
        assert record["source_event"] == "customer_cancelled"
        assert record["application_number"] == APP

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "reason,category",
        [
            ("session_timeout", "system_expired"),
            ("cutover_exhausted", "system_expired"),
            ("browser_close", "abandoned"),
        ],
    )
    async def test_offer_reasons_map_to_expired(self, mock_pool, reason, category):
        mock_pool.set_fetchrow(_row(status="approved"))
        await handle_offer_cancelled(mock_pool, _event("offer_cancelled", reason))
        update = mock_pool.last_update("conversations")
        assert update["status"] == "expired"
        assert json.loads(update["cancellation_record"])["category"] == category

    @pytest.mark.asyncio
    async def test_unknown_reason_falls_back_on_source_event(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="approved"))
        await handle_customer_cancelled(mock_pool, _event("customer_cancelled", "brand_new"))
        update = mock_pool.last_update("conversations")
        assert update["status"] == "cancelled"
        record = json.loads(update["cancellation_record"])
        assert record["category"] == "customer_declined"
        assert record["reason"] == "brand_new"

    @pytest.mark.asyncio
    async def test_unknown_offer_reason_falls_back_to_expired(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="approved"))
        await handle_offer_cancelled(mock_pool, _event("offer_cancelled", "brand_new"))
        assert mock_pool.last_update("conversations")["status"] == "expired"


class TestPrecedenceGuard:
    @pytest.mark.asyncio
    async def test_system_expiry_does_not_overwrite_customer_decline(self, mock_pool):
        """The prod repro: decline at 01:37, session_timeout at 02:36."""
        mock_pool.set_fetchrow(
            _row(status="cancelled", record={"category": "customer_declined"})
        )
        await handle_offer_cancelled(mock_pool, _event("offer_cancelled", "session_timeout"))
        assert mock_pool.last_update("conversations") is None

    @pytest.mark.asyncio
    async def test_customer_decline_overrides_earlier_system_expiry(self, mock_pool):
        """Reverse order: the expiry landed first, the decline still wins."""
        mock_pool.set_fetchrow(_row(status="expired", record={"category": "system_expired"}))
        await handle_customer_cancelled(
            mock_pool, _event("customer_cancelled", "final_offer_declined")
        )
        update = mock_pool.last_update("conversations")
        assert update["status"] == "cancelled"
        assert json.loads(update["cancellation_record"])["category"] == "customer_declined"

    @pytest.mark.asyncio
    async def test_second_system_expiry_keeps_the_first_reason(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="expired", record={"category": "system_expired"}))
        await handle_offer_cancelled(mock_pool, _event("offer_cancelled", "cutover_exhausted"))
        assert mock_pool.last_update("conversations") is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize("typ", ["customer_cancelled", "offer_cancelled"])
    async def test_nothing_downgrades_a_killed_conversation(self, mock_pool, typ):
        """A fraud stop must never be masked as cancelled or expired."""
        mock_pool.set_fetchrow(_row(status="hard_end"))
        handler = (
            handle_customer_cancelled if typ == "customer_cancelled" else handle_offer_cancelled
        )
        await handler(mock_pool, _event(typ, "session_timeout"))
        assert mock_pool.last_update("conversations") is None


class TestApplicationOutcome:
    @pytest.mark.asyncio
    async def test_sets_application_outcome_withdrawn(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="approved"))
        await handle_customer_cancelled(
            mock_pool, _event("customer_cancelled", "final_offer_declined")
        )
        assert mock_pool.last_update("applications")["application_outcome"] == "withdrawn"

    @pytest.mark.asyncio
    async def test_no_application_number_skips_applications_write(self, mock_pool):
        mock_pool.set_fetchrow(_row(status="approved"))
        event = _event("customer_cancelled", "final_offer_declined")
        event["payload"].pop("application_number")
        await handle_customer_cancelled(mock_pool, event)
        assert not mock_pool.updates_to("applications")


class TestGuards:
    @pytest.mark.asyncio
    async def test_missing_conversation_id_skips(self, mock_pool):
        await handle_customer_cancelled(
            mock_pool, {"typ": "customer_cancelled", "payload": {}}
        )
        assert not mock_pool.calls

    @pytest.mark.asyncio
    async def test_unknown_conversation_is_update_only(self, mock_pool):
        mock_pool.set_fetchrow(None)
        await handle_offer_cancelled(mock_pool, _event("offer_cancelled", "session_timeout"))
        assert not mock_pool.inserts_into("conversations")
