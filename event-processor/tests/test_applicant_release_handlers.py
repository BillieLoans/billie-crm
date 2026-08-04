"""applicant_release.* projection handlers (CRM-local events, dict envelopes)."""
import json
from unittest.mock import AsyncMock

from billie_servicing import marketing_client
from billie_servicing.handlers.applicant_release import (
    handle_applicant_release_gate_mode_changed,
    handle_applicant_release_grant_claimed,
    handle_applicant_release_invites_sent,
    handle_applicant_release_released,
    handle_applicant_release_revoked,
)


def _event(typ: str, payload: dict) -> dict:
    return {
        "conv": f"applicant-release:{payload.get('release_id', 'gate')}",
        "agt": "billie-crm", "usr": "staff-1", "cls": "msg", "typ": typ,
        "cause": "ev-1", "payload": json.dumps(payload),
    }


RELEASED = {
    "release_id": "rel-1", "name": "Wave", "type": "waitlist",
    "expires_at": "2026-08-16T00:00:00+00:00", "send_invite_sms": True,
    "grants": [
        {"mobile_e164": "+61400000001", "contact_id": "c-1", "send_sms": True},
        {"mobile_e164": "+61400000002", "contact_id": None, "send_sms": False},
    ],
    "quota_count": None, "released_by": "staff-1",
}


async def test_released_upserts_batch_and_grants(mock_pool):
    await handle_applicant_release_released(
        mock_pool, _event("applicant_release.released.v1", RELEASED)
    )
    batch = mock_pool.last_upsert("release_batches")
    assert batch["release_id"] == "rel-1"
    assert batch["granted_count"] == 2
    assert batch["status"] == "active"
    grants = mock_pool.inserts_into("release_grants")
    assert len(grants) == 2
    assert grants[0]["sms_status"] == "not_sent"  # sent only confirmed by invites_sent


async def test_released_defaults_skipped_counters_to_zero(mock_pool):
    """No `skipped` object on the payload (the common case) — all four
    skipped_* counters default to 0 rather than landing NULL."""
    await handle_applicant_release_released(
        mock_pool, _event("applicant_release.released.v1", RELEASED)
    )
    batch = mock_pool.last_upsert("release_batches")
    assert batch["skipped_already_customer"] == 0
    assert batch["skipped_already_released"] == 0
    assert batch["skipped_needs_review"] == 0
    assert batch["skipped_invalid_number"] == 0


async def test_released_persists_skipped_counters_when_present(mock_pool):
    payload = {
        **RELEASED,
        "skipped": {
            "already_customer": 3,
            "already_released": 1,
            "needs_review": 2,
            "invalid_number": 5,
        },
    }
    await handle_applicant_release_released(
        mock_pool, _event("applicant_release.released.v1", payload)
    )
    batch = mock_pool.last_upsert("release_batches")
    assert batch["skipped_already_customer"] == 3
    assert batch["skipped_already_released"] == 1
    assert batch["skipped_needs_review"] == 2
    assert batch["skipped_invalid_number"] == 5


async def test_revoked_flips_statuses(mock_pool):
    await handle_applicant_release_revoked(
        mock_pool,
        _event("applicant_release.revoked.v1",
               {"release_id": "rel-1", "revoked_by": "staff-2", "reason": "oops"}),
    )
    update = mock_pool.updates_to("release_batches")[-1]
    assert update["status"] == "revoked"
    assert update["revoked_by"] == "staff-2"
    assert mock_pool.has_call_against("release_grants")  # grants swept to revoked


async def test_grant_claimed_upserts_row_and_recomputes_count(mock_pool, monkeypatch):
    # Contact capture is a separate concern (see TestQuotaClaimContactCapture
    # below) — mock it here so this test doesn't depend on gRPC/network.
    monkeypatch.setattr(marketing_client, "upsert_contact", AsyncMock(return_value=None))

    await handle_applicant_release_grant_claimed(
        mock_pool,
        _event("applicant_release.grant_claimed.v1", {
            "release_id": "rel-1", "mobile_e164": "+61400000001",
            "source": "quota", "claimed_at": "2026-08-02T09:00:00+00:00",
            "conversation_id": "conv-9",
        }),
    )
    grant = mock_pool.last_upsert("release_grants")
    assert grant["status"] == "claimed"
    assert grant["source"] == "quota_claim"
    insert_call = [
        c for c in mock_pool.calls if c.table == "release_grants" and c.op == "INSERT"
    ][-1]
    assert insert_call.conflict_columns == ["release_id", "mobile_e164"]
    # claimed_count recomputed from grant rows (replay-safe), not incremented
    sql_all = " ".join(c.sql for c in mock_pool.calls)
    assert "claimed_count" in sql_all and "count(" in sql_all.lower()


class TestQuotaClaimContactCapture:
    """applicant_release.grant_claimed.v1 with source=quota — walk-up
    claimants become marketing contacts via a best-effort UpsertContact
    (spec 2026-08-02, post-release follow-up). Policy A: never sets consent
    — proving phone possession via OTP is not marketing opt-in."""

    async def test_quota_claim_captures_marketing_contact(self, mock_pool, monkeypatch):
        upsert_contact = AsyncMock(return_value="contact-99")
        monkeypatch.setattr(marketing_client, "upsert_contact", upsert_contact)

        await handle_applicant_release_grant_claimed(
            mock_pool,
            _event("applicant_release.grant_claimed.v1", {
                "release_id": "rel-1", "mobile_e164": "+61400000005",
                "source": "quota", "claimed_at": "2026-08-02T09:00:00+00:00",
            }),
        )

        upsert_contact.assert_awaited_once()
        kw = upsert_contact.call_args.kwargs
        assert kw["idempotency_key"] == "gate-claim:rel-1:+61400000005"
        assert kw["mobile"] == "+61400000005"
        assert kw["source"] == "other"
        attrs = json.loads(kw["utm_json"])
        assert attrs["intake_channel"] == "gate_quota_claim"
        assert attrs["release_id"] == "rel-1"
        assert "consent" not in kw  # policy A — a gate claim is not marketing consent

        update_calls = [
            c for c in mock_pool.calls if c.table == "release_grants" and c.op == "UPDATE"
        ]
        assert len(update_calls) == 1
        assert update_calls[0].values["contact_id"] == "contact-99"

    async def test_targeted_claim_does_not_capture_contact(self, mock_pool, monkeypatch):
        upsert_contact = AsyncMock(return_value="contact-99")
        monkeypatch.setattr(marketing_client, "upsert_contact", upsert_contact)

        await handle_applicant_release_grant_claimed(
            mock_pool,
            _event("applicant_release.grant_claimed.v1", {
                "release_id": "rel-1", "mobile_e164": "+61400000001",
                "source": "targeted", "claimed_at": "2026-08-02T09:00:00+00:00",
            }),
        )

        upsert_contact.assert_not_awaited()

    async def test_grpc_failure_does_not_raise_or_poison_projection(self, mock_pool, monkeypatch):
        upsert_contact = AsyncMock(side_effect=RuntimeError("gRPC unavailable"))
        monkeypatch.setattr(marketing_client, "upsert_contact", upsert_contact)

        # Must not raise — best-effort, never fails/DLQs the claim projection.
        await handle_applicant_release_grant_claimed(
            mock_pool,
            _event("applicant_release.grant_claimed.v1", {
                "release_id": "rel-1", "mobile_e164": "+61400000006",
                "source": "quota", "claimed_at": "2026-08-02T09:00:00+00:00",
            }),
        )

        upsert_contact.assert_awaited_once()
        grant = mock_pool.last_upsert("release_grants")
        assert grant["status"] == "claimed"  # projection still landed

    async def test_replay_skips_capture_when_already_linked(self, mock_pool, monkeypatch):
        upsert_contact = AsyncMock(return_value="contact-99")
        monkeypatch.setattr(marketing_client, "upsert_contact", upsert_contact)
        mock_pool.set_fetchval("contact-existing")  # precheck finds an existing link

        await handle_applicant_release_grant_claimed(
            mock_pool,
            _event("applicant_release.grant_claimed.v1", {
                "release_id": "rel-1", "mobile_e164": "+61400000001",
                "source": "quota", "claimed_at": "2026-08-02T09:00:00+00:00",
            }),
        )

        upsert_contact.assert_not_awaited()


async def test_invites_sent_marks_sms_statuses(mock_pool):
    await handle_applicant_release_invites_sent(
        mock_pool,
        _event("applicant_release.invites_sent.v1", {
            "release_id": "rel-1", "sent": ["+61400000001"],
            "failed": [{"mobile_e164": "+61400000003", "reason": "send_failed"}],
        }),
    )
    sql_all = " ".join(c.sql for c in mock_pool.calls)
    assert "sms_status" in sql_all
    batch_update = mock_pool.updates_to("release_batches")[-1]
    assert batch_update["sms_sent_count"] == 1
    assert batch_update["sms_failed_count"] == 1


async def test_gate_mode_changed_upserts_single_row(mock_pool):
    await handle_applicant_release_gate_mode_changed(
        mock_pool,
        _event("applicant_release.gate_mode.changed.v1",
               {"mode": "gated", "set_by": "ops", "changed_at": "2026-08-02T09:00:00+00:00"}),
    )
    row = mock_pool.last_upsert("release_gate_status")
    assert row["gate_id"] == "gate"
    assert row["mode"] == "gated"
