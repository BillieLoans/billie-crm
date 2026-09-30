"""SP5 (BTB-400): customer.login_email.rebound.v1 stamps
customers.login_email_rebound_at."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from billie_servicing.handlers.identity import handle_customer_login_email_rebound


@pytest.mark.asyncio
async def test_rebound_stamps_the_customer_row(mock_pool):
    await handle_customer_login_email_rebound(
        mock_pool,
        {
            "payload": {
                "customer_id": "4A103C6E",
                "email_address": "new@example.com",
                "previous_email_address": "old@example.com",
                "zitadel_user_id": "zid-1",
                "rebound_at": "2026-09-29T10:00:30Z",
                "source_event_id": "evt_1",
            }
        },
    )
    row = mock_pool.last_update("customers")
    assert row["login_email_rebound_at"] == datetime(2026, 9, 29, 10, 0, 30, tzinfo=timezone.utc)
    # Ids only in the projection: the addresses already ride customer.changed.v1.
    assert "email_address" not in row and "previous_email_address" not in row


@pytest.mark.asyncio
async def test_payload_as_json_string(mock_pool):
    await handle_customer_login_email_rebound(
        mock_pool,
        {
            "payload": json.dumps(
                {
                    "customer_id": "C1",
                    "email_address": "a@b.io",
                    "zitadel_user_id": "z",
                    "rebound_at": "2026-09-29T10:00:30Z",
                }
            )
        },
    )
    assert mock_pool.last_update("customers") is not None


@pytest.mark.asyncio
async def test_missing_ids_is_noop(mock_pool):
    await handle_customer_login_email_rebound(
        mock_pool, {"payload": {"rebound_at": "2026-09-29T10:00:30Z"}}
    )
    await handle_customer_login_email_rebound(mock_pool, {"payload": {"customer_id": "C1"}})
    assert mock_pool.last_update("customers") is None
