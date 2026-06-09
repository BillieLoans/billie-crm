"""Integration-style tests for event-processor handlers.

Exercises:
- Customer events (customer.changed.v1, customer.verified.v1)
- Account events (account.created.v1, account.closed.v1, account.schedule.*)
- Conversation events (conversation_started, utterance, final_decision, etc.)

The new asyncpg-based handlers emit SQL via the shared ``db`` helpers. Tests
inspect the parsed call stream on ``mock_pool`` rather than asserting on
Mongo-style update_one shapes.
"""

import json
from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from billie_servicing.handlers.account import (
    handle_account_closed,
    handle_account_created,
    handle_account_status_changed,
    handle_account_updated,
    handle_schedule_created,
    handle_schedule_updated,
)
from billie_servicing.handlers.conversation import (
    handle_assessment,
    handle_conversation_started,
    handle_conversation_summary,
    handle_conversation_summary_changed,
    handle_final_decision,
    handle_noticeboard_updated,
    handle_utterance,
)
from billie_servicing.handlers.customer import (
    handle_customer_changed,
    handle_customer_verified,
)


# =============================================================================
# Customer handlers
# =============================================================================


class TestCustomerHandlers:
    @pytest.mark.asyncio
    async def test_handle_customer_changed_creates_new_customer(self, mock_pool):
        event = MagicMock()
        event.payload = MagicMock()
        event.payload.customer_id = "CUS-TEST-001"
        event.payload.first_name = "John"
        event.payload.last_name = "Smith"
        event.payload.email_address = "john@test.com"
        event.payload.mobile_phone_number = "0412345678"
        event.payload.date_of_birth = "1985-06-15"
        event.payload.ekyc_status = "successful"
        event.payload.residential_address = None

        await handle_customer_changed(mock_pool, event)

        doc = mock_pool.last_insert("customers")
        assert doc is not None
        assert doc["customer_id"] == "CUS-TEST-001"
        assert doc["first_name"] == "John"
        assert doc["last_name"] == "Smith"
        assert doc["full_name"] == "John Smith"
        assert doc["email_address"] == "john@test.com"

        # Upsert keyed on customer_id; created_at is insert-only.
        call = mock_pool.calls_against("customers")[-1]
        assert call.op == "INSERT"
        assert call.conflict_columns == ["customer_id"]

    @pytest.mark.asyncio
    async def test_handle_customer_changed_with_address(self, mock_pool):
        event = MagicMock()
        event.payload = MagicMock()
        event.payload.customer_id = "CUS-TEST-002"
        event.payload.first_name = "Jane"
        event.payload.last_name = "Doe"
        event.payload.email_address = None
        event.payload.mobile_phone_number = None
        event.payload.date_of_birth = None
        event.payload.ekyc_status = None
        addr = MagicMock()
        addr.street_number = "123"
        addr.street_name = "Test"
        addr.street_type = "St"
        addr.unit_number = None
        addr.suburb = "Sydney"
        addr.state = "NSW"
        addr.postcode = "2000"
        addr.country = "Australia"
        addr.full_address = "123 Test St, Sydney NSW 2000"
        event.payload.residential_address = addr

        await handle_customer_changed(mock_pool, event)

        doc = mock_pool.last_insert("customers")
        assert doc["residential_address_street_number"] == "123"
        assert doc["residential_address_street_name"] == "Test"
        assert doc["residential_address_suburb"] == "Sydney"
        assert doc["residential_address_state"] == "NSW"
        assert doc["residential_address_full_address"] == "123 Test St, Sydney NSW 2000"

    @pytest.mark.asyncio
    async def test_handle_customer_verified(self, mock_pool):
        event = MagicMock()
        event.payload = MagicMock()
        event.payload.customer_id = "CUS-TEST-003"

        await handle_customer_verified(mock_pool, event)

        update = mock_pool.last_update("customers")
        assert update is not None
        assert update["identity_verified"] is True
        assert update["ekyc_status"] == "successful"


# =============================================================================
# Account handlers
# =============================================================================


class TestAccountHandlers:
    @pytest.mark.asyncio
    async def test_handle_account_created(self, mock_pool):
        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "ACC-TEST-001"
        event.payload.account_number = "ACC-12345"
        event.payload.customer_id = "CUS-TEST-001"
        event.payload.status = "ACTIVE"
        event.payload.loan_amount = Decimal("500.00")
        event.payload.loan_fee = Decimal("80.00")
        event.payload.loan_total_payable = Decimal("580.00")
        event.payload.current_balance = Decimal("580.00")
        event.payload.opened_date = "2024-01-15"

        await handle_account_created(mock_pool, event)

        doc = mock_pool.last_insert("loan_accounts")
        assert doc["loan_account_id"] == "ACC-TEST-001"
        assert doc["account_number"] == "ACC-12345"
        assert doc["customer_id_string"] == "CUS-TEST-001"
        assert doc["loan_terms_loan_amount"] == 500.00
        assert doc["loan_terms_loan_fee"] == 80.00
        assert doc["loan_terms_total_payable"] == 580.00
        assert doc["account_status"] == "active"

    @pytest.mark.asyncio
    async def test_handle_account_status_mapping(self, mock_pool):
        test_cases = [
            ("PENDING", "active"),
            ("ACTIVE", "active"),
            ("SUSPENDED", "in_arrears"),
            ("CLOSED", "paid_off"),
        ]
        for sdk_status, expected_status in test_cases:
            pool = mock_pool
            pool.connection.calls.clear()
            event = MagicMock()
            event.payload = MagicMock()
            event.payload.account_id = f"ACC-{sdk_status}"
            event.payload.account_number = f"ACC-{sdk_status}"
            event.payload.customer_id = "CUS-TEST"
            event.payload.status = sdk_status
            event.payload.loan_amount = Decimal("500.00")
            event.payload.loan_fee = Decimal("80.00")
            event.payload.loan_total_payable = Decimal("580.00")
            event.payload.current_balance = Decimal("580.00")
            event.payload.opened_date = "2024-01-15"

            await handle_account_created(pool, event)

            doc = pool.last_insert("loan_accounts")
            assert doc["account_status"] == expected_status, (
                f"{sdk_status} → expected {expected_status}, got {doc['account_status']}"
            )

    @pytest.mark.asyncio
    async def test_handle_schedule_created_writes_parent_and_payments(self, mock_pool):
        # The schedule_created handler does, in order:
        #   1. upsert loan_accounts with repayment_schedule_* metadata
        #   2. resolve loan_accounts.id for child FK
        #   3. INSERT each payment row with ON CONFLICT (parent_id, payment_number)
        mock_pool.set_fetchval("11111111-2222-3333-4444-555555555555")  # parent uuid

        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "ACC-TEST-001"
        event.payload.schedule_id = "SCHED-001"
        event.payload.n_payments = 4
        event.payload.payment_frequency = "fortnightly"
        event.payload.created_date = "2024-01-15"

        p1 = MagicMock(); p1.payment_number = 1; p1.due_date = "2024-01-22"; p1.amount = Decimal("145.00")
        p2 = MagicMock(); p2.payment_number = 2; p2.due_date = "2024-02-05"; p2.amount = Decimal("145.00")
        event.payload.payments = [p1, p2]

        await handle_schedule_created(mock_pool, event)

        # Parent row was upserted with schedule_* columns set.
        loan_inserts = mock_pool.inserts_into("loan_accounts")
        assert loan_inserts
        parent_doc = loan_inserts[-1]
        assert parent_doc["repayment_schedule_schedule_id"] == "SCHED-001"
        assert parent_doc["repayment_schedule_number_of_payments"] == 4
        assert parent_doc["repayment_schedule_payment_frequency"] == "fortnightly"

        # Two payment rows inserted into the child table.
        child_inserts = mock_pool.inserts_into("loan_accounts_repayment_schedule_payments")
        assert len(child_inserts) == 2
        assert {c["payment_number"] for c in child_inserts} == {1, 2}
        assert all(c["status"] == "scheduled" for c in child_inserts)


# =============================================================================
# Account closed handler
# =============================================================================


class TestAccountClosedHandler:
    def _make_event(self, **overrides):
        event = MagicMock()
        event.payload = MagicMock()
        defaults = {
            "account_id": "ACC-CLOSE-001",
            "customer_id": "CUS-CLOSE-001",
            "closure_reason": "PAID_OFF",
            "previous_status": "ACTIVE",
            "closed_date": "2026-05-13T00:00:00Z",
            "final_balance": Decimal("0.00"),
            "total_paid": Decimal("580.00"),
            "loan_total_payable": Decimal("580.00"),
            "triggered_by_transaction_id": "TXN-12345",
        }
        defaults.update(overrides)
        for attr, value in defaults.items():
            setattr(event.payload, attr, value)
        return event

    @pytest.mark.asyncio
    async def test_paid_off_sets_paid_off_status_and_zero_balance(self, mock_pool):
        await handle_account_closed(mock_pool, self._make_event())

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "paid_off"
        assert update["sdk_status"] == "CLOSED"
        assert update["balances_current_balance"] == 0.0
        assert update["balances_total_outstanding"] == 0.0
        assert update["balances_total_paid"] == 580.0
        assert update["closure_reason"] == "PAID_OFF"
        assert update["closure_previous_status"] == "ACTIVE"
        assert update["closure_final_balance"] == 0.0
        assert update["closure_total_paid"] == 580.0
        assert update["closure_loan_total_payable"] == 580.0
        assert update["closure_triggered_by_transaction_id"] == "TXN-12345"

    @pytest.mark.asyncio
    async def test_written_off_maps_to_written_off_status(self, mock_pool):
        await handle_account_closed(
            mock_pool,
            self._make_event(
                closure_reason="WRITTEN_OFF",
                previous_status="SUSPENDED",
                final_balance=Decimal("123.45"),
                total_paid=Decimal("456.55"),
                triggered_by_transaction_id=None,
            ),
        )

        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "written_off"
        assert update["closure_reason"] == "WRITTEN_OFF"
        assert update["closure_previous_status"] == "SUSPENDED"
        assert update["balances_current_balance"] == 123.45
        assert update["closure_triggered_by_transaction_id"] is None

    @pytest.mark.asyncio
    async def test_admin_closed_falls_back_to_paid_off_status(self, mock_pool):
        await handle_account_closed(mock_pool, self._make_event(closure_reason="ADMIN_CLOSED"))
        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "paid_off"
        assert update["closure_reason"] == "ADMIN_CLOSED"

    @pytest.mark.asyncio
    async def test_strips_enum_prefix_from_closure_reason(self, mock_pool):
        await handle_account_closed(
            mock_pool,
            self._make_event(closure_reason="ClosureReason.WRITTEN_OFF"),
        )
        update = mock_pool.last_update("loan_accounts")
        assert update["account_status"] == "written_off"
        assert update["closure_reason"] == "WRITTEN_OFF"


# =============================================================================
# Schedule updated — composite-key upsert pattern (no more placeholder/positional)
# =============================================================================


class TestScheduleUpdatedHandler:
    """The Mongo positional `$` operator + `$push` placeholder pattern is gone.

    The new handler does one INSERT … ON CONFLICT (_parent_id, payment_number)
    DO UPDATE per payment. Out-of-order events automatically land as
    placeholder rows; the natural-key conflict guarantees idempotency.
    """

    @staticmethod
    def _make_payment(payment_number, status, paid_date=None, amount_paid=None,
                      amount_remaining=None, linked_transaction_ids=None, last_updated=None):
        p = MagicMock()
        p.payment_number = payment_number
        p.status = status
        p.paid_date = paid_date
        p.amount_paid = amount_paid
        p.amount_remaining = amount_remaining
        p.linked_transaction_ids = linked_transaction_ids
        p.last_updated = last_updated
        return p

    @pytest.mark.asyncio
    async def test_single_payment_paid(self, mock_pool):
        mock_pool.set_fetchval("parent-uuid")

        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "ACC-TEST-001"
        event.payload.schedule_id = "SCHED-001"
        event.payload.payments = [
            self._make_payment(
                payment_number=1, status="paid", paid_date="2024-01-22",
                amount_paid=Decimal("145.00"), amount_remaining=Decimal("0"),
                linked_transaction_ids=["TXN-001"], last_updated="2024-01-22T10:00:00Z",
            )
        ]

        await handle_schedule_updated(mock_pool, event)

        child_inserts = mock_pool.inserts_into("loan_accounts_repayment_schedule_payments")
        assert len(child_inserts) == 1
        row = child_inserts[0]
        assert row["payment_number"] == 1
        assert row["status"] == "paid"
        assert row["amount_paid"] == 145.00
        assert row["amount_remaining"] == 0
        # linked_transaction_ids feeds a jsonb column — it must be a JSON string,
        # not a raw Python list (asyncpg raises DataError otherwise). Regression
        # guard for the schedule-allocation linkage bug.
        assert isinstance(row["linked_transaction_ids"], str)
        assert json.loads(row["linked_transaction_ids"]) == ["TXN-001"]
        # Conflict target is the composite natural key.
        call = [c for c in mock_pool.calls_against("loan_accounts_repayment_schedule_payments")
                if c.op == "INSERT"][0]
        assert "_parent_id, payment_number" in call.sql.replace("(", " ").replace(")", " ")

    @pytest.mark.asyncio
    async def test_multiple_payments(self, mock_pool):
        mock_pool.set_fetchval("parent-uuid")

        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "ACC-TEST-001"
        event.payload.schedule_id = "SCHED-001"
        event.payload.payments = [
            self._make_payment(1, "paid", "2024-01-22", Decimal("145.00"), Decimal("0"), ["TXN-001"]),
            self._make_payment(2, "paid", "2024-02-05", Decimal("145.00"), Decimal("0"), ["TXN-002"]),
        ]

        await handle_schedule_updated(mock_pool, event)

        inserts = mock_pool.inserts_into("loan_accounts_repayment_schedule_payments")
        assert len(inserts) == 2
        numbers = {row["payment_number"] for row in inserts}
        assert numbers == {1, 2}

    @pytest.mark.asyncio
    async def test_partial_payment(self, mock_pool):
        mock_pool.set_fetchval("parent-uuid")
        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "ACC-TEST-001"
        event.payload.schedule_id = "SCHED-001"
        event.payload.payments = [
            self._make_payment(
                1, "partial", paid_date=None,
                amount_paid=Decimal("75.00"), amount_remaining=Decimal("70.00"),
                linked_transaction_ids=["TXN-001", "TXN-002"],
            )
        ]

        await handle_schedule_updated(mock_pool, event)

        row = mock_pool.inserts_into("loan_accounts_repayment_schedule_payments")[0]
        assert row["status"] == "partial"
        assert row["amount_paid"] == 75.00
        assert row["amount_remaining"] == 70.00
        assert json.loads(row["linked_transaction_ids"]) == ["TXN-001", "TXN-002"]

    @pytest.mark.asyncio
    async def test_missed_payment(self, mock_pool):
        mock_pool.set_fetchval("parent-uuid")

        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "ACC-TEST-001"
        event.payload.schedule_id = "SCHED-001"

        # Missed payments — no paid_date / amount_paid / etc.
        p = MagicMock()
        p.payment_number = 1
        p.status = "missed"
        # Delete attrs so getattr returns the default.
        del p.paid_date
        del p.amount_paid
        del p.amount_remaining
        del p.linked_transaction_ids
        del p.last_updated
        event.payload.payments = [p]

        await handle_schedule_updated(mock_pool, event)

        row = mock_pool.inserts_into("loan_accounts_repayment_schedule_payments")[0]
        assert row["status"] == "missed"
        assert row["paid_date"] is None
        assert row["amount_paid"] is None

    @pytest.mark.asyncio
    async def test_status_case_insensitive(self, mock_pool):
        mock_pool.set_fetchval("parent-uuid")
        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "ACC-TEST-001"
        event.payload.schedule_id = "SCHED-001"
        event.payload.payments = [
            self._make_payment(1, "PAID", "2024-01-22", Decimal("145.00"), Decimal("0"), ["TXN-001"]),
        ]

        await handle_schedule_updated(mock_pool, event)

        row = mock_pool.inserts_into("loan_accounts_repayment_schedule_payments")[0]
        assert row["status"] == "paid"

    @pytest.mark.asyncio
    async def test_no_payments(self, mock_pool):
        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "ACC-TEST-001"
        event.payload.schedule_id = "SCHED-001"
        event.payload.payments = []

        await handle_schedule_updated(mock_pool, event)

        assert mock_pool.inserts_into("loan_accounts_repayment_schedule_payments") == []

    @pytest.mark.asyncio
    async def test_none_payments(self, mock_pool):
        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "ACC-TEST-001"
        event.payload.schedule_id = "SCHED-001"
        event.payload.payments = None

        await handle_schedule_updated(mock_pool, event)

        assert mock_pool.inserts_into("loan_accounts_repayment_schedule_payments") == []

    @pytest.mark.asyncio
    async def test_out_of_order_payment_creates_row(self, mock_pool):
        """Out-of-order: schedule.updated before schedule.created creates a
        placeholder row (no due_date/amount) via the same upsert path."""
        mock_pool.set_fetchval("parent-uuid")
        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "ACC-TEST-001"
        event.payload.schedule_id = "SCHED-001"
        event.payload.payments = [
            self._make_payment(
                1, "paid", "2024-01-22", Decimal("145.00"), Decimal("0"), ["TXN-001"]
            )
        ]

        await handle_schedule_updated(mock_pool, event)

        # One INSERT, no due_date in values dict (only the columns the
        # handler explicitly set get parsed; absence === leave alone on
        # conflict / NULL on insert).
        row = mock_pool.inserts_into("loan_accounts_repayment_schedule_payments")[0]
        assert "due_date" not in row  # handler didn't supply it
        assert row["status"] == "paid"


# =============================================================================
# Schedule created — CASE preserves non-'scheduled' status on conflict
# =============================================================================


class TestScheduleCreatedOutOfOrder:
    """The handler emits ON CONFLICT … DO UPDATE with a CASE expression that
    preserves any non-'scheduled' status that already exists in the row. The
    CASE only fires at the database level on conflict — these unit tests
    verify that the SQL was emitted correctly. Real CASE evaluation is
    integration-tested in Phase 4."""

    @pytest.mark.asyncio
    async def test_emits_case_for_status_preservation(self, mock_pool):
        mock_pool.set_fetchval("parent-uuid")
        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "ACC-TEST-001"
        event.payload.schedule_id = "SCHED-001"
        event.payload.n_payments = 1
        event.payload.payment_frequency = "fortnightly"
        event.payload.created_date = "2024-01-15"
        p = MagicMock(); p.payment_number = 1; p.due_date = "2024-01-22"; p.amount = Decimal("145.00")
        event.payload.payments = [p]

        await handle_schedule_created(mock_pool, event)

        call = [c for c in mock_pool.calls_against("loan_accounts_repayment_schedule_payments")
                if c.op == "INSERT"][0]
        assert "ON CONFLICT" in call.sql
        assert "CASE" in call.sql
        assert "!= 'scheduled'" in call.sql

    @pytest.mark.asyncio
    async def test_no_existing_schedule(self, mock_pool):
        mock_pool.set_fetchval("parent-uuid")
        event = MagicMock()
        event.payload = MagicMock()
        event.payload.account_id = "ACC-TEST-001"
        event.payload.schedule_id = "SCHED-001"
        event.payload.n_payments = 1
        event.payload.payment_frequency = "fortnightly"
        event.payload.created_date = "2024-01-15"
        p = MagicMock(); p.payment_number = 1; p.due_date = "2024-01-22"; p.amount = Decimal("145.00")
        event.payload.payments = [p]

        await handle_schedule_created(mock_pool, event)
        row = mock_pool.inserts_into("loan_accounts_repayment_schedule_payments")[0]
        assert row["payment_number"] == 1


# =============================================================================
# Conversation handlers
# =============================================================================


class TestConversationHandlers:
    @pytest.mark.asyncio
    async def test_handle_conversation_started(self, mock_pool):
        event = {
            "cid": "CONV-TEST-001",
            "usr": "CUS-TEST-001",
            "app_number": "APP-12345",
            "timestamp": datetime.utcnow().isoformat(),
        }
        await handle_conversation_started(mock_pool, event)

        doc = mock_pool.last_insert("conversations")
        assert doc["conversation_id"] == "CONV-TEST-001"
        assert doc["customer_id_string"] == "CUS-TEST-001"
        assert doc["application_number"] == "APP-12345"
        assert doc["status"] == "active"

    @pytest.mark.asyncio
    async def test_handle_user_input(self, mock_pool):
        mock_pool.set_fetchval("parent-uuid")
        event = {
            "typ": "user_input",
            "cid": "CONV-TEST-001",
            "usr": "CUS-TEST-001",
            "payload": {
                "utterance": "I need a loan of $500",
                "created_at": datetime.utcnow().isoformat(),
            },
        }
        await handle_utterance(mock_pool, event)

        utterances = mock_pool.inserts_into("conversations_utterances")
        assert utterances
        u = utterances[-1]
        assert u["username"] == "customer"
        assert u["utterance"] == "I need a loan of $500"

    @pytest.mark.asyncio
    async def test_handle_assistant_response(self, mock_pool):
        mock_pool.set_fetchval("parent-uuid")
        event = {
            "typ": "assistant_response",
            "cid": "CONV-TEST-001",
            "usr": "CUS-TEST-001",
            "payload": {
                "utterance": "I can help you with that.",
                "rationale": "Customer requested loan",
                "created_at": datetime.utcnow().isoformat(),
            },
        }
        await handle_utterance(mock_pool, event)

        u = mock_pool.inserts_into("conversations_utterances")[-1]
        assert u["username"] == "assistant"
        assert u["utterance"] == "I can help you with that."
        assert u["rationale"] == "Customer requested loan"

    @pytest.mark.asyncio
    async def test_handle_final_decision_approved(self, mock_pool):
        await handle_final_decision(mock_pool, {"cid": "CONV-TEST-001", "decision": "APPROVED"})
        doc = mock_pool.last_insert("conversations")
        assert doc["status"] == "approved"
        assert doc["final_decision"] == "APPROVED"
        assert doc["decision_status"] == "approved"

    @pytest.mark.asyncio
    async def test_handle_final_decision_declined(self, mock_pool):
        await handle_final_decision(mock_pool, {"cid": "CONV-TEST-001", "decision": "DECLINED"})
        doc = mock_pool.last_insert("conversations")
        assert doc["status"] == "declined"
        assert doc["final_decision"] == "DECLINED"

    @pytest.mark.asyncio
    async def test_handle_assessment_identity_risk(self, mock_pool):
        event = {
            "typ": "identityRisk_assessment",
            "cid": "CONV-TEST-001",
            "payload": {"score": 85, "status": "low_risk"},
        }
        await handle_assessment(mock_pool, event)
        # The assessment ends up in an UPDATE that sets the jsonb column.
        updates = [
            c for c in mock_pool.calls_against("conversations")
            if c.op == "UPDATE" and "assessments_identity_risk" in c.values
        ]
        assert updates

    @pytest.mark.asyncio
    async def test_handle_assessment_serviceability(self, mock_pool):
        event = {
            "typ": "credit_assessment_serviceability_result",
            "cid": "CONV-TEST-001",
            "payload": {"result": "pass", "affordability": True},
        }
        await handle_assessment(mock_pool, event)
        updates = [
            c for c in mock_pool.calls_against("conversations")
            if c.op == "UPDATE" and "assessments_serviceability" in c.values
        ]
        assert updates

    @pytest.mark.asyncio
    async def test_handle_conversation_summary(self, mock_pool):
        mock_pool.set_fetchval("parent-uuid")
        event = {
            "cid": "CONV-TEST-001",
            "payload": {
                "purpose": "Loan application",
                "facts": ["Customer requested $500", "Income verified"],
            },
        }
        await handle_conversation_summary(mock_pool, event)

        # Purpose lands as a conversations column update; facts go to child table.
        purpose_insert = mock_pool.last_insert("conversations")
        assert purpose_insert is not None
        assert purpose_insert.get("purpose") == "Loan application"

        facts = mock_pool.inserts_into("conversations_facts")
        assert len(facts) == 2

    @pytest.mark.asyncio
    async def test_handle_noticeboard_updated(self, mock_pool):
        mock_pool.set_fetchval("parent-uuid")
        event = {
            "cid": "CONV-TEST-001",
            "payload": {
                "conversation_id": "CONV-TEST-001",
                "agent_name": "serviceability_agent::Serviceability Assessment",
                "post": "Customer income verified at $50,000 p.a.",
                "timestamp": datetime.utcnow().isoformat(),
            },
        }
        await handle_noticeboard_updated(mock_pool, event)

        n = mock_pool.inserts_into("conversations_noticeboard")[-1]
        assert n["agent_name"] == "serviceability_agent::Serviceability Assessment"
        assert n["topic"] == "Serviceability Assessment"
        assert "income verified" in n["content"]


# =============================================================================
# End-to-end lifecycle smoke
# =============================================================================


class TestEventProcessorIntegration:
    @pytest.mark.asyncio
    async def test_customer_loan_lifecycle(self, mock_pool):
        # 1. Customer
        cust = MagicMock()
        cust.payload = MagicMock()
        cust.payload.customer_id = "CUS-LIFECYCLE-001"
        cust.payload.first_name = "Test"
        cust.payload.last_name = "User"
        cust.payload.email_address = "test@test.com"
        cust.payload.mobile_phone_number = None
        cust.payload.date_of_birth = None
        cust.payload.ekyc_status = None
        cust.payload.residential_address = None
        await handle_customer_changed(mock_pool, cust)
        assert mock_pool.inserts_into("customers")

        # 2. Account — needs a customer uuid via fetchrow on customers.
        mock_pool.set_fetchrow({"id": "customer-uuid", "full_name": "Test User"})

        acc = MagicMock()
        acc.payload = MagicMock()
        acc.payload.account_id = "ACC-LIFECYCLE-001"
        acc.payload.account_number = "ACC-99999"
        acc.payload.customer_id = "CUS-LIFECYCLE-001"
        acc.payload.status = "ACTIVE"
        acc.payload.loan_amount = Decimal("500.00")
        acc.payload.loan_fee = Decimal("80.00")
        acc.payload.loan_total_payable = Decimal("580.00")
        acc.payload.current_balance = Decimal("580.00")
        acc.payload.opened_date = "2024-01-15"
        await handle_account_created(mock_pool, acc)
        assert mock_pool.inserts_into("loan_accounts")

        # 3. Schedule
        mock_pool.set_fetchval("loan-uuid")
        sched = MagicMock()
        sched.payload = MagicMock()
        sched.payload.account_id = "ACC-LIFECYCLE-001"
        sched.payload.schedule_id = "SCHED-LIFECYCLE-001"
        sched.payload.n_payments = 4
        sched.payload.payment_frequency = "fortnightly"
        sched.payload.created_date = "2024-01-15"
        sched.payload.payments = []
        await handle_schedule_created(mock_pool, sched)
        # Parent row upserted (one for account.created, one for schedule.created).
        assert len(mock_pool.inserts_into("loan_accounts")) >= 2

    @pytest.mark.asyncio
    async def test_conversation_lifecycle(self, mock_pool):
        mock_pool.set_fetchval("conv-parent-uuid")

        await handle_conversation_started(mock_pool, {
            "cid": "CONV-LIFECYCLE-001",
            "usr": "CUS-TEST-001",
            "app_number": "APP-99999",
        })
        await handle_utterance(mock_pool, {
            "typ": "user_input",
            "cid": "CONV-LIFECYCLE-001",
            "payload": {"utterance": "I need help"},
        })
        await handle_utterance(mock_pool, {
            "typ": "assistant_response",
            "cid": "CONV-LIFECYCLE-001",
            "payload": {"utterance": "I can help"},
        })
        await handle_final_decision(mock_pool, {
            "cid": "CONV-LIFECYCLE-001",
            "decision": "APPROVED",
        })

        # We expect: 1 INSERT from conversation_started + 2 from utterances'
        # ensure-row guard + 1 from final_decision = at least 4 INSERTs.
        assert len(mock_pool.inserts_into("conversations")) >= 4
        assert len(mock_pool.inserts_into("conversations_utterances")) == 2


# =============================================================================
# conversationSummary_changed
# =============================================================================


class TestConversationSummaryChangedHandler:
    @pytest.mark.asyncio
    async def test_sets_application_number(self, mock_pool):
        await handle_conversation_summary_changed(
            mock_pool, {"cid": "CONV-SC-001", "application_number": "APP-12345"}
        )
        doc = mock_pool.last_insert("conversations")
        assert doc["conversation_id"] == "CONV-SC-001"
        assert doc["application_number"] == "APP-12345"

    @pytest.mark.asyncio
    async def test_sets_application_number_from_payload(self, mock_pool):
        await handle_conversation_summary_changed(
            mock_pool, {"conv": "CONV-SC-002", "payload": {"application_number": "APP-99999"}}
        )
        doc = mock_pool.last_insert("conversations")
        assert doc["application_number"] == "APP-99999"

    @pytest.mark.asyncio
    async def test_upserts_with_active_status_on_insert(self, mock_pool):
        # The upsert_conversation helper always sets status='active' as the
        # insert-only default — verify the conflict clause is correct.
        await handle_conversation_summary_changed(
            mock_pool, {"cid": "CONV-SC-003", "application_number": "APP-11111"}
        )
        call = mock_pool.calls_against("conversations")[-1]
        assert call.conflict_columns == ["conversation_id"]
        # Active is one of the inserted values.
        doc = mock_pool.last_insert("conversations")
        assert doc["status"] == "active"

    @pytest.mark.asyncio
    async def test_sets_status_when_provided(self, mock_pool):
        await handle_conversation_summary_changed(
            mock_pool, {"cid": "CONV-SC-004", "status": "paused"}
        )
        doc = mock_pool.last_insert("conversations")
        assert doc["status"] == "paused"

    @pytest.mark.asyncio
    async def test_does_not_set_status_when_absent(self, mock_pool):
        # When the event has no status, the handler doesn't include it in the
        # SET clause — the row's existing value is preserved on conflict.
        await handle_conversation_summary_changed(
            mock_pool, {"cid": "CONV-SC-005", "application_number": "APP-22222"}
        )
        call = mock_pool.calls_against("conversations")[-1]
        # 'status' should not appear in the DO UPDATE clause; it's in the
        # insert-only base values but not refreshed on conflict.
        update_set = call.sql.split("DO UPDATE SET")[-1] if "DO UPDATE SET" in call.sql else ""
        assert "status = EXCLUDED.status" not in update_set
