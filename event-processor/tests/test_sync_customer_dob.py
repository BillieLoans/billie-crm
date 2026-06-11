"""Regression: the applicationDetail_changed path must coerce the customer DOB.

_sync_customer passed the DOB straight through as an ISO string, so asyncpg
raised DataError ("expected a datetime.date or datetime.datetime instance, got
'str'") and threw the whole customers upsert — losing DOB *and* the residential
address (both written in the same atomic upsert). Symptom in the UI: name /
email / phone present, but Date of Birth and Address show '—'.
"""

from __future__ import annotations

import datetime

import pytest

from billie_servicing.handlers.conversation import handle_application_detail_changed


@pytest.mark.asyncio
async def test_application_detail_changed_coerces_dob_and_keeps_address(mock_pool):
    event = {
        "typ": "applicationDetail_changed",
        "cid": "conv-dob-001",
        "customer": {
            "customer_id": "CUST-DOB-1",
            "first_name": "Charbel",
            "last_name": "Limsyn",
            "date_of_birth": "1984-11-21",  # ISO string, as chat events deliver it
            "residential_address": {
                "full_address": "1 High St, Sydney NSW 2000",
                "suburb": "Sydney",
                "state": "NSW",
                "postcode": "2000",
            },
        },
        "payload": {"application_number": "DOB-APP-1"},
    }

    # Previously raised asyncpg.DataError before reaching the DB layer's typing.
    await handle_application_detail_changed(mock_pool, event)

    cust = mock_pool.last_insert("customers")
    assert cust is not None
    # DOB coerced to a real date/datetime — not the raw string.
    assert isinstance(cust["date_of_birth"], (datetime.date, datetime.datetime))
    assert not isinstance(cust["date_of_birth"], str)
    # Address fields land in the same upsert (they were lost when DOB threw).
    assert cust["residential_address_full_address"] == "1 High St, Sydney NSW 2000"
    assert cust["residential_address_state"] == "NSW"
    assert cust["residential_address_suburb"] == "Sydney"


@pytest.mark.asyncio
async def test_application_detail_changed_without_dob_still_writes_address(mock_pool):
    event = {
        "typ": "applicationDetail_changed",
        "cid": "conv-dob-002",
        "customer": {
            "customer_id": "CUST-DOB-2",
            "first_name": "Ada",
            "last_name": "Byron",
            "residential_address": {"full_address": "2 Park Rd, Perth WA 6000", "state": "WA"},
        },
        "payload": {"application_number": "DOB-APP-2"},
    }
    await handle_application_detail_changed(mock_pool, event)

    cust = mock_pool.last_insert("customers")
    assert cust is not None
    assert "date_of_birth" not in cust  # absent DOB → column simply not set
    assert cust["residential_address_full_address"] == "2 Park Rd, Perth WA 6000"
