"""Tests for ekyc_status vocabulary normalisation in handle_customer_changed.

Prod incident 2026-08-17: upstream customer.changed.v1 events now carry
``ekyc_status: "APPROVED"`` but the Payload enum
(``enum_customers_ekyc_status``) only accepts successful/failed/pending.
The raw pass-through made the INSERT fail, DLQ'ing the entire customer
update (4 events stranded/DLQ'd in prod). The handler must translate the
upstream vocabulary and never let an unknown status value take down the
whole event.
"""

from unittest.mock import MagicMock

import pytest
from billie_servicing.handlers.customer import handle_customer_changed
from structlog.testing import capture_logs


def _customer_event(ekyc_status=None):
    event = MagicMock()
    event.payload = MagicMock(
        spec=[
            "customer_id",
            "first_name",
            "last_name",
            "email_address",
            "mobile_phone_number",
            "date_of_birth",
            "ekyc_status",
        ]
    )
    event.payload.customer_id = "CUST-EKYC-1"
    event.payload.first_name = "Test"
    event.payload.last_name = "Customer"
    event.payload.email_address = None
    event.payload.mobile_phone_number = None
    event.payload.date_of_birth = None
    event.payload.ekyc_status = ekyc_status
    return event


class TestEkycStatusNormalisation:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("upstream", "expected"),
        [
            ("APPROVED", "successful"),  # the prod DLQ repro
            ("Approved", "successful"),
            ("successful", "successful"),
            ("DECLINED", "failed"),
            ("REJECTED", "failed"),
            ("failed", "failed"),
            ("PENDING", "pending"),
            ("IN_PROGRESS", "pending"),
            ("pending", "pending"),
        ],
    )
    async def test_maps_upstream_vocabulary_to_enum(
        self, mock_pool, upstream, expected
    ):
        await handle_customer_changed(mock_pool, _customer_event(ekyc_status=upstream))

        upsert = mock_pool.last_upsert("customers")
        assert upsert is not None
        assert upsert["ekyc_status"] == expected

    @pytest.mark.asyncio
    async def test_unknown_value_is_skipped_with_warning_not_dlqd(self, mock_pool):
        """An unmappable status must drop only the ekyc field — the rest of
        the customer update still writes (the alternative is a DLQ'd event
        and a silently stale customer)."""
        with capture_logs() as captured:
            await handle_customer_changed(
                mock_pool, _customer_event(ekyc_status="SOMETHING_NEW")
            )

        upsert = mock_pool.last_upsert("customers")
        assert upsert is not None
        assert "ekyc_status" not in upsert
        assert upsert["first_name"] == "Test"
        warnings = [e for e in captured if e.get("log_level") == "warning"]
        assert warnings, "expected a warning for the unknown ekyc_status value"

    @pytest.mark.asyncio
    async def test_absent_ekyc_status_leaves_field_untouched(self, mock_pool):
        await handle_customer_changed(mock_pool, _customer_event(ekyc_status=None))

        upsert = mock_pool.last_upsert("customers")
        assert upsert is not None
        assert "ekyc_status" not in upsert
