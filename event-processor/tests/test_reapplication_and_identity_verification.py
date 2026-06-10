"""Tests for the BTB-135 re-application block + PR #67 identity verification handlers.

Contract: crm-event-contract-2026-06-10 — `application.reapplication_blocked.v1`,
`final_credit_decision` (+reason variant), `identityRisk_assessment`
(+lab_verification), `identity_verification.report.archived.v1`.
"""

from __future__ import annotations

import json

import pytest

from billie_servicing.handlers.conversation import handle_assessment, handle_final_decision
from billie_servicing.handlers.identity_verification import handle_identity_report_archived
from billie_servicing.handlers.reapplication import handle_reapplication_blocked

# Contract example payload (event 1).
BLOCK_PAYLOAD = {
    "application_number": "A3CD3461-11F",
    "conversation_id": "7d5ee9c2-dd6b-4091-8a3a-6c148a4c4142",
    "journey_customer_id": "4A8C91AB",
    "canonical_customer_id": "22F0652F",
    "reason": "ID_VERIFICATION",
    "message_variant": "ID_VERIFICATION",
    "stop_message": "Oh bother! It seems you're not eligible for a loan with Billie at this time.",
    "source_application_number": "871CE08C-8B6",
    "source_account_id": None,
    "source_decided_at": "2026-06-10T01:02:21.110306+00:00",
    "blocked_until": "2026-12-10T01:02:21.110306+00:00",
    "blocked_at": "2026-06-10T07:08:40.123456+00:00",
}


class TestReapplicationBlocked:
    @pytest.mark.asyncio
    async def test_writes_block_to_conversation(self, mock_pool):
        event = {
            "typ": "application.reapplication_blocked.v1",
            "usr": "4A8C91AB",
            "payload": dict(BLOCK_PAYLOAD),
        }
        await handle_reapplication_blocked(mock_pool, event)

        doc = mock_pool.last_insert("conversations")
        assert doc is not None
        assert doc["conversation_id"] == BLOCK_PAYLOAD["conversation_id"]
        assert doc["application_number"] == "A3CD3461-11F"
        assert doc["reapplication_block_reason"] == "ID_VERIFICATION"
        assert doc["reapplication_block_message_variant"] == "ID_VERIFICATION"
        assert doc["reapplication_block_stop_message"] == BLOCK_PAYLOAD["stop_message"]
        assert doc["reapplication_block_source_application_number"] == "871CE08C-8B6"
        assert doc["reapplication_block_source_account_id"] is None
        assert doc["reapplication_block_blocked_until"] is not None
        assert doc["reapplication_block_blocked_at"] is not None
        assert doc["reapplication_block_canonical_customer_id"] == "22F0652F"

    @pytest.mark.asyncio
    async def test_mirrors_block_onto_canonical_customer(self, mock_pool):
        event = {"typ": "application.reapplication_blocked.v1", "payload": dict(BLOCK_PAYLOAD)}
        await handle_reapplication_blocked(mock_pool, event)

        doc = mock_pool.last_insert("customers")
        assert doc is not None
        assert doc["customer_id"] == "22F0652F"  # canonical, not journey
        assert doc["reapplication_block_reason"] == "ID_VERIFICATION"
        assert doc["reapplication_block_blocked_until"] is not None
        assert doc["reapplication_block_application_number"] == "A3CD3461-11F"

    @pytest.mark.asyncio
    async def test_resolves_merged_into_tombstone(self, mock_pool):
        # The canonical id itself was later merged into another id.
        mock_pool.set_fetchval("NEW-CANON")
        event = {"typ": "application.reapplication_blocked.v1", "payload": dict(BLOCK_PAYLOAD)}
        await handle_reapplication_blocked(mock_pool, event)

        doc = mock_pool.last_insert("customers")
        assert doc["customer_id"] == "NEW-CANON"

    @pytest.mark.asyncio
    async def test_permanent_block_null_blocked_until(self, mock_pool):
        payload = dict(BLOCK_PAYLOAD)
        payload.update(
            {
                "reason": "PEP",
                "blocked_until": None,
                "source_account_id": None,
            }
        )
        event = {"typ": "application.reapplication_blocked.v1", "payload": payload}
        await handle_reapplication_blocked(mock_pool, event)

        doc = mock_pool.last_insert("conversations")
        assert doc["reapplication_block_reason"] == "PEP"
        assert doc["reapplication_block_blocked_until"] is None

    @pytest.mark.asyncio
    async def test_string_payload_parsed_defensively(self, mock_pool):
        event = {
            "typ": "application.reapplication_blocked.v1",
            "payload": json.dumps(BLOCK_PAYLOAD),
        }
        await handle_reapplication_blocked(mock_pool, event)
        doc = mock_pool.last_insert("conversations")
        assert doc["reapplication_block_reason"] == "ID_VERIFICATION"

    @pytest.mark.asyncio
    async def test_no_conversation_id_still_mirrors_customer(self, mock_pool):
        payload = dict(BLOCK_PAYLOAD)
        payload.pop("conversation_id")
        event = {"typ": "application.reapplication_blocked.v1", "payload": payload}
        await handle_reapplication_blocked(mock_pool, event)

        assert not mock_pool.inserts_into("conversations")
        assert mock_pool.last_insert("customers")["customer_id"] == "22F0652F"


class TestFinalDecisionDetail:
    @pytest.mark.asyncio
    async def test_block_decline_stores_detail(self, mock_pool):
        event = {
            "cid": "CONV-TEST-001",
            "payload": {
                "application_number": "A3CD3461-11F",
                "decision": "DECLINED",
                "reason": "REAPPLICATION_BLOCK:ID_VERIFICATION",
                "retry_eligible": False,
                "incident_ref": None,
                "source_application_number": "871CE08C-8B6",
                "blocked_until": "2026-12-10T01:02:21.110306+00:00",
            },
        }
        await handle_final_decision(mock_pool, event)

        doc = mock_pool.last_insert("conversations")
        assert doc["status"] == "declined"
        assert doc["final_decision"] == "DECLINED"
        assert doc["decision_status"] == "declined"
        assert doc["decision_detail_reason"] == "REAPPLICATION_BLOCK:ID_VERIFICATION"
        assert doc["decision_detail_retry_eligible"] is False
        assert doc["decision_detail_source_application_number"] == "871CE08C-8B6"
        assert doc["decision_detail_blocked_until"] is not None

    @pytest.mark.asyncio
    async def test_legacy_payload_sets_no_detail_columns(self, mock_pool):
        # Pre-existing decision payloads have no `reason` — the detail columns
        # must be absent from the write so redeliveries can't wipe values.
        await handle_final_decision(
            mock_pool, {"cid": "CONV-TEST-001", "payload": {"decision": "DECLINED"}}
        )
        doc = mock_pool.last_insert("conversations")
        assert doc["status"] == "declined"
        assert "decision_detail_reason" not in doc
        assert "decision_detail_blocked_until" not in doc

    @pytest.mark.asyncio
    async def test_string_payload_parsed_defensively(self, mock_pool):
        event = {
            "cid": "CONV-TEST-001",
            "payload": json.dumps({"decision": "DECLINED", "reason": "REAPPLICATION_BLOCK:PEP"}),
        }
        await handle_final_decision(mock_pool, event)
        doc = mock_pool.last_insert("conversations")
        assert doc["final_decision"] == "DECLINED"
        assert doc["decision_detail_reason"] == "REAPPLICATION_BLOCK:PEP"


class TestIdentityReportArchived:
    ARCHIVED_PAYLOAD = {
        "application_number": "871CE08C-8B6",
        "customer_id": "4A8C91AB",
        "lab_request_id": "468881",
        "provider_reference": "260610-52BC8-A4A67",
        "report": {
            "file_location": "s3://bucket/871CE08C-8B6/IdentityVerification/verification_report_468881.pdf",
            "file_name": "verification_report_468881.pdf",
            "object_id": "etag-1",
        },
        "raw_response": {
            "file_location": "s3://bucket/871CE08C-8B6/IdentityVerification/verify_response_468881.json",
            "file_name": "verify_response_468881.json",
            "object_id": "etag-2",
        },
        "archived_at": "2026-06-10T07:35:12.123456+00:00",
    }

    @pytest.mark.asyncio
    async def test_writes_report_to_conversation_and_customer(self, mock_pool):
        # fetchval 1: conversation lookup by application_number,
        # fetchval 2: merged_into resolution (no tombstone).
        mock_pool.set_fetchval_sequence(["CONV-ARCH-001", None])
        event = {
            "typ": "identity_verification.report.archived.v1",
            "usr": "4A8C91AB",
            "payload": dict(self.ARCHIVED_PAYLOAD),
        }
        await handle_identity_report_archived(mock_pool, event)

        conv = mock_pool.last_insert("conversations")
        assert conv["conversation_id"] == "CONV-ARCH-001"
        assert conv["identity_verification_report_lab_request_id"] == "468881"
        assert conv["identity_verification_report_provider_reference"] == "260610-52BC8-A4A67"
        assert conv["identity_verification_report_report_file_location"].endswith(".pdf")
        assert conv["identity_verification_report_report_file_name"] == (
            "verification_report_468881.pdf"
        )
        assert conv["identity_verification_report_raw_response_file_location"].endswith(".json")
        assert conv["identity_verification_report_archived_at"] is not None

        cust = mock_pool.last_insert("customers")
        assert cust["customer_id"] == "4A8C91AB"
        assert cust["identity_verification_report_archived"] is True
        assert cust["identity_verification_lab_request_id"] == "468881"
        assert cust["identity_verification_archived_at"] is not None

    @pytest.mark.asyncio
    async def test_partial_archive_report_only(self, mock_pool):
        mock_pool.set_fetchval_sequence(["CONV-ARCH-001", None])
        payload = dict(self.ARCHIVED_PAYLOAD)
        payload["raw_response"] = None
        event = {"typ": "identity_verification.report.archived.v1", "payload": payload}
        await handle_identity_report_archived(mock_pool, event)

        conv = mock_pool.last_insert("conversations")
        assert conv["identity_verification_report_report_file_name"] == (
            "verification_report_468881.pdf"
        )
        assert conv["identity_verification_report_raw_response_file_location"] is None
        assert mock_pool.last_insert("customers")["identity_verification_report_archived"] is True

    @pytest.mark.asyncio
    async def test_unknown_application_still_mirrors_customer(self, mock_pool):
        mock_pool.set_fetchval_sequence([None, None])
        event = {"typ": "identity_verification.report.archived.v1", "payload": dict(self.ARCHIVED_PAYLOAD)}
        await handle_identity_report_archived(mock_pool, event)

        assert not mock_pool.inserts_into("conversations")
        assert mock_pool.last_insert("customers")["identity_verification_report_archived"] is True


class TestLabVerificationMirror:
    LAB_BLOCK = {
        "requestId": "468881",
        "requestDateTime": "2026-06-10 07:32:35",
        "responseSucceeded": True,
        "provider": "IDMatrix",
        "providerReference": "260610-52BC8-A4A67",
        "overallResult": "Passed",
        "sanctionsResult": "no-match",
        "sanctionsListResult": "no-match",
        "pepResult": "no-match",
        "eddResult": "no-match",
        "gwlResult": "no-match",
        "reportLink": "/entity-verification/api/v1/individual/download-report/?id=468881",
    }

    @pytest.mark.asyncio
    async def test_identity_risk_with_lab_verification_mirrors_customer(self, mock_pool):
        event = {
            "typ": "identityRisk_assessment",
            "cid": "CONV-TEST-001",
            "usr": "4A8C91AB",
            "payload": {"decision": "PASS", "lab_verification": dict(self.LAB_BLOCK)},
        }
        await handle_assessment(mock_pool, event)

        # Full payload still lands in the assessment jsonb…
        updates = [
            c
            for c in mock_pool.calls_against("conversations")
            if c.op == "UPDATE" and "assessments_identity_risk" in c.values
        ]
        assert updates

        # …and the summary is mirrored onto the customer row.
        cust = mock_pool.last_insert("customers")
        assert cust is not None
        assert cust["customer_id"] == "4A8C91AB"
        assert cust["identity_verification_overall_result"] == "Passed"
        assert cust["identity_verification_provider"] == "IDMatrix"
        assert cust["identity_verification_provider_reference"] == "260610-52BC8-A4A67"
        assert cust["identity_verification_lab_request_id"] == "468881"
        assert cust["identity_verification_checked_at"] is not None

    @pytest.mark.asyncio
    async def test_identity_risk_without_lab_verification_no_mirror(self, mock_pool):
        # Mock mode / historical events — block absent, no customer write.
        event = {
            "typ": "identityRisk_assessment",
            "cid": "CONV-TEST-001",
            "usr": "4A8C91AB",
            "payload": {"decision": "PASS"},
        }
        await handle_assessment(mock_pool, event)
        assert not mock_pool.inserts_into("customers")
