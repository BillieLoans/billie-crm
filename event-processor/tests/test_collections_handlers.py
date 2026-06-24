"""Unit tests for collection.case.* event handlers (Stream D / BTB-199).

Covers the six platform → CRM read-only projections the headless
collectionsService emits to ChatLedger. Each lands in the ``collection_cases``
table, keyed by ``account_id``:

- collection.case.opened.v1               → state = 'open'
- collection.case.exhausted.v1            → state = 'awaiting_human'
- collection.case.cured.v1                → state = 'cured'
- collection.case.hardship_paused.v1      → hardship_paused = True  (flag; state untouched)
- collection.case.resumed.v1              → hardship_paused = False
- collection.case.stop_contact_applied.v1 → stopped_contact = True  (flag; state untouched)

Payloads are the flat ``billie_collection_events`` pydantic models; handlers
receive the parsed model directly (account_id/customer_id/… are top-level
attributes). Tests use MagicMock payloads matching that contract.
"""

from unittest.mock import MagicMock

import pytest

from billie_servicing.db import coerce_date
from billie_servicing.handlers.collections import (
    handle_collection_case_cured,
    handle_collection_case_exhausted,
    handle_collection_case_hardship_paused,
    handle_collection_case_opened,
    handle_collection_case_resumed,
    handle_collection_case_stop_contact_applied,
)

TABLE = "collection_cases"


def _event(**attrs) -> MagicMock:
    """Build a flat collection-event model stand-in with exactly the given attrs."""
    event = MagicMock()
    for key, value in attrs.items():
        setattr(event, key, value)
    return event


class TestOpened:
    @pytest.mark.asyncio
    async def test_opened_upserts_case_keyed_on_account_id(self, mock_pool):
        event = _event(
            event_id="evt-1",
            timestamp="2026-06-01T00:00:00Z",
            account_id="acc_1",
            correlation_id="corr-1",
            customer_id="cust_1",
            overdue_amount="312.40",
            due_date="2026-05-20",
        )

        await handle_collection_case_opened(mock_pool, event)

        call = mock_pool.calls_against(TABLE)[0]
        assert call.conflict_columns == ["account_id"]

        doc = mock_pool.last_insert(TABLE)
        assert doc["account_id"] == "acc_1"
        assert doc["customer_id"] == "cust_1"
        assert doc["state"] == "open"
        assert doc["overdue_amount"] == 312.40
        assert doc["due_date"] == coerce_date("2026-05-20")
        assert doc["opened_at"] == coerce_date("2026-06-01T00:00:00Z")
        assert doc["correlation_id"] == "corr-1"
        # created_at is insert-only (must not be in the DO UPDATE SET clause).
        assert "created_at" in doc
        assert "EXCLUDED.created_at" not in call.sql

    @pytest.mark.asyncio
    async def test_opened_resolves_customer_link(self, mock_pool):
        mock_pool.set_fetchval("pg-customer-uuid")
        event = _event(
            event_id="evt-2",
            timestamp="2026-06-01T00:00:00Z",
            account_id="acc_2",
            correlation_id=None,
            customer_id="cust_2",
            overdue_amount="50.00",
            due_date=None,
        )

        await handle_collection_case_opened(mock_pool, event)

        doc = mock_pool.last_insert(TABLE)
        assert doc["customer_ref_id"] == "pg-customer-uuid"
        assert doc["customer_id"] == "cust_2"


class TestExhausted:
    @pytest.mark.asyncio
    async def test_exhausted_sets_awaiting_human_with_money_snapshot(self, mock_pool):
        event = _event(
            event_id="evt-3",
            timestamp="2026-06-19T00:00:00Z",
            account_id="acc_1",
            correlation_id="corr-1",
            customer_id="cust_1",
            overdue_amount="540.00",
            days_overdue=45,
            last_step=5,
        )

        await handle_collection_case_exhausted(mock_pool, event)

        call = mock_pool.calls_against(TABLE)[0]
        assert call.conflict_columns == ["account_id"]
        doc = mock_pool.last_insert(TABLE)
        assert doc["account_id"] == "acc_1"
        assert doc["state"] == "awaiting_human"
        assert doc["overdue_amount"] == 540.00
        assert doc["days_overdue"] == 45
        assert doc["last_step"] == 5
        assert doc["exhausted_at"] == coerce_date("2026-06-19T00:00:00Z")


class TestCured:
    @pytest.mark.asyncio
    async def test_cured_sets_state_and_cured_at(self, mock_pool):
        event = _event(
            event_id="evt-4",
            timestamp="2026-06-20T00:00:00Z",
            account_id="acc_1",
            correlation_id="corr-1",
            customer_id="cust_1",
            cured_at="2026-06-20T09:30:00Z",
        )

        await handle_collection_case_cured(mock_pool, event)

        doc = mock_pool.last_insert(TABLE)
        assert doc["state"] == "cured"
        assert doc["cured_at"] == coerce_date("2026-06-20T09:30:00Z")


class TestHardshipPausedAndResumed:
    @pytest.mark.asyncio
    async def test_hardship_paused_sets_flag_without_touching_state(self, mock_pool):
        event = _event(
            event_id="evt-5",
            timestamp="2026-06-10T00:00:00Z",
            account_id="acc_1",
            correlation_id="corr-1",
            customer_id="cust_1",
            paused_at="2026-06-10T08:00:00Z",
        )

        await handle_collection_case_hardship_paused(mock_pool, event)

        call = mock_pool.calls_against(TABLE)[0]
        assert call.conflict_columns == ["account_id"]
        doc = mock_pool.last_insert(TABLE)
        assert doc["hardship_paused"] is True
        assert doc["paused_at"] == coerce_date("2026-06-10T08:00:00Z")
        # Flag-only upsert must NOT write `state` (would clobber the lifecycle).
        assert "state" not in doc

    @pytest.mark.asyncio
    async def test_resumed_clears_flag(self, mock_pool):
        event = _event(
            event_id="evt-6",
            timestamp="2026-06-12T00:00:00Z",
            account_id="acc_1",
            correlation_id="corr-1",
            customer_id="cust_1",
            resumed_at="2026-06-12T10:00:00Z",
        )

        await handle_collection_case_resumed(mock_pool, event)

        doc = mock_pool.last_insert(TABLE)
        assert doc["hardship_paused"] is False
        assert doc["resumed_at"] == coerce_date("2026-06-12T10:00:00Z")
        assert "state" not in doc


class TestStopContact:
    @pytest.mark.asyncio
    async def test_stop_contact_sets_flag(self, mock_pool):
        event = _event(
            event_id="evt-7",
            timestamp="2026-06-15T00:00:00Z",
            account_id="acc_1",
            correlation_id="corr-1",
            customer_id="cust_1",
            applied_at="2026-06-15T11:00:00Z",
        )

        await handle_collection_case_stop_contact_applied(mock_pool, event)

        doc = mock_pool.last_insert(TABLE)
        assert doc["stopped_contact"] is True
        assert doc["stop_contact_at"] == coerce_date("2026-06-15T11:00:00Z")
        assert "state" not in doc
