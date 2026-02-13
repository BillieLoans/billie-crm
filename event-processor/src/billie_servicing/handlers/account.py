"""Account event handlers using Billie Accounts SDK.

Handles events:
- account.created.v1
- account.updated.v1
- account.status_changed.v1
- account.schedule.created.v1
- account.schedule.updated.v1
"""

from datetime import datetime
from typing import Any

import structlog
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = structlog.get_logger()

# SDK AccountStatus to Payload accountStatus mapping
SDK_STATUS_MAP = {
    "PENDING": "active",
    "PENDING_DISBURSEMENT": "pending_disbursement",
    "ACTIVE": "active",
    "SUSPENDED": "in_arrears",
    "CLOSED": "paid_off",
}


async def handle_account_created(db: AsyncIOMotorDatabase, parsed_event: Any) -> None:
    """
    Handle account.created.v1 event.

    SDK Model: AccountCreatedV1
    Fields: account_id, account_number, customer_id, status, loan_amount,
            current_balance, loan_fee, loan_total_payable, opened_date
    """
    payload = parsed_event.payload
    account_id = payload.account_id
    customer_id = payload.customer_id

    log = logger.bind(account_id=account_id, customer_id=customer_id)
    log.info("Processing account.created.v1")

    # Get customer for relationship and denormalization
    customer = await db.customers.find_one({"customerId": customer_id})
    customer_mongo_id = customer.get("_id") if customer else None
    customer_name = customer.get("fullName", "") if customer else ""

    # Map SDK status to Payload status
    sdk_status = str(payload.status) if payload.status else "PENDING"
    # Remove enum prefix if present (e.g., "AccountStatus.ACTIVE" -> "ACTIVE")
    if "." in sdk_status:
        sdk_status = sdk_status.split(".")[-1]
    account_status = SDK_STATUS_MAP.get(sdk_status, "active")

    document = {
        "loanAccountId": account_id,
        "accountNumber": payload.account_number,
        "customerId": customer_mongo_id,
        "customerIdString": customer_id,  # Keep string version for queries
        "customerName": customer_name,
        "loanTerms": {
            "loanAmount": float(payload.loan_amount) if payload.loan_amount else None,
            "loanFee": float(payload.loan_fee) if payload.loan_fee else None,
            "totalPayable": (
                float(payload.loan_total_payable) if payload.loan_total_payable else None
            ),
            "openedDate": payload.opened_date,
        },
        "balances": {
            "currentBalance": float(payload.current_balance) if payload.current_balance else 0.0,
            "totalOutstanding": float(payload.current_balance) if payload.current_balance else 0.0,
            "totalPaid": 0.0,
        },
        "accountStatus": account_status,
        "sdkStatus": sdk_status,
        "updatedAt": datetime.utcnow(),
    }

    result = await db["loan-accounts"].update_one(
        {"loanAccountId": account_id},
        {
            "$set": document,
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )

    log.info(
        "Loan account upserted",
        matched=result.matched_count,
        modified=result.modified_count,
        upserted_id=str(result.upserted_id) if result.upserted_id else None,
    )


async def handle_account_updated(db: AsyncIOMotorDatabase, parsed_event: Any) -> None:
    """
    Handle account.updated.v1 event.

    Fields: account_id, current_balance, status, last_payment_date, last_payment_amount
    """
    payload = parsed_event.payload
    account_id = payload.account_id

    log = logger.bind(account_id=account_id)
    log.info("Processing account.updated.v1")

    update_doc: dict[str, Any] = {"updatedAt": datetime.utcnow()}

    current_balance_value = None
    if payload.current_balance is not None:
        current_balance_value = float(payload.current_balance)
        update_doc["balances.currentBalance"] = current_balance_value
        update_doc["balances.totalOutstanding"] = current_balance_value

    if payload.status:
        sdk_status = str(payload.status)
        if "." in sdk_status:
            sdk_status = sdk_status.split(".")[-1]
        update_doc["sdkStatus"] = sdk_status
        update_doc["accountStatus"] = SDK_STATUS_MAP.get(sdk_status, "active")
    elif current_balance_value is not None:
        # Some disbursement-driven account.updated events omit status.
        # If the account is currently pending disbursement and now has a positive balance,
        # infer that it has transitioned to ACTIVE.
        existing_account = await db["loan-accounts"].find_one(
            {"loanAccountId": account_id},
            {"accountStatus": 1},
        )
        if existing_account and existing_account.get("accountStatus") == "pending_disbursement":
            if current_balance_value > 0:
                update_doc["sdkStatus"] = "ACTIVE"
                update_doc["accountStatus"] = "active"
                log.info(
                    "Inferred status transition from pending_disbursement to active",
                    current_balance=current_balance_value,
                )

    if hasattr(payload, "last_payment_date") and payload.last_payment_date:
        update_doc["lastPayment.date"] = payload.last_payment_date

    if hasattr(payload, "last_payment_amount") and payload.last_payment_amount is not None:
        update_doc["lastPayment.amount"] = float(payload.last_payment_amount)

    result = await db["loan-accounts"].update_one(
        {"loanAccountId": account_id}, {"$set": update_doc}
    )

    log.info("Loan account updated", matched=result.matched_count, modified=result.modified_count)


async def handle_account_status_changed(db: AsyncIOMotorDatabase, parsed_event: Any) -> None:
    """
    Handle account.status_changed.v1 event.

    Fields: account_id, new_status, changed_at
    """
    payload = parsed_event.payload
    account_id = payload.account_id

    log = logger.bind(account_id=account_id)
    log.info("Processing account.status_changed.v1")

    sdk_status = str(payload.new_status)
    if "." in sdk_status:
        sdk_status = sdk_status.split(".")[-1]
    account_status = SDK_STATUS_MAP.get(sdk_status, "active")

    result = await db["loan-accounts"].update_one(
        {"loanAccountId": account_id},
        {
            "$set": {
                "sdkStatus": sdk_status,
                "accountStatus": account_status,
                "updatedAt": datetime.utcnow(),
            }
        },
    )

    log.info(
        "Account status changed",
        new_status=account_status,
        matched=result.matched_count,
        modified=result.modified_count,
    )


async def handle_schedule_created(db: AsyncIOMotorDatabase, parsed_event: Any) -> None:
    """
    Handle account.schedule.created.v1 event.

    Adds repayment schedule to loan account.
    Preserves existing payment statuses to handle out-of-order event processing
    (e.g., if schedule.updated arrived before schedule.created).

    Fields: account_id, schedule_id, loan_amount, total_amount, fee,
            n_payments, payment_frequency, payments[], created_date

    Payments[]: payment_number, due_date, amount
    """
    payload = parsed_event.payload
    account_id = payload.account_id

    log = logger.bind(account_id=account_id, schedule_id=payload.schedule_id)
    log.info("Processing account.schedule.created.v1")

    # Check if schedule already exists with payment statuses (out-of-order handling)
    existing_account = await db["loan-accounts"].find_one(
        {"loanAccountId": account_id},
        {"repaymentSchedule.payments": 1},
    )

    # Build a lookup of existing payment statuses
    existing_statuses: dict[int, dict[str, Any]] = {}
    if existing_account and existing_account.get("repaymentSchedule"):
        for p in existing_account["repaymentSchedule"].get("payments", []):
            payment_num = p.get("paymentNumber")
            if payment_num is not None:
                # Only preserve if status is not "scheduled" (was updated)
                if p.get("status") and p.get("status") != "scheduled":
                    existing_statuses[payment_num] = {
                        "status": p.get("status"),
                        "paidDate": p.get("paidDate"),
                        "amountPaid": p.get("amountPaid"),
                        "amountRemaining": p.get("amountRemaining"),
                        "linkedTransactionIds": p.get("linkedTransactionIds"),
                        "lastUpdated": p.get("lastUpdated"),
                    }

    # Build payments array, preserving existing statuses
    payments = []
    preserved_count = 0
    for payment in payload.payments or []:
        payment_num = payment.payment_number
        payment_doc: dict[str, Any] = {
            "paymentNumber": payment_num,
            "dueDate": payment.due_date,
            "amount": float(payment.amount) if payment.amount else 0.0,
            "status": "scheduled",
        }

        # Preserve existing status if it was updated (out-of-order handling)
        if payment_num in existing_statuses:
            existing = existing_statuses[payment_num]
            payment_doc["status"] = existing["status"]
            if existing.get("paidDate"):
                payment_doc["paidDate"] = existing["paidDate"]
            if existing.get("amountPaid") is not None:
                payment_doc["amountPaid"] = existing["amountPaid"]
            if existing.get("amountRemaining") is not None:
                payment_doc["amountRemaining"] = existing["amountRemaining"]
            if existing.get("linkedTransactionIds"):
                payment_doc["linkedTransactionIds"] = existing["linkedTransactionIds"]
            if existing.get("lastUpdated"):
                payment_doc["lastUpdated"] = existing["lastUpdated"]
            preserved_count += 1

        payments.append(payment_doc)

    schedule_doc = {
        "repaymentSchedule": {
            "scheduleId": payload.schedule_id,
            "numberOfPayments": payload.n_payments,
            "paymentFrequency": payload.payment_frequency,
            "payments": payments,
            "createdDate": payload.created_date,
        },
        "updatedAt": datetime.utcnow(),
    }

    result = await db["loan-accounts"].update_one(
        {"loanAccountId": account_id}, {"$set": schedule_doc}
    )

    log.info(
        "Repayment schedule added",
        num_payments=len(payments),
        preserved_statuses=preserved_count,
        frequency=payload.payment_frequency,
        matched=result.matched_count,
        modified=result.modified_count,
    )


async def handle_schedule_updated(db: AsyncIOMotorDatabase, parsed_event: Any) -> None:
    """
    Handle account.schedule.updated.v1 event.

    Updates individual payment statuses in the repayment schedule.
    This event is fired when payments are made, missed, or partially paid.

    If the schedule/payment doesn't exist yet (out-of-order processing),
    creates placeholder entries that will be enriched when schedule.created arrives.

    Fields: account_id, schedule_id, payments[]
    Payments[]: payment_number, status, paid_date (optional), paid_amount (optional)
    """
    payload = parsed_event.payload
    account_id = payload.account_id
    schedule_id = getattr(payload, "schedule_id", None)

    log = logger.bind(account_id=account_id, schedule_id=schedule_id)
    log.info("Processing account.schedule.updated.v1")

    # Get the list of payment updates from the event
    payment_updates = payload.payments or []

    if not payment_updates:
        log.warning("No payment updates in event")
        return

    # Update each payment's status individually
    # Using positional operator $ to update specific array elements
    total_matched = 0
    total_modified = 0
    total_created = 0

    for payment in payment_updates:
        payment_number = payment.payment_number
        new_status = str(payment.status).lower() if payment.status else "scheduled"

        # Build update document for this payment
        update_fields: dict[str, Any] = {
            "repaymentSchedule.payments.$.status": new_status,
            "updatedAt": datetime.utcnow(),
        }

        # Add optional fields if present (SDK uses amount_paid, amount_remaining)
        paid_date = None
        amount_paid = None
        amount_remaining = None
        linked_transaction_ids = None

        # Paid date
        if hasattr(payment, "paid_date") and payment.paid_date:
            paid_date = str(payment.paid_date)
            update_fields["repaymentSchedule.payments.$.paidDate"] = paid_date

        # Amount paid (SDK field: amount_paid)
        if hasattr(payment, "amount_paid") and payment.amount_paid is not None:
            amount_paid = float(payment.amount_paid)
            update_fields["repaymentSchedule.payments.$.amountPaid"] = amount_paid

        # Amount remaining (SDK field: amount_remaining)
        if hasattr(payment, "amount_remaining") and payment.amount_remaining is not None:
            amount_remaining = float(payment.amount_remaining)
            update_fields["repaymentSchedule.payments.$.amountRemaining"] = amount_remaining

        # Linked transaction IDs
        if hasattr(payment, "linked_transaction_ids") and payment.linked_transaction_ids:
            linked_transaction_ids = list(payment.linked_transaction_ids)
            update_fields["repaymentSchedule.payments.$.linkedTransactionIds"] = linked_transaction_ids

        # Last updated
        if hasattr(payment, "last_updated") and payment.last_updated:
            update_fields["repaymentSchedule.payments.$.lastUpdated"] = str(payment.last_updated)

        # Try to update the specific payment in the array
        result = await db["loan-accounts"].update_one(
            {
                "loanAccountId": account_id,
                "repaymentSchedule.payments.paymentNumber": payment_number,
            },
            {"$set": update_fields},
        )

        if result.matched_count > 0:
            total_matched += result.matched_count
            total_modified += result.modified_count
        else:
            # Payment not found - create placeholder for out-of-order handling
            # This will be enriched when schedule.created arrives
            log.info(
                "Payment not found, creating placeholder for out-of-order handling",
                payment_number=payment_number,
                new_status=new_status,
            )

            # Build placeholder payment document
            placeholder_payment: dict[str, Any] = {
                "paymentNumber": payment_number,
                "status": new_status,
                "dueDate": None,  # Will be set by schedule.created
                "amount": None,  # Will be set by schedule.created
            }
            if paid_date:
                placeholder_payment["paidDate"] = paid_date
            if amount_paid is not None:
                placeholder_payment["amountPaid"] = amount_paid
            if amount_remaining is not None:
                placeholder_payment["amountRemaining"] = amount_remaining
            if linked_transaction_ids:
                placeholder_payment["linkedTransactionIds"] = linked_transaction_ids

            # Upsert: create account with schedule if needed, or push to existing payments
            upsert_result = await db["loan-accounts"].update_one(
                {"loanAccountId": account_id},
                {
                    "$push": {"repaymentSchedule.payments": placeholder_payment},
                    "$set": {
                        "updatedAt": datetime.utcnow(),
                    },
                    "$setOnInsert": {
                        "loanAccountId": account_id,
                        "repaymentSchedule.scheduleId": schedule_id,
                        "createdAt": datetime.utcnow(),
                    },
                },
                upsert=True,
            )

            if upsert_result.upserted_id:
                log.info("Created new account with placeholder schedule")
            total_created += 1

        log.debug(
            "Payment status updated",
            payment_number=payment_number,
            new_status=new_status,
            matched=result.matched_count,
            modified=result.modified_count,
        )

    log.info(
        "Repayment schedule updated",
        payments_processed=len(payment_updates),
        total_matched=total_matched,
        total_modified=total_modified,
        placeholders_created=total_created,
    )

