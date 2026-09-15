"""Tests for the BTB-135 re-application block + PR #67 identity verification handlers.

Contract: crm-event-contract-2026-06-10 — `application.reapplication_blocked.v1`,
`final_credit_decision` (+reason variant), `identityRisk_assessment`
(+lab_verification), `identity_verification.report.archived.v1`.
"""

from __future__ import annotations

import json

import pytest

from billie_servicing.handlers.conversation import handle_assessment, handle_final_decision
from billie_servicing.handlers.identity_verification import (
    handle_identity_attempt,
    handle_identity_report_archived,
)
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

# A review-kind halt — NOT a confirmed block. The applicant was flagged
# as a probable returning customer and auto-held for manual review, carrying the
# identity-recognition match context.
REVIEW_PAYLOAD = {
    "application_number": "B68196E0-0A6",
    "conversation_id": "aa11bb22-cc33-dd44-ee55-ff6677889900",
    "journey_customer_id": "4A8C91AB",
    "canonical_customer_id": None,
    "reason": "review",
    "stop_message": "Thanks for sending that through! We just need to take a closer look...",
    "blocked_until": None,
    "blocked_at": "2026-06-18T04:15:30Z",
    "disposition_kind": "review",
    "manual_review_candidate": True,
    "recognition": {
        "band": "review",
        "posterior": 0.989831,
        "case_id": "4494ed09-25c3-4095-9dc5-a34f5e6db584",
        "candidates": [
            {
                "candidate_id": "C5C7DD3A",
                "posterior": 0.98,
                "concealment": False,
                "per_signal_bits": {
                    "email": 10.0,
                    "bank": 8.94,
                    "address": 5.0,
                    "name": -5.06,
                    "dob": -5.64,
                },
            }
        ],
    },
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

    @pytest.mark.asyncio
    async def test_writes_review_disposition_and_recognition(self, mock_pool):
        event = {
            "typ": "application.reapplication_blocked.v1",
            "usr": "4A8C91AB",
            "payload": dict(REVIEW_PAYLOAD),
        }
        await handle_reapplication_blocked(mock_pool, event)

        doc = mock_pool.last_insert("conversations")
        assert doc is not None
        assert doc["reapplication_block_reason"] == "review"
        assert doc["reapplication_block_disposition_kind"] == "review"
        assert doc["reapplication_block_manual_review_candidate"] is True
        # recognition is stored verbatim as a JSON string — asyncpg has no
        # dict→jsonb codec, so the handler json.dumps it for the jsonb column.
        stored = doc["reapplication_block_recognition"]
        assert isinstance(stored, str)
        assert json.loads(stored) == REVIEW_PAYLOAD["recognition"]

    @pytest.mark.asyncio
    async def test_legacy_block_payload_omits_recognition_fields(self, mock_pool):
        # Older events carry none of the recognition fields — they must project as
        # NULL, never crash, and never fabricate a recognition blob.
        event = {"typ": "application.reapplication_blocked.v1", "payload": dict(BLOCK_PAYLOAD)}
        await handle_reapplication_blocked(mock_pool, event)

        doc = mock_pool.last_insert("conversations")
        assert doc["reapplication_block_disposition_kind"] is None
        assert doc["reapplication_block_manual_review_candidate"] is None
        assert doc["reapplication_block_recognition"] is None


class TestReapplicationBlockedReattribution:
    """A blocked returning customer never gets a ``customer.identity.linked.v1``
    (halted journeys stay evidence-only upstream), so the block lands under the
    journey id and is invisible in the canonical customer's application list.

    The handler re-points the journey's records onto the canonical — but ONLY
    for reasons that reflect a confident single-canonical identity match
    (``ACTIVE_LOAN``, ``PRIOR_DEFAULT``, ``PRIOR_SERIOUS_ARREARS``). Everything
    else default-denies and records the block only, because mis-merging two
    people in the servicing view is worse than a missing app.
    """

    JOURNEY = "4A8C91AB"  # BLOCK_PAYLOAD journey_customer_id
    CANONICAL = "22F0652F"  # BLOCK_PAYLOAD canonical_customer_id

    def _event(self, reason: str, **overrides: object) -> dict:
        payload = dict(BLOCK_PAYLOAD)
        payload["reason"] = reason
        payload.update(overrides)
        return {
            "typ": "application.reapplication_blocked.v1",
            "usr": self.JOURNEY,
            "payload": payload,
        }

    @staticmethod
    def _string_reattributions(mock_pool, table):
        """UPDATEs that re-point <table>'s customer_id_string (alias→canonical)."""
        return [
            c
            for c in mock_pool.calls_against(table)
            if c.op == "UPDATE" and "customer_id_string" in c.values
        ]

    @staticmethod
    def _ref_reattributions(mock_pool, table):
        """UPDATEs that re-point <table> by the customer_id_id ref only (applications
        has no customer_id_string column)."""
        return [
            c
            for c in mock_pool.calls_against(table)
            if c.op == "UPDATE"
            and "customer_id_id" in c.values
            and "customer_id_string" not in c.values
        ]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "reason", ["ACTIVE_LOAN", "PRIOR_DEFAULT", "PRIOR_SERIOUS_ARREARS"]
    )
    async def test_confident_reason_reattributes_all_tables(self, mock_pool, reason):
        # fetchvals in order: resolve merged_into (mirror), canonical ref, alias ref.
        mock_pool.set_fetchval_sequence([None, "canon-ref", "alias-ref"])
        await handle_reapplication_blocked(mock_pool, self._event(reason))

        # conversations + loan_accounts re-point by customer_id_string.
        for table in ("conversations", "loan_accounts"):
            ups = self._string_reattributions(mock_pool, table)
            assert ups, f"expected string re-attribution UPDATE for {table} (reason={reason})"
            assert ups[-1].values["customer_id_string"] == self.CANONICAL
            assert ups[-1].where["customer_id_string"] == self.JOURNEY
        # applications has no customer_id_string — re-pointed by the customer_id_id ref.
        appls = self._ref_reattributions(mock_pool, "applications")
        assert appls, f"expected ref re-attribution UPDATE for applications (reason={reason})"
        assert appls[-1].values["customer_id_id"] == "canon-ref"
        assert appls[-1].where["customer_id_id"] == "alias-ref"

    @pytest.mark.asyncio
    async def test_confident_reason_tombstones_journey_customer_row(self, mock_pool):
        mock_pool.set_fetchval(None)
        await handle_reapplication_blocked(mock_pool, self._event("ACTIVE_LOAN"))

        tombstones = [
            c
            for c in mock_pool.calls_against("customers")
            if c.op == "UPDATE" and "merged_into" in c.values
        ]
        assert tombstones, "expected merged_into tombstone on the journey customer row"
        assert tombstones[-1].values["merged_into"] == self.CANONICAL
        assert tombstones[-1].where["customer_id"] == self.JOURNEY

    @pytest.mark.asyncio
    async def test_identity_conflict_records_block_but_does_not_reattribute(self, mock_pool):
        # Strong-vs-strong: the canonical is ambiguous, so auto-merging could
        # attribute the app to the WRONG person — record the block only.
        mock_pool.set_fetchval(None)
        await handle_reapplication_blocked(mock_pool, self._event("IDENTITY_CONFLICT"))

        # Block still recorded …
        conv = mock_pool.last_insert("conversations")
        assert conv["reapplication_block_reason"] == "IDENTITY_CONFLICT"
        assert mock_pool.last_insert("customers")["customer_id"] == self.CANONICAL
        # … but nothing re-attributed.
        assert not mock_pool.updates_to("conversations")
        assert not mock_pool.calls_against("applications")
        assert not mock_pool.calls_against("loan_accounts")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "reason",
        ["PEP", "ID_VERIFICATION", "SERVICEABILITY", "ACCOUNT_CONDUCT", "FUTURE_UNKNOWN_REASON"],
    )
    async def test_non_allowlisted_reasons_do_not_reattribute(self, mock_pool, reason):
        mock_pool.set_fetchval(None)
        await handle_reapplication_blocked(mock_pool, self._event(reason))
        assert not mock_pool.updates_to("conversations")
        assert not mock_pool.calls_against("applications")
        assert not mock_pool.calls_against("loan_accounts")

    @pytest.mark.asyncio
    async def test_canonical_equals_journey_is_noop(self, mock_pool):
        # Recognised but same id as the journey → nothing to re-point even with
        # an allowlisted reason.
        mock_pool.set_fetchval(None)
        event = self._event("ACTIVE_LOAN", journey_customer_id=self.CANONICAL)
        event["usr"] = self.CANONICAL
        await handle_reapplication_blocked(mock_pool, event)

        assert not mock_pool.updates_to("conversations")
        assert not mock_pool.calls_against("applications")
        assert not mock_pool.calls_against("loan_accounts")

    @pytest.mark.asyncio
    async def test_redelivery_is_idempotent(self, mock_pool):
        # Per delivery the handler issues: resolve merged_into, canonical ref, alias ref.
        seq = [None, "canon-ref", "alias-ref"]
        mock_pool.set_fetchval_sequence(seq + seq)
        event = self._event("ACTIVE_LOAN")
        await handle_reapplication_blocked(mock_pool, event)
        await handle_reapplication_blocked(mock_pool, event)

        # Re-attribution targets the alias on every delivery, so the real-DB second
        # run matches no rows (they already moved on the first) — a no-op. The mock
        # is stateless, so we assert the statement shape that guarantees that.
        for table in ("conversations", "loan_accounts"):
            ups = self._string_reattributions(mock_pool, table)
            assert ups, f"no string re-attribution UPDATE for {table}"
            assert all(c.where["customer_id_string"] == self.JOURNEY for c in ups)
            assert all(c.values["customer_id_string"] == self.CANONICAL for c in ups)
        appls = self._ref_reattributions(mock_pool, "applications")
        assert appls, "no ref re-attribution UPDATE for applications"
        assert all(c.where["customer_id_id"] == "alias-ref" for c in appls)
        assert all(c.values["customer_id_id"] == "canon-ref" for c in appls)

    @pytest.mark.asyncio
    async def test_existing_block_projections_preserved_alongside_reattribution(self, mock_pool):
        mock_pool.set_fetchval(None)
        await handle_reapplication_blocked(mock_pool, self._event("ACTIVE_LOAN"))

        # Conversation block fields still seeded …
        conv = mock_pool.last_insert("conversations")
        assert conv["reapplication_block_reason"] == "ACTIVE_LOAN"
        assert conv["application_number"] == "A3CD3461-11F"
        assert conv["reapplication_block_canonical_customer_id"] == self.CANONICAL
        # … and the canonical "blocked until…" customer mirror still written.
        cust = mock_pool.last_insert("customers")
        assert cust["customer_id"] == self.CANONICAL
        assert cust["reapplication_block_reason"] == "ACTIVE_LOAN"
        assert cust["reapplication_block_application_number"] == "A3CD3461-11F"


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

    @pytest.mark.asyncio
    async def test_v1_screening_report_and_verification_number(self, mock_pool):
        mock_pool.set_fetchval_sequence(["CONV-ARCH-001", None])
        payload = dict(self.ARCHIVED_PAYLOAD)
        payload["lab_request_id"] = "9c63b029-d3a9-4d0c-90d8-fdcca3aad5de"
        payload["verification_number"] = "V60000296"
        payload["screening_report"] = {
            "file_location": (
                "s3://bucket/871CE08C-8B6/IdentityVerification/"
                "verification_report_screening_x.pdf"
            ),
            "file_name": "verification_report_screening_x.pdf",
        }
        await handle_identity_report_archived(
            mock_pool, {"typ": "identity_verification.report.archived.v1", "payload": payload}
        )
        conv = mock_pool.last_insert("conversations")
        assert conv["identity_verification_report_lab_request_id"] == (
            "9c63b029-d3a9-4d0c-90d8-fdcca3aad5de"
        )
        assert conv["identity_verification_report_verification_number"] == "V60000296"
        assert conv["identity_verification_report_screening_report_file_name"] == (
            "verification_report_screening_x.pdf"
        )
        assert conv["identity_verification_report_screening_report_file_location"].endswith(
            ".pdf"
        )

    @pytest.mark.asyncio
    async def test_legacy_payload_leaves_screening_columns_null(self, mock_pool):
        mock_pool.set_fetchval_sequence(["CONV-ARCH-001", None])
        await handle_identity_report_archived(
            mock_pool,
            {"typ": "identity_verification.report.archived.v1", "payload": dict(self.ARCHIVED_PAYLOAD)},
        )
        conv = mock_pool.last_insert("conversations")
        assert conv["identity_verification_report_verification_number"] is None
        assert conv["identity_verification_report_screening_report_file_location"] is None


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


    LAB_BLOCK_V1 = {
        "id": "9c63b029-d3a9-4d0c-90d8-fdcca3aad5de",
        "verificationNumber": "V60000296",
        "reference": "APP-1",
        "status": "completed",
        "createdAt": "2026-09-11T05:13:09Z",
        "updatedAt": "2026-09-11T05:13:09Z",
        "result": {
            "outcome": "refer",
            "checks": [
                {"checkType": "identity", "outcome": "pass", "providers": []},
                {
                    "checkType": "screening",
                    "outcome": "refer",
                    "reasons": [{"code": "SCREENING_HIT", "message": "Potential match"}],
                    "providers": [
                        {
                            "provider": "IDMatrix",
                            "outcome": "refer",
                            "detail": {
                                "pep": {"result": "match"},
                                "sanctions": {"result": "no_match"},
                            },
                        }
                    ],
                },
            ],
        },
        "provider": [{"name": "IDMatrix", "reference": "260212-E3106-FD08B"}],
        "links": {},
    }

    @pytest.mark.asyncio
    async def test_v1_block_mirrors_summary_columns(self, mock_pool):
        event = {
            "typ": "identityRisk_assessment",
            "cid": "CONV-1",
            "usr": "4A8C91AB",
            "payload": {"decision": "DECLINED", "lab_verification": dict(self.LAB_BLOCK_V1)},
        }
        await handle_assessment(mock_pool, event)
        cust = mock_pool.last_insert("customers")
        assert cust["customer_id"] == "4A8C91AB"
        assert cust["identity_verification_overall_result"] == "refer"
        assert cust["identity_verification_provider"] == "IDMatrix"
        assert cust["identity_verification_provider_reference"] == "260212-E3106-FD08B"
        assert cust["identity_verification_lab_request_id"] == (
            "9c63b029-d3a9-4d0c-90d8-fdcca3aad5de"
        )
        assert cust["identity_verification_verification_number"] == "V60000296"
        assert cust["identity_verification_identity_outcome"] == "pass"
        assert cust["identity_verification_screening_outcome"] == "refer"
        assert cust["identity_verification_pep_result"] == "match"
        assert cust["identity_verification_sanctions_result"] == "no_match"
        assert cust["identity_verification_checked_at"] is not None

    @pytest.mark.asyncio
    async def test_v1_block_without_screening_leaves_nulls(self, mock_pool):
        block = dict(self.LAB_BLOCK_V1)
        block["result"] = {"outcome": "pass", "checks": [self.LAB_BLOCK_V1["result"]["checks"][0]]}
        event = {
            "typ": "identityRisk_assessment",
            "cid": "CONV-1",
            "usr": "4A8C91AB",
            "payload": {"decision": "APPROVED", "lab_verification": block},
        }
        await handle_assessment(mock_pool, event)
        cust = mock_pool.last_insert("customers")
        assert cust["identity_verification_overall_result"] == "pass"
        assert cust["identity_verification_identity_outcome"] == "pass"
        assert cust["identity_verification_screening_outcome"] is None
        assert cust["identity_verification_pep_result"] is None
        assert cust["identity_verification_sanctions_result"] is None

    @pytest.mark.asyncio
    async def test_mirror_is_guarded_by_checked_at(self, mock_pool):
        """A replayed older verification must not overwrite a newer mirror."""
        event = {
            "typ": "identityRisk_assessment",
            "cid": "CONV-1",
            "usr": "4A8C91AB",
            "payload": {"decision": "DECLINED", "lab_verification": dict(self.LAB_BLOCK_V1)},
        }
        await handle_assessment(mock_pool, event)
        call = mock_pool.calls_against("customers")[-1]
        assert call.op == "INSERT"
        assert "identity_verification_checked_at >= customers.identity_verification_checked_at" in (
            call.sql
        )

    @pytest.mark.asyncio
    async def test_legacy_block_mirrors_screening_results(self, mock_pool):
        event = {
            "typ": "identityRisk_assessment",
            "cid": "CONV-1",
            "usr": "4A8C91AB",
            "payload": {"decision": "PASS", "lab_verification": dict(self.LAB_BLOCK)},
        }
        await handle_assessment(mock_pool, event)
        cust = mock_pool.last_insert("customers")
        assert cust["identity_verification_pep_result"] == "no-match"
        assert cust["identity_verification_sanctions_result"] == "no-match"
        assert "identity_verification_verification_number" not in cust

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


ATTEMPT_PAYLOAD = {
    "application_number": "86332415-5F3",
    "customer_id": "46F40509",
    "attempt_number": 1,
    "step_up": False,
    "step_up_requested": True,
    "document_types": ["DRIVERS_LICENCE"],
    "decision": "DECLINED",
    "identity_verification_failed": True,
    "screening_hit": False,
    "pep_result": "no-match",
    "sanctions_result": "no-match",
    "lab_verification": {"requestId": "60000650", "overallResult": "Failed"},
    "lab_request_id": "60000650",
    "checked_at": "2026-09-15T00:00:00+00:00",
}


def _attempt_merges(mock_pool):
    return [
        c
        for c in mock_pool.calls_against("conversations")
        if "jsonb_set(COALESCE(identity_verification_attempts" in c.sql
    ]


class TestIdentityAttempt:
    """identity_verification.attempt.v1 (spec 2026-09-15) — one row per LAB call."""

    @pytest.mark.asyncio
    async def test_merges_entry_keyed_by_request_id(self, mock_pool):
        event = {
            "typ": "identity_verification.attempt.v1",
            "conv": "conv-1",
            "usr": "46F40509",
            "payload": dict(ATTEMPT_PAYLOAD),
        }
        await handle_identity_attempt(mock_pool, event)

        merge = _attempt_merges(mock_pool)[-1]
        assert merge.args[0] == "60000650"
        entry = json.loads(merge.args[1])
        assert entry["attempt_number"] == 1
        assert entry["step_up_requested"] is True
        assert entry["document_types"] == ["DRIVERS_LICENCE"]
        assert entry["lab_verification"]["requestId"] == "60000650"
        assert merge.args[2] == "conv-1"
        assert "version = COALESCE(version, 1) + 1" in merge.sql

    @pytest.mark.asyncio
    async def test_string_payload_parsed_defensively(self, mock_pool):
        event = {
            "typ": "identity_verification.attempt.v1",
            "conv": "conv-1",
            "payload": json.dumps(ATTEMPT_PAYLOAD),
        }
        await handle_identity_attempt(mock_pool, event)
        assert _attempt_merges(mock_pool)[-1].args[0] == "60000650"

    @pytest.mark.asyncio
    async def test_falls_back_to_attempt_n_key_without_request_id(self, mock_pool):
        payload = {
            **ATTEMPT_PAYLOAD,
            "lab_verification": None,
            "lab_request_id": None,
            "attempt_number": 2,
        }
        await handle_identity_attempt(
            mock_pool,
            {"typ": "identity_verification.attempt.v1", "conv": "conv-1", "payload": payload},
        )
        assert _attempt_merges(mock_pool)[-1].args[0] == "attempt-2"

    @pytest.mark.asyncio
    async def test_ensures_conversation_row_first(self, mock_pool):
        await handle_identity_attempt(
            mock_pool,
            {
                "typ": "identity_verification.attempt.v1",
                "conv": "conv-1",
                "usr": "46F40509",
                "payload": dict(ATTEMPT_PAYLOAD),
            },
        )
        inserts = mock_pool.inserts_into("conversations")
        assert inserts and inserts[0]["conversation_id"] == "conv-1"

    @pytest.mark.asyncio
    async def test_missing_conversation_id_is_skipped(self, mock_pool):
        await handle_identity_attempt(
            mock_pool,
            {"typ": "identity_verification.attempt.v1", "payload": dict(ATTEMPT_PAYLOAD)},
        )
        assert not mock_pool.has_call_against("conversations")


class TestArchivedMergesIntoAttempt:
    """The archived event also links its artifacts to the attempt row and
    the "latest report" columns only ever move forward in archived_at."""

    @pytest.mark.asyncio
    async def test_archived_event_merges_artifacts_under_request_id(self, mock_pool):
        mock_pool.set_fetchval_sequence(["CONV-ARCH-001", None])
        payload = {
            **TestIdentityReportArchived.ARCHIVED_PAYLOAD,
            "attempt_number": 1,
            "step_up": False,
        }
        await handle_identity_report_archived(
            mock_pool,
            {"typ": "identity_verification.report.archived.v1", "payload": payload},
        )
        merge = _attempt_merges(mock_pool)[-1]
        assert merge.args[0] == "468881"
        entry = json.loads(merge.args[1])
        assert entry["report_file_location"].endswith("verification_report_468881.pdf")
        assert entry["raw_response_file_name"] == "verify_response_468881.json"
        assert entry["archived_at"] == payload["archived_at"]
        assert entry["attempt_number"] == 1
        assert entry["step_up"] is False
        assert merge.args[2] == "CONV-ARCH-001"

    @pytest.mark.asyncio
    async def test_no_request_id_means_no_attempt_merge(self, mock_pool):
        mock_pool.set_fetchval_sequence(["CONV-ARCH-001", None])
        payload = {**TestIdentityReportArchived.ARCHIVED_PAYLOAD, "lab_request_id": None}
        await handle_identity_report_archived(
            mock_pool,
            {"typ": "identity_verification.report.archived.v1", "payload": payload},
        )
        assert not _attempt_merges(mock_pool)

    @pytest.mark.asyncio
    async def test_conversation_report_columns_guarded_on_archived_at(self, mock_pool):
        mock_pool.set_fetchval_sequence(["CONV-ARCH-001", None])
        await handle_identity_report_archived(
            mock_pool,
            {
                "typ": "identity_verification.report.archived.v1",
                "payload": dict(TestIdentityReportArchived.ARCHIVED_PAYLOAD),
            },
        )
        conv_sql = [c.sql for c in mock_pool.calls_against("conversations") if c.op == "INSERT"][-1]
        assert (
            "EXCLUDED.identity_verification_report_archived_at >= "
            "conversations.identity_verification_report_archived_at"
        ) in conv_sql

    @pytest.mark.asyncio
    async def test_customer_mirror_guarded_on_archived_at(self, mock_pool):
        mock_pool.set_fetchval_sequence(["CONV-ARCH-001", None])
        await handle_identity_report_archived(
            mock_pool,
            {
                "typ": "identity_verification.report.archived.v1",
                "payload": dict(TestIdentityReportArchived.ARCHIVED_PAYLOAD),
            },
        )
        cust_sql = [c.sql for c in mock_pool.calls_against("customers") if c.op == "INSERT"][-1]
        assert (
            "EXCLUDED.identity_verification_archived_at >= "
            "customers.identity_verification_archived_at"
        ) in cust_sql
