"""
Integration Tests for Event Processor Handlers

Tests cover event handling for:
- Customer events (customer.changed.v1, customer.verified.v1)
- Account events (account.created.v1, account.schedule.created.v1)
- Conversation events (conversation_started, user_input, assistant_response, final_decision)

Based on Requirements/v2-servicing-app specifications.
"""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from decimal import Decimal

# Import handlers
from billie_servicing.handlers.customer import handle_customer_changed, handle_customer_verified
from billie_servicing.handlers.account import (
    handle_account_created,
    handle_account_updated,
    handle_account_status_changed,
    handle_schedule_created,
    handle_schedule_updated,
)
from billie_servicing.handlers.conversation import (
    handle_conversation_started,
    handle_utterance,
    handle_final_decision,
    handle_conversation_summary,
    handle_assessment,
    handle_noticeboard_updated,
)


class TestCustomerHandlers:
    """Tests for customer event handlers (F5: View Customer Details)."""

    @pytest.mark.asyncio
    async def test_handle_customer_changed_creates_new_customer(self, mock_db):
        """F5.1: Should create a new customer from customer.changed.v1 event."""
        # Create mock parsed event
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.customer_id = "CUS-TEST-001"
        mock_event.payload.first_name = "John"
        mock_event.payload.last_name = "Smith"
        mock_event.payload.email_address = "john@test.com"
        mock_event.payload.mobile_phone_number = "0412345678"
        mock_event.payload.date_of_birth = "1985-06-15"
        mock_event.payload.ekyc_status = "successful"
        mock_event.payload.residential_address = None

        await handle_customer_changed(mock_db, mock_event)

        # Verify update was called
        mock_db.customers.update_one.assert_called_once()
        call_args = mock_db.customers.update_one.call_args
        
        # Verify query filter
        assert call_args[0][0] == {"customerId": "CUS-TEST-001"}
        
        # Verify document structure
        update_doc = call_args[0][1]["$set"]
        assert update_doc["customerId"] == "CUS-TEST-001"
        assert update_doc["firstName"] == "John"
        assert update_doc["lastName"] == "Smith"
        assert update_doc["fullName"] == "John Smith"
        assert update_doc["emailAddress"] == "john@test.com"

    @pytest.mark.asyncio
    async def test_handle_customer_changed_with_address(self, mock_db):
        """F5.1: Should store residential address with all fields."""
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.customer_id = "CUS-TEST-002"
        mock_event.payload.first_name = "Jane"
        mock_event.payload.last_name = "Doe"
        mock_event.payload.email_address = None
        mock_event.payload.mobile_phone_number = None
        mock_event.payload.date_of_birth = None
        mock_event.payload.ekyc_status = None
        
        # Mock address object
        mock_addr = MagicMock()
        mock_addr.street_number = "123"
        mock_addr.street_name = "Test"
        mock_addr.street_type = "St"
        mock_addr.unit_number = None
        mock_addr.suburb = "Sydney"
        mock_addr.state = "NSW"
        mock_addr.postcode = "2000"
        mock_addr.country = "Australia"
        mock_addr.full_address = "123 Test St, Sydney NSW 2000"
        mock_event.payload.residential_address = mock_addr

        await handle_customer_changed(mock_db, mock_event)

        call_args = mock_db.customers.update_one.call_args
        update_doc = call_args[0][1]["$set"]
        
        assert "residentialAddress" in update_doc
        addr = update_doc["residentialAddress"]
        assert addr["streetNumber"] == "123"
        assert addr["streetName"] == "Test"
        assert addr["suburb"] == "Sydney"
        assert addr["state"] == "NSW"
        assert addr["fullAddress"] == "123 Test St, Sydney NSW 2000"

    @pytest.mark.asyncio
    async def test_handle_customer_verified(self, mock_db):
        """F5.1: Should set identityVerified flag on customer.verified.v1."""
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.customer_id = "CUS-TEST-003"

        await handle_customer_verified(mock_db, mock_event)

        call_args = mock_db.customers.update_one.call_args
        update_doc = call_args[0][1]["$set"]
        
        assert update_doc["identityVerified"] is True
        assert update_doc["ekycStatus"] == "successful"


class TestAccountHandlers:
    """Tests for account event handlers (F1: View Loan Accounts)."""

    @pytest.mark.asyncio
    async def test_handle_account_created(self, mock_db):
        """F1.2: Should create loan account from account.created.v1."""
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.account_number = "ACC-12345"
        mock_event.payload.customer_id = "CUS-TEST-001"
        mock_event.payload.status = "ACTIVE"
        mock_event.payload.loan_amount = Decimal("500.00")
        mock_event.payload.loan_fee = Decimal("80.00")
        mock_event.payload.loan_total_payable = Decimal("580.00")
        mock_event.payload.current_balance = Decimal("580.00")
        mock_event.payload.opened_date = "2024-01-15"

        await handle_account_created(mock_db, mock_event)

        mock_db["loan-accounts"].update_one.assert_called_once()
        call_args = mock_db["loan-accounts"].update_one.call_args
        
        # Verify query filter
        assert call_args[0][0] == {"loanAccountId": "ACC-TEST-001"}
        
        # Verify document structure
        update_doc = call_args[0][1]["$set"]
        assert update_doc["loanAccountId"] == "ACC-TEST-001"
        assert update_doc["accountNumber"] == "ACC-12345"
        assert update_doc["customerIdString"] == "CUS-TEST-001"
        assert update_doc["loanTerms"]["loanAmount"] == 500.00
        assert update_doc["loanTerms"]["loanFee"] == 80.00
        assert update_doc["loanTerms"]["totalPayable"] == 580.00
        assert update_doc["accountStatus"] == "active"

    @pytest.mark.asyncio
    async def test_handle_account_status_mapping(self, mock_db):
        """F1.3: Should correctly map SDK status to display status."""
        test_cases = [
            ("PENDING", "active"),
            ("ACTIVE", "active"),
            ("SUSPENDED", "in_arrears"),
            ("CLOSED", "paid_off"),
        ]

        for sdk_status, expected_status in test_cases:
            mock_db["loan-accounts"].update_one.reset_mock()
            
            mock_event = MagicMock()
            mock_event.payload = MagicMock()
            mock_event.payload.account_id = f"ACC-{sdk_status}"
            mock_event.payload.account_number = f"ACC-{sdk_status}"
            mock_event.payload.customer_id = "CUS-TEST"
            mock_event.payload.status = sdk_status
            mock_event.payload.loan_amount = Decimal("500.00")
            mock_event.payload.loan_fee = Decimal("80.00")
            mock_event.payload.loan_total_payable = Decimal("580.00")
            mock_event.payload.current_balance = Decimal("580.00")
            mock_event.payload.opened_date = "2024-01-15"

            await handle_account_created(mock_db, mock_event)

            call_args = mock_db["loan-accounts"].update_one.call_args
            update_doc = call_args[0][1]["$set"]
            
            assert update_doc["accountStatus"] == expected_status, \
                f"Expected {sdk_status} -> {expected_status}, got {update_doc['accountStatus']}"

    @pytest.mark.asyncio
    async def test_handle_schedule_created(self, mock_db):
        """F1.4: Should add repayment schedule from account.schedule.created.v1."""
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        mock_event.payload.n_payments = 4
        mock_event.payload.payment_frequency = "fortnightly"
        mock_event.payload.created_date = "2024-01-15"
        
        # Mock payments
        mock_payment1 = MagicMock()
        mock_payment1.payment_number = 1
        mock_payment1.due_date = "2024-01-22"
        mock_payment1.amount = Decimal("145.00")
        
        mock_payment2 = MagicMock()
        mock_payment2.payment_number = 2
        mock_payment2.due_date = "2024-02-05"
        mock_payment2.amount = Decimal("145.00")
        
        mock_event.payload.payments = [mock_payment1, mock_payment2]

        await handle_schedule_created(mock_db, mock_event)

        mock_db["loan-accounts"].update_one.assert_called_once()
        call_args = mock_db["loan-accounts"].update_one.call_args
        update_doc = call_args[0][1]["$set"]
        
        schedule = update_doc["repaymentSchedule"]
        assert schedule["scheduleId"] == "SCHED-001"
        assert schedule["numberOfPayments"] == 4
        assert schedule["paymentFrequency"] == "fortnightly"
        assert len(schedule["payments"]) == 2
        assert schedule["payments"][0]["paymentNumber"] == 1
        assert schedule["payments"][0]["amount"] == 145.00
        assert schedule["payments"][0]["status"] == "scheduled"


class TestScheduleUpdatedHandler:
    """Tests for account.schedule.updated.v1 event handler (AC: 1, 2, 3, 4, 6)."""

    @pytest.mark.asyncio
    async def test_handle_schedule_updated_single_payment_paid(self, mock_db):
        """AC1, AC2: Should update single payment status from scheduled to paid."""
        # Mock successful update (payment found)
        mock_db["loan-accounts"].update_one = AsyncMock(
            return_value=MagicMock(matched_count=1, modified_count=1)
        )
        
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        
        # Single payment update - using SDK field names
        mock_payment = MagicMock()
        mock_payment.payment_number = 1
        mock_payment.status = "paid"
        mock_payment.paid_date = "2024-01-22"
        mock_payment.amount_paid = Decimal("145.00")
        mock_payment.amount_remaining = Decimal("0")
        mock_payment.linked_transaction_ids = ["TXN-001"]
        mock_payment.last_updated = "2024-01-22T10:00:00Z"
        mock_event.payload.payments = [mock_payment]

        await handle_schedule_updated(mock_db, mock_event)

        # Verify update was called once (no fallback needed)
        mock_db["loan-accounts"].update_one.assert_called_once()
        call_args = mock_db["loan-accounts"].update_one.call_args
        
        # Verify query filter uses positional operator
        query = call_args[0][0]
        assert query["loanAccountId"] == "ACC-TEST-001"
        assert query["repaymentSchedule.payments.paymentNumber"] == 1
        
        # Verify update document - using correct field names
        update_doc = call_args[0][1]["$set"]
        assert update_doc["repaymentSchedule.payments.$.status"] == "paid"
        assert update_doc["repaymentSchedule.payments.$.paidDate"] == "2024-01-22"
        assert update_doc["repaymentSchedule.payments.$.amountPaid"] == 145.00
        assert update_doc["repaymentSchedule.payments.$.amountRemaining"] == 0
        assert update_doc["repaymentSchedule.payments.$.linkedTransactionIds"] == ["TXN-001"]
        assert "updatedAt" in update_doc

    @pytest.mark.asyncio
    async def test_handle_schedule_updated_multiple_payments(self, mock_db):
        """AC2: Should update multiple payments in a single event."""
        # Mock successful updates (payments found)
        mock_db["loan-accounts"].update_one = AsyncMock(
            return_value=MagicMock(matched_count=1, modified_count=1)
        )
        
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        
        # Multiple payment updates - using SDK field names
        mock_payment1 = MagicMock()
        mock_payment1.payment_number = 1
        mock_payment1.status = "paid"
        mock_payment1.paid_date = "2024-01-22"
        mock_payment1.amount_paid = Decimal("145.00")
        mock_payment1.amount_remaining = Decimal("0")
        mock_payment1.linked_transaction_ids = ["TXN-001"]
        
        mock_payment2 = MagicMock()
        mock_payment2.payment_number = 2
        mock_payment2.status = "paid"
        mock_payment2.paid_date = "2024-02-05"
        mock_payment2.amount_paid = Decimal("145.00")
        mock_payment2.amount_remaining = Decimal("0")
        mock_payment2.linked_transaction_ids = ["TXN-002"]
        
        mock_event.payload.payments = [mock_payment1, mock_payment2]

        await handle_schedule_updated(mock_db, mock_event)

        # Verify update was called twice (once per payment)
        assert mock_db["loan-accounts"].update_one.call_count == 2
        
        # Verify first payment update
        call_args_1 = mock_db["loan-accounts"].update_one.call_args_list[0]
        assert call_args_1[0][0]["repaymentSchedule.payments.paymentNumber"] == 1
        
        # Verify second payment update
        call_args_2 = mock_db["loan-accounts"].update_one.call_args_list[1]
        assert call_args_2[0][0]["repaymentSchedule.payments.paymentNumber"] == 2

    @pytest.mark.asyncio
    async def test_handle_schedule_updated_partial_payment(self, mock_db):
        """AC3: Should handle partial payment status."""
        # Mock successful update (payment found)
        mock_db["loan-accounts"].update_one = AsyncMock(
            return_value=MagicMock(matched_count=1, modified_count=1)
        )
        
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        
        mock_payment = MagicMock()
        mock_payment.payment_number = 1
        mock_payment.status = "partial"
        mock_payment.paid_date = None  # Partial payment may not have paid_date
        mock_payment.amount_paid = Decimal("75.00")  # Partial amount
        mock_payment.amount_remaining = Decimal("70.00")
        mock_payment.linked_transaction_ids = ["TXN-001", "TXN-002"]
        mock_event.payload.payments = [mock_payment]

        await handle_schedule_updated(mock_db, mock_event)

        call_args = mock_db["loan-accounts"].update_one.call_args
        update_doc = call_args[0][1]["$set"]
        
        assert update_doc["repaymentSchedule.payments.$.status"] == "partial"
        assert update_doc["repaymentSchedule.payments.$.amountPaid"] == 75.00
        assert update_doc["repaymentSchedule.payments.$.amountRemaining"] == 70.00
        assert update_doc["repaymentSchedule.payments.$.linkedTransactionIds"] == ["TXN-001", "TXN-002"]

    @pytest.mark.asyncio
    async def test_handle_schedule_updated_missed_payment(self, mock_db):
        """AC4: Should handle missed payment status."""
        # Mock successful update (payment found)
        mock_db["loan-accounts"].update_one = AsyncMock(
            return_value=MagicMock(matched_count=1, modified_count=1)
        )
        
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        
        mock_payment = MagicMock()
        mock_payment.payment_number = 1
        mock_payment.status = "missed"
        # Missed payments don't have paid_date or amount_paid
        del mock_payment.paid_date
        del mock_payment.amount_paid
        del mock_payment.amount_remaining
        del mock_payment.linked_transaction_ids
        mock_event.payload.payments = [mock_payment]

        await handle_schedule_updated(mock_db, mock_event)

        call_args = mock_db["loan-accounts"].update_one.call_args
        update_doc = call_args[0][1]["$set"]
        
        assert update_doc["repaymentSchedule.payments.$.status"] == "missed"
        # Should not have paidDate or paidAmount for missed payments
        assert "repaymentSchedule.payments.$.paidDate" not in update_doc
        assert "repaymentSchedule.payments.$.paidAmount" not in update_doc

    @pytest.mark.asyncio
    async def test_handle_schedule_updated_status_case_insensitive(self, mock_db):
        """Should handle uppercase status values from SDK."""
        # Mock successful update (payment found)
        mock_db["loan-accounts"].update_one = AsyncMock(
            return_value=MagicMock(matched_count=1, modified_count=1)
        )
        
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        
        mock_payment = MagicMock()
        mock_payment.payment_number = 1
        mock_payment.status = "PAID"  # Uppercase from SDK
        mock_payment.paid_date = "2024-01-22"
        mock_payment.amount_paid = Decimal("145.00")
        mock_payment.amount_remaining = Decimal("0")
        mock_payment.linked_transaction_ids = ["TXN-001"]
        mock_event.payload.payments = [mock_payment]

        await handle_schedule_updated(mock_db, mock_event)

        call_args = mock_db["loan-accounts"].update_one.call_args
        update_doc = call_args[0][1]["$set"]
        
        # Should be normalized to lowercase
        assert update_doc["repaymentSchedule.payments.$.status"] == "paid"

    @pytest.mark.asyncio
    async def test_handle_schedule_updated_no_payments(self, mock_db):
        """Should handle event with no payment updates gracefully."""
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        mock_event.payload.payments = []

        await handle_schedule_updated(mock_db, mock_event)

        # Should not call update_one when there are no payments
        mock_db["loan-accounts"].update_one.assert_not_called()

    @pytest.mark.asyncio
    async def test_handle_schedule_updated_none_payments(self, mock_db):
        """Should handle event with None payments gracefully."""
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        mock_event.payload.payments = None

        await handle_schedule_updated(mock_db, mock_event)

        # Should not call update_one when payments is None
        mock_db["loan-accounts"].update_one.assert_not_called()

    @pytest.mark.asyncio
    async def test_handle_schedule_updated_preserves_other_payments(self, mock_db):
        """AC2: Updating one payment should not affect other payments."""
        # Mock successful update (payment found)
        mock_db["loan-accounts"].update_one = AsyncMock(
            return_value=MagicMock(matched_count=1, modified_count=1)
        )
        
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        
        # Only updating payment 3
        mock_payment = MagicMock()
        mock_payment.payment_number = 3
        mock_payment.status = "paid"
        mock_payment.paid_date = "2024-02-19"
        mock_payment.amount_paid = Decimal("145.00")
        mock_payment.amount_remaining = Decimal("0")
        mock_payment.linked_transaction_ids = ["TXN-003"]
        mock_event.payload.payments = [mock_payment]

        await handle_schedule_updated(mock_db, mock_event)

        # Verify query only targets payment 3
        call_args = mock_db["loan-accounts"].update_one.call_args_list[0]
        query = call_args[0][0]
        assert query["repaymentSchedule.payments.paymentNumber"] == 3

    @pytest.mark.asyncio
    async def test_handle_schedule_updated_creates_placeholder_when_not_found(self, mock_db):
        """Out-of-order: Should create placeholder when payment doesn't exist."""
        # First update returns no match (payment not found)
        mock_db["loan-accounts"].update_one = AsyncMock(
            side_effect=[
                MagicMock(matched_count=0, modified_count=0),  # First call - not found
                MagicMock(matched_count=0, modified_count=0, upserted_id="new-id"),  # Upsert
            ]
        )
        
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        
        # Use SDK field names
        mock_payment = MagicMock()
        mock_payment.payment_number = 1
        mock_payment.status = "paid"
        mock_payment.paid_date = "2024-01-22"
        mock_payment.amount_paid = Decimal("145.00")
        mock_payment.amount_remaining = Decimal("0")
        mock_payment.linked_transaction_ids = ["TXN-001"]
        mock_event.payload.payments = [mock_payment]

        await handle_schedule_updated(mock_db, mock_event)

        # Should have called update_one twice
        assert mock_db["loan-accounts"].update_one.call_count == 2
        
        # Second call should be the upsert with $push
        upsert_call = mock_db["loan-accounts"].update_one.call_args_list[1]
        assert upsert_call[1].get("upsert") is True
        
        update_doc = upsert_call[0][1]
        assert "$push" in update_doc
        push_op = update_doc["$push"]["repaymentSchedule.payments"]
        pushed_payment = push_op["$each"][0]
        assert pushed_payment["paymentNumber"] == 1
        assert pushed_payment["status"] == "paid"
        assert pushed_payment["paidDate"] == "2024-01-22"
        assert pushed_payment["amountPaid"] == 145.00
        assert pushed_payment["amountRemaining"] == 0
        assert pushed_payment["linkedTransactionIds"] == ["TXN-001"]
        assert push_op["$slice"] == 100


class TestScheduleCreatedOutOfOrder:
    """Tests for schedule.created handling out-of-order events."""

    @pytest.mark.asyncio
    async def test_handle_schedule_created_preserves_existing_paid_status(self, mock_db):
        """Out-of-order: schedule.created should preserve 'paid' status from earlier update."""
        # Simulate existing schedule with payment 1 already marked as paid
        mock_db["loan-accounts"].find_one = AsyncMock(return_value={
            "loanAccountId": "ACC-TEST-001",
            "repaymentSchedule": {
                "payments": [
                    {"paymentNumber": 1, "status": "paid", "paidDate": "2024-01-22", "amountPaid": 145.00, "amountRemaining": 0, "linkedTransactionIds": ["TXN-001"]},
                ]
            }
        })
        
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        mock_event.payload.n_payments = 4
        mock_event.payload.payment_frequency = "fortnightly"
        mock_event.payload.created_date = "2024-01-15"
        
        # Payments from the create event
        mock_payment1 = MagicMock()
        mock_payment1.payment_number = 1
        mock_payment1.due_date = "2024-01-22"
        mock_payment1.amount = Decimal("145.00")
        
        mock_payment2 = MagicMock()
        mock_payment2.payment_number = 2
        mock_payment2.due_date = "2024-02-05"
        mock_payment2.amount = Decimal("145.00")
        
        mock_event.payload.payments = [mock_payment1, mock_payment2]

        await handle_schedule_created(mock_db, mock_event)

        # Verify update was called
        mock_db["loan-accounts"].update_one.assert_called_once()
        call_args = mock_db["loan-accounts"].update_one.call_args
        update_doc = call_args[0][1]["$set"]
        
        schedule = update_doc["repaymentSchedule"]
        payments = schedule["payments"]
        
        # Payment 1 should preserve "paid" status and all associated fields
        assert payments[0]["paymentNumber"] == 1
        assert payments[0]["status"] == "paid"
        assert payments[0]["paidDate"] == "2024-01-22"
        assert payments[0]["amountPaid"] == 145.00
        assert payments[0]["amountRemaining"] == 0
        assert payments[0]["linkedTransactionIds"] == ["TXN-001"]
        
        # Payment 2 should be "scheduled" (no prior update)
        assert payments[1]["paymentNumber"] == 2
        assert payments[1]["status"] == "scheduled"

    @pytest.mark.asyncio
    async def test_handle_schedule_created_preserves_missed_status(self, mock_db):
        """Out-of-order: schedule.created should preserve 'missed' status."""
        mock_db["loan-accounts"].find_one = AsyncMock(return_value={
            "loanAccountId": "ACC-TEST-001",
            "repaymentSchedule": {
                "payments": [
                    {"paymentNumber": 1, "status": "missed"},
                ]
            }
        })
        
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        mock_event.payload.n_payments = 2
        mock_event.payload.payment_frequency = "fortnightly"
        mock_event.payload.created_date = "2024-01-15"
        
        mock_payment1 = MagicMock()
        mock_payment1.payment_number = 1
        mock_payment1.due_date = "2024-01-22"
        mock_payment1.amount = Decimal("145.00")
        
        mock_event.payload.payments = [mock_payment1]

        await handle_schedule_created(mock_db, mock_event)

        call_args = mock_db["loan-accounts"].update_one.call_args
        update_doc = call_args[0][1]["$set"]
        payments = update_doc["repaymentSchedule"]["payments"]
        
        # Payment 1 should preserve "missed" status
        assert payments[0]["status"] == "missed"

    @pytest.mark.asyncio
    async def test_handle_schedule_created_does_not_preserve_scheduled_status(self, mock_db):
        """schedule.created should overwrite 'scheduled' status (default, not updated)."""
        mock_db["loan-accounts"].find_one = AsyncMock(return_value={
            "loanAccountId": "ACC-TEST-001",
            "repaymentSchedule": {
                "payments": [
                    {"paymentNumber": 1, "status": "scheduled"},
                ]
            }
        })
        
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        mock_event.payload.n_payments = 1
        mock_event.payload.payment_frequency = "fortnightly"
        mock_event.payload.created_date = "2024-01-15"
        
        mock_payment1 = MagicMock()
        mock_payment1.payment_number = 1
        mock_payment1.due_date = "2024-01-22"
        mock_payment1.amount = Decimal("145.00")
        
        mock_event.payload.payments = [mock_payment1]

        await handle_schedule_created(mock_db, mock_event)

        call_args = mock_db["loan-accounts"].update_one.call_args
        update_doc = call_args[0][1]["$set"]
        payments = update_doc["repaymentSchedule"]["payments"]
        
        # "scheduled" status is not preserved (it's the default)
        assert payments[0]["status"] == "scheduled"
        # But should NOT have paidDate/amountPaid
        assert "paidDate" not in payments[0]
        assert "amountPaid" not in payments[0]

    @pytest.mark.asyncio
    async def test_handle_schedule_created_no_existing_schedule(self, mock_db):
        """schedule.created with no prior schedule should set all to scheduled."""
        mock_db["loan-accounts"].find_one = AsyncMock(return_value=None)
        
        mock_event = MagicMock()
        mock_event.payload = MagicMock()
        mock_event.payload.account_id = "ACC-TEST-001"
        mock_event.payload.schedule_id = "SCHED-001"
        mock_event.payload.n_payments = 2
        mock_event.payload.payment_frequency = "fortnightly"
        mock_event.payload.created_date = "2024-01-15"
        
        mock_payment1 = MagicMock()
        mock_payment1.payment_number = 1
        mock_payment1.due_date = "2024-01-22"
        mock_payment1.amount = Decimal("145.00")
        
        mock_event.payload.payments = [mock_payment1]

        await handle_schedule_created(mock_db, mock_event)

        call_args = mock_db["loan-accounts"].update_one.call_args
        update_doc = call_args[0][1]["$set"]
        payments = update_doc["repaymentSchedule"]["payments"]
        
        assert payments[0]["status"] == "scheduled"


class TestConversationHandlers:
    """Tests for conversation event handlers (F4: View Conversations)."""

    @pytest.mark.asyncio
    async def test_handle_conversation_started(self, mock_db):
        """F4.1: Should create conversation from conversation_started event."""
        event = {
            "cid": "CONV-TEST-001",
            "usr": "CUS-TEST-001",
            "app_number": "APP-12345",
            "timestamp": datetime.utcnow().isoformat(),
        }

        await handle_conversation_started(mock_db, event)

        mock_db.conversations.update_one.assert_called_once()
        call_args = mock_db.conversations.update_one.call_args
        
        # Verify query filter
        assert call_args[0][0] == {"conversationId": "CONV-TEST-001"}
        
        # Verify document structure
        update_doc = call_args[0][1]["$set"]
        assert update_doc["conversationId"] == "CONV-TEST-001"
        assert update_doc["customerIdString"] == "CUS-TEST-001"
        assert update_doc["applicationNumber"] == "APP-12345"
        assert update_doc["status"] == "active"
        assert update_doc["utterances"] == []

    @pytest.mark.asyncio
    async def test_handle_user_input(self, mock_db):
        """F4.2: Should add customer utterance to conversation."""
        # Mock existing conversation
        mock_db.conversations.find_one = AsyncMock(
            return_value={"conversationId": "CONV-TEST-001"}
        )
        
        event = {
            "typ": "user_input",
            "cid": "CONV-TEST-001",
            "usr": "CUS-TEST-001",
            "payload": {
                "utterance": "I need a loan of $500",
                "created_at": datetime.utcnow().isoformat(),
            },
        }

        await handle_utterance(mock_db, event)

        mock_db.conversations.update_one.assert_called()
        call_args = mock_db.conversations.update_one.call_args
        
        # Verify $push operation for utterances (uses $each/$slice for bounded arrays)
        push_op = call_args[0][1]["$push"]["utterances"]
        push_doc = push_op["$each"][0]
        assert push_doc["username"] == "customer"
        assert push_doc["utterance"] == "I need a loan of $500"

    @pytest.mark.asyncio
    async def test_handle_assistant_response(self, mock_db):
        """F4.2: Should add assistant utterance with rationale."""
        mock_db.conversations.find_one = AsyncMock(
            return_value={"conversationId": "CONV-TEST-001"}
        )
        
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

        await handle_utterance(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        push_op = call_args[0][1]["$push"]["utterances"]
        push_doc = push_op["$each"][0]

        assert push_doc["username"] == "assistant"
        assert push_doc["utterance"] == "I can help you with that."
        assert push_doc["rationale"] == "Customer requested loan"

    @pytest.mark.asyncio
    async def test_handle_final_decision_approved(self, mock_db):
        """F4.3: Should update status to approved on APPROVED decision."""
        event = {
            "cid": "CONV-TEST-001",
            "decision": "APPROVED",
        }

        await handle_final_decision(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        update_doc = call_args[0][1]["$set"]
        
        assert update_doc["status"] == "approved"
        assert update_doc["finalDecision"] == "APPROVED"

    @pytest.mark.asyncio
    async def test_handle_final_decision_declined(self, mock_db):
        """F4.3: Should update status to declined on DECLINED decision."""
        event = {
            "cid": "CONV-TEST-001",
            "decision": "DECLINED",
        }

        await handle_final_decision(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        update_doc = call_args[0][1]["$set"]
        
        assert update_doc["status"] == "declined"
        assert update_doc["finalDecision"] == "DECLINED"

    @pytest.mark.asyncio
    async def test_handle_assessment_identity_risk(self, mock_db):
        """F4.3: Should store identity risk assessment."""
        event = {
            "typ": "identityRisk_assessment",
            "cid": "CONV-TEST-001",
            "payload": {
                "score": 85,
                "status": "low_risk",
            },
        }

        await handle_assessment(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        update_doc = call_args[0][1]["$set"]
        
        assert "assessments.identityRisk" in update_doc

    @pytest.mark.asyncio
    async def test_handle_assessment_serviceability(self, mock_db):
        """F4.3: Should store serviceability assessment."""
        event = {
            "typ": "credit_assessment_serviceability_result",
            "cid": "CONV-TEST-001",
            "payload": {
                "result": "pass",
                "affordability": True,
            },
        }

        await handle_assessment(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        update_doc = call_args[0][1]["$set"]
        
        assert "assessments.serviceability" in update_doc

    @pytest.mark.asyncio
    async def test_handle_conversation_summary(self, mock_db):
        """F4.2: Should store conversation summary and facts."""
        event = {
            "cid": "CONV-TEST-001",
            "payload": {
                "purpose": "Loan application",
                "facts": ["Customer requested $500", "Income verified"],
            },
        }

        await handle_conversation_summary(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        update_doc = call_args[0][1]["$set"]
        
        assert update_doc["purpose"] == "Loan application"
        assert len(update_doc["facts"]) == 2

    @pytest.mark.asyncio
    async def test_handle_noticeboard_updated(self, mock_db):
        """F4.3: Should add noticeboard entry from payload.post."""
        event = {
            "cid": "CONV-TEST-001",
            "payload": {
                "conversation_id": "CONV-TEST-001",
                "agent_name": "serviceability_agent::Serviceability Assessment",
                "post": "Customer income verified at $50,000 p.a.",
                "timestamp": datetime.utcnow().isoformat(),
            },
        }

        await handle_noticeboard_updated(mock_db, event)

        call_args = mock_db.conversations.update_one.call_args
        push_op = call_args[0][1]["$push"]["noticeboard"]
        push_doc = push_op["$each"][0]

        assert push_doc["agentName"] == "serviceability_agent::Serviceability Assessment"
        assert push_doc["topic"] == "Serviceability Assessment"
        assert "income verified" in push_doc["content"]


class TestEventProcessorIntegration:
    """Integration tests for the full event processing flow."""

    @pytest.mark.asyncio
    async def test_customer_loan_lifecycle(self, mock_db):
        """Test complete customer -> account -> schedule flow."""
        # 1. Create customer
        customer_event = MagicMock()
        customer_event.payload = MagicMock()
        customer_event.payload.customer_id = "CUS-LIFECYCLE-001"
        customer_event.payload.first_name = "Test"
        customer_event.payload.last_name = "User"
        customer_event.payload.email_address = "test@test.com"
        customer_event.payload.mobile_phone_number = None
        customer_event.payload.date_of_birth = None
        customer_event.payload.ekyc_status = None
        customer_event.payload.residential_address = None

        await handle_customer_changed(mock_db, customer_event)
        assert mock_db.customers.update_one.called

        # 2. Create account
        mock_db.customers.find_one = AsyncMock(
            return_value={"_id": "mongo-id", "fullName": "Test User"}
        )
        
        account_event = MagicMock()
        account_event.payload = MagicMock()
        account_event.payload.account_id = "ACC-LIFECYCLE-001"
        account_event.payload.account_number = "ACC-99999"
        account_event.payload.customer_id = "CUS-LIFECYCLE-001"
        account_event.payload.status = "ACTIVE"
        account_event.payload.loan_amount = Decimal("500.00")
        account_event.payload.loan_fee = Decimal("80.00")
        account_event.payload.loan_total_payable = Decimal("580.00")
        account_event.payload.current_balance = Decimal("580.00")
        account_event.payload.opened_date = "2024-01-15"

        await handle_account_created(mock_db, account_event)
        assert mock_db["loan-accounts"].update_one.called

        # 3. Add schedule
        schedule_event = MagicMock()
        schedule_event.payload = MagicMock()
        schedule_event.payload.account_id = "ACC-LIFECYCLE-001"
        schedule_event.payload.schedule_id = "SCHED-LIFECYCLE-001"
        schedule_event.payload.n_payments = 4
        schedule_event.payload.payment_frequency = "fortnightly"
        schedule_event.payload.created_date = "2024-01-15"
        schedule_event.payload.payments = []

        await handle_schedule_created(mock_db, schedule_event)
        
        # Verify all three handlers were called
        assert mock_db.customers.update_one.call_count >= 1
        assert mock_db["loan-accounts"].update_one.call_count >= 2

    @pytest.mark.asyncio
    async def test_conversation_lifecycle(self, mock_db):
        """Test complete conversation flow from start to decision."""
        # 1. Start conversation
        start_event = {
            "cid": "CONV-LIFECYCLE-001",
            "usr": "CUS-TEST-001",
            "app_number": "APP-99999",
        }
        await handle_conversation_started(mock_db, start_event)
        
        # 2. User input
        mock_db.conversations.find_one = AsyncMock(
            return_value={"conversationId": "CONV-LIFECYCLE-001"}
        )
        
        input_event = {
            "typ": "user_input",
            "cid": "CONV-LIFECYCLE-001",
            "payload": {"utterance": "I need help"},
        }
        await handle_utterance(mock_db, input_event)
        
        # 3. Assistant response
        response_event = {
            "typ": "assistant_response",
            "cid": "CONV-LIFECYCLE-001",
            "payload": {"utterance": "I can help"},
        }
        await handle_utterance(mock_db, response_event)
        
        # 4. Final decision
        decision_event = {
            "cid": "CONV-LIFECYCLE-001",
            "decision": "APPROVED",
        }
        await handle_final_decision(mock_db, decision_event)
        
        # Verify conversation updates
        assert mock_db.conversations.update_one.call_count >= 4



class TestConversationSummaryChangedHandler:
    """Tests for conversationSummary_changed event handler."""

    @pytest.mark.asyncio
    async def test_sets_application_number(self, mock_db):
        """Should upsert conversation with applicationNumber from event."""
        from billie_servicing.handlers.conversation import handle_conversation_summary_changed
        event = {
            "cid": "CONV-SC-001",
            "application_number": "APP-12345",
        }
        await handle_conversation_summary_changed(mock_db, event)
        call_args = mock_db.conversations.update_one.call_args
        assert call_args[0][0] == {"conversationId": "CONV-SC-001"}
        set_doc = call_args[0][1]["$set"]
        assert set_doc["applicationNumber"] == "APP-12345"

    @pytest.mark.asyncio
    async def test_sets_application_number_from_payload(self, mock_db):
        """Should read applicationNumber from nested payload field."""
        from billie_servicing.handlers.conversation import handle_conversation_summary_changed
        event = {
            "conv": "CONV-SC-002",
            "payload": {"application_number": "APP-99999"},
        }
        await handle_conversation_summary_changed(mock_db, event)
        set_doc = mock_db.conversations.update_one.call_args[0][1]["$set"]
        assert set_doc["applicationNumber"] == "APP-99999"

    @pytest.mark.asyncio
    async def test_upserts_with_active_status_on_insert(self, mock_db):
        """Should set status=active in $setOnInsert so new docs get initialised."""
        from billie_servicing.handlers.conversation import handle_conversation_summary_changed
        event = {"cid": "CONV-SC-003", "application_number": "APP-11111"}
        await handle_conversation_summary_changed(mock_db, event)
        update = mock_db.conversations.update_one.call_args[0][1]
        assert update["$setOnInsert"]["status"] == "active"
        assert mock_db.conversations.update_one.call_args[1]["upsert"] is True

    @pytest.mark.asyncio
    async def test_sets_status_when_provided(self, mock_db):
        """Should update status field when event carries a status."""
        from billie_servicing.handlers.conversation import handle_conversation_summary_changed
        event = {"cid": "CONV-SC-004", "status": "paused"}
        await handle_conversation_summary_changed(mock_db, event)
        set_doc = mock_db.conversations.update_one.call_args[0][1]["$set"]
        assert set_doc["status"] == "paused"

    @pytest.mark.asyncio
    async def test_does_not_set_status_when_absent(self, mock_db):
        """Should not overwrite status when event has no status field."""
        from billie_servicing.handlers.conversation import handle_conversation_summary_changed
        event = {"cid": "CONV-SC-005", "application_number": "APP-22222"}
        await handle_conversation_summary_changed(mock_db, event)
        set_doc = mock_db.conversations.update_one.call_args[0][1]["$set"]
        assert "status" not in set_doc
