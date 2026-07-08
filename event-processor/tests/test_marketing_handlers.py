import json

import pytest

from billie_marketing_events import parse_marketing_message
from billie_servicing.handlers.marketing import (
    handle_batch_created,
    handle_batch_invitations_triggered,
    handle_contact_batch_assigned,
    handle_contact_consent_granted,
    handle_contact_consent_withdrawn,
    handle_contact_erased,
    handle_contact_interaction_logged,
    handle_contact_linked,
    handle_contact_merged,
    handle_contact_observed,
    handle_contact_stage_changed,
    handle_contact_unlinked,
    handle_contact_updated,
    handle_feedback_received,
    handle_feedback_status_changed,
    handle_referral_attributed,
)


class FakeConn:
    def __init__(self):
        self.executed = []
    async def execute(self, sql, *args):
        self.executed.append((sql, args))
        return "UPDATE 1"
    async def fetchval(self, sql, *args):
        return None


class FakePool(FakeConn):
    def acquire(self):
        return _Ctx(self)


class _Ctx:
    def __init__(self, conn):
        self.conn = conn
    async def __aenter__(self):
        return self.conn
    async def __aexit__(self, *a):
        return False


def _parsed(typ, payload):
    return parse_marketing_message({
        "conv": "conv-1", "agt": "marketingService", "usr": "c-1", "seq": 1,
        "cls": "msg", "typ": typ, "event_id": "ev-1", "payload": json.dumps(payload),
    })


async def test_contact_observed_upserts_contact_and_audit():
    pool = FakePool()
    await handle_contact_observed(pool, _parsed("contact.observed.v1", {
        "contact_id": "c-1", "mobile_e164": "+61400000001", "source": "campus",
        "observed_at": "2026-07-02T00:00:00+00:00"}))
    sql_all = " ".join(s for s, _ in pool.executed)
    assert 'INSERT INTO "contacts"' in sql_all or "INSERT INTO contacts" in sql_all
    assert "contact_audit_log" in sql_all


async def test_interaction_logged_inserts_row():
    pool = FakePool()
    await handle_contact_interaction_logged(pool, _parsed("contact.interaction.logged.v1", {
        "interaction_id": "i-1", "contact_id": "c-1", "kind": "signup",
        "occurred_at": "2026-07-02T00:00:00+00:00", "source_system": "crm"}))
    assert any("interactions" in s for s, _ in pool.executed)


async def test_interaction_direction_normalised_to_enum_values(mock_pool):
    # The platform's notification echo shipped direction="out" for a while;
    # the projection must map short forms onto the pg enum, and degrade
    # unknown values to NULL rather than DLQ-loop the event.
    for raw, stored in [("out", "outbound"), ("in", "inbound"),
                        ("outbound", "outbound"), ("sideways", None), (None, None)]:
        await handle_contact_interaction_logged(mock_pool, _parsed(
            "contact.interaction.logged.v1", {
                "interaction_id": f"i-{raw}", "contact_id": "c-1",
                "kind": "message_out", "direction": raw,
                "occurred_at": "2026-07-02T00:00:00+00:00",
                "source_system": "notification"}))
        row = mock_pool.last_upsert("interactions")
        assert row["direction"] == stored, f"direction {raw!r} stored as {row['direction']!r}"


async def test_merged_repoints_history_and_tombstones(mock_pool):
    await handle_contact_merged(mock_pool, _parsed("contact.merged.v1", {
        "survivor_contact_id": "c-surv", "merged_contact_id": "c-dup",
        "merged_at": "2026-07-08T00:00:00+00:00", "actor": "staff-1",
        "consent_resolution": {"marketing": {"granted": False,
                                             "method": "merge_opt_out_dominates"}}}))

    # Re-pointing statements hit interactions, feedback and the audit log
    raw = " ".join(c.sql for c in mock_pool.calls)
    assert "UPDATE interactions SET contact_id_string" in raw
    assert "UPDATE feedback SET contact_id_string" in raw
    assert "UPDATE contact_audit_log SET contact_id_string" in raw

    # Tombstone on the merged row + resolved consent on the survivor
    updates = mock_pool.updates_to("contacts")
    assert any(u.get("merged_into") == "c-surv" for u in updates)
    assert any('"granted": false' in str(u.get("consent", "")) for u in updates)


async def test_erased_redacts_pi():
    pool = FakePool()
    await handle_contact_erased(pool, _parsed("contact.erased.v1", {
        "contact_id": "c-1", "erased_at": "2026-07-02T00:00:00+00:00", "actor": "admin"}))
    sql_all = " ".join(s for s, _ in pool.executed)
    assert "erased" in sql_all and "interactions" in sql_all


# ---------------------------------------------------------------------------
# Remaining handlers, using the richer `mock_pool` fixture (conftest.py) so we
# can assert on the actual column values written, not just SQL substrings.
# ---------------------------------------------------------------------------


async def test_contact_updated_upserts_changed_fields_and_audit(mock_pool):
    await handle_contact_updated(mock_pool, _parsed("contact.updated.v1", {
        "contact_id": "c-1", "city": "Melbourne", "attributes": {"segment": "vip"},
        "updated_at": "2026-07-02T00:00:00+00:00", "actor": "ops"}))

    contact_row = mock_pool.last_insert("contacts")
    assert contact_row["contact_id"] == "c-1"
    assert contact_row["city"] == "Melbourne"
    # attributes is a DELTA applied via jsonb merge (||), not an upsert column —
    # overwriting would wipe flag overlays like advocate/needs_review.
    assert "attributes" not in contact_row
    sql_all = " ".join(c.sql for c in mock_pool.connection.calls)
    assert "||" in sql_all
    audit_row = mock_pool.last_insert("contact_audit_log")
    assert audit_row["contact_id_string"] == "c-1"
    detail = json.loads(audit_row["detail"])["changed_fields"]
    assert "city" in detail and "attributes" in detail


async def test_contact_linked_sets_customer_and_link_basis(mock_pool):
    await handle_contact_linked(mock_pool, _parsed("contact.linked.v1", {
        "contact_id": "c-1", "customer_id": "CUST-1", "match_basis": "mobile",
        "linked_at": "2026-07-02T00:00:00+00:00"}))

    updated = mock_pool.last_update("contacts")
    assert updated["customer_id"] == "CUST-1"
    assert updated["link_basis"] == "mobile"
    assert mock_pool.has_call_against("contact_audit_log")


async def test_contact_unlinked_clears_customer_link(mock_pool):
    await handle_contact_unlinked(mock_pool, _parsed("contact.unlinked.v1", {
        "contact_id": "c-1", "customer_id": "CUST-1", "reason": "duplicate",
        "unlinked_at": "2026-07-02T00:00:00+00:00"}))

    updated = mock_pool.last_update("contacts")
    assert updated["customer_id"] is None
    assert updated["link_basis"] is None
    assert updated["linked_at"] is None


async def test_contact_observed_with_consent_upserts_marketing_consent_snapshot(mock_pool):
    """`contact.observed.v1` carrying a `consent` capture (ConsentCapture:
    granted/channels/method) must serialize into the `contacts.consent`
    jsonb column under the `marketing` key. Exercises the
    `p.consent.model_dump()` -> `json.dumps` path, which the other
    `contact.observed.v1` tests (using a payload with no `consent` field)
    never touch."""
    await handle_contact_observed(mock_pool, _parsed("contact.observed.v1", {
        "contact_id": "c-1", "mobile_e164": "+61400000001", "source": "campus",
        "observed_at": "2026-07-02T00:00:00+00:00",
        "consent": {"granted": True, "channels": ["sms", "email"], "method": "waitlist_form"},
    }))

    contact_row = mock_pool.last_upsert("contacts")
    consent = json.loads(contact_row["consent"])
    assert consent == {
        "marketing": {"granted": True, "channels": ["sms", "email"], "method": "waitlist_form"}
    }


async def test_consent_granted_merges_marketing_consent_jsonb(mock_pool):
    await handle_contact_consent_granted(mock_pool, _parsed("contact.consent.granted.v1", {
        "contact_id": "c-1", "channels": ["sms", "whatsapp"], "method": "waitlist_form",
        "occurred_at": "2026-07-02T00:00:00+00:00", "actor": "c-1"}))

    patch = mock_pool.last_jsonb_merge("contacts", "consent")
    assert patch["marketing"]["granted"] is True
    assert patch["marketing"]["channels"] == ["sms", "whatsapp"]
    assert mock_pool.has_call_against("contact_audit_log")


async def test_consent_withdrawn_merges_marketing_consent_jsonb(mock_pool):
    await handle_contact_consent_withdrawn(mock_pool, _parsed("contact.consent.withdrawn.v1", {
        "contact_id": "c-1", "channels": ["sms"], "method": "reply_stop",
        "occurred_at": "2026-07-02T00:00:00+00:00", "actor": "c-1"}))

    patch = mock_pool.last_jsonb_merge("contacts", "consent")
    assert patch["marketing"]["granted"] is False


async def test_stage_changed_updates_derived_stage(mock_pool):
    await handle_contact_stage_changed(mock_pool, _parsed("contact.stage.changed.v1", {
        "contact_id": "c-1", "previous_stage": "lead", "stage": "waitlist",
        "changed_at": "2026-07-02T00:00:00+00:00"}))

    updated = mock_pool.last_update("contacts")
    assert updated["derived_stage"] == "waitlist"


async def test_interaction_logged_resolves_contact_relationship_id(mock_pool):
    """`interactions.contact_id` (uuid FK) must be resolved from the natural
    key, alongside `contact_id_string` (the marketing SDK's text id) — per the
    C2 migration these are two distinct columns, and the relationship column
    is named `contact_id`, NOT `contact_id_id`."""
    mock_pool.set_fetchval("11111111-1111-1111-1111-111111111111")

    await handle_contact_interaction_logged(mock_pool, _parsed("contact.interaction.logged.v1", {
        "interaction_id": "i-1", "contact_id": "c-1", "kind": "signup",
        "occurred_at": "2026-07-02T00:00:00+00:00", "source_system": "crm"}))

    row = mock_pool.last_upsert("interactions")
    assert row["contact_id_string"] == "c-1"
    assert row["contact_id"] == "11111111-1111-1111-1111-111111111111"


async def test_erased_nulls_pi_columns_and_scrubs_interactions(mock_pool):
    await handle_contact_erased(mock_pool, _parsed("contact.erased.v1", {
        "contact_id": "c-1", "erased_at": "2026-07-02T00:00:00+00:00", "actor": "admin"}))

    updated = mock_pool.last_update("contacts")
    assert updated["first_name"] is None
    assert updated["email"] is None
    assert updated["mobile_e164"] is None
    assert updated["erased"] is True
    # Free-text consent.method and channel_preference are PI and must be cleared too.
    assert json.loads(updated["consent"]) == {}
    assert updated["channel_preference"] is None
    interaction_scrub = [c for c in mock_pool.calls if c.table == "interactions"][0]
    assert interaction_scrub.where.get("contact_id_string") == "c-1"
    audit_row = mock_pool.last_insert("contact_audit_log")
    assert json.loads(audit_row["detail"]) == {}


# ---------------------------------------------------------------------------
# Phase-2 (Stream A) handlers — batches, feedback, referral attribution.
# ---------------------------------------------------------------------------


async def test_batch_created_upserts_batch(mock_pool):
    await handle_batch_created(mock_pool, _parsed("batch.created.v1", {
        "batch_id": "b-1", "name": "Campus wave 1", "actor": "ops",
        "created_at": "2026-07-03T00:00:00+00:00", "criteria": {"source": "campus"}}))

    row = mock_pool.last_upsert("batches")
    assert row["batch_id"] == "b-1"
    assert row["name"] == "Campus wave 1"
    assert row["created_by_actor"] == "ops"
    assert json.loads(row["criteria"]) == {"source": "campus"}
    # Batches are not contact-scoped — no audit row.
    assert not mock_pool.has_call_against("contact_audit_log")


async def test_contact_batch_assigned_sets_batch_id_and_audit(mock_pool):
    await handle_contact_batch_assigned(mock_pool, _parsed("contact.batch.assigned.v1", {
        "batch_id": "b-1", "contact_id": "c-1", "actor": "ops",
        "assigned_at": "2026-07-03T00:00:00+00:00"}))

    updated = mock_pool.last_update("contacts")
    assert updated["batch_id"] == "b-1"
    audit_row = mock_pool.last_insert("contact_audit_log")
    assert audit_row["contact_id_string"] == "c-1"
    assert json.loads(audit_row["detail"])["batch_id"] == "b-1"


async def test_feedback_received_inserts_row_status_new_and_audit(mock_pool):
    await handle_feedback_received(mock_pool, _parsed("feedback.received.v1", {
        "feedback_id": "f-1", "contact_id": "c-1", "type": "bug",
        "text": "app crashed", "received_at": "2026-07-03T00:00:00+00:00"}))

    row = mock_pool.last_upsert("feedback")
    assert row["feedback_id"] == "f-1"
    assert row["contact_id_string"] == "c-1"
    assert row["feedback_type"] == "bug"
    assert row["body"] == "app crashed"
    assert row["status"] == "new"
    audit_row = mock_pool.last_insert("contact_audit_log")
    assert audit_row["contact_id_string"] == "c-1"


async def test_feedback_status_changed_updates_status_and_audits_by_contact(mock_pool):
    # The status event carries no contact_id; the handler looks the feedback's
    # contact up for the audit row.
    mock_pool.set_fetchval("c-1")
    await handle_feedback_status_changed(mock_pool, _parsed("feedback.status.changed.v1", {
        "feedback_id": "f-1", "status": "acknowledged", "actor": "ops",
        "changed_at": "2026-07-03T00:00:00+00:00"}))

    updated = mock_pool.last_update("feedback")
    assert updated["status"] == "acknowledged"
    assert updated["status_actor"] == "ops"
    audit_row = mock_pool.last_insert("contact_audit_log")
    assert audit_row["contact_id_string"] == "c-1"
    assert json.loads(audit_row["detail"])["status"] == "acknowledged"


async def test_referral_attributed_sets_referred_by_on_referee(mock_pool):
    await handle_referral_attributed(mock_pool, _parsed("referral.attributed.v1", {
        "referrer_contact_id": "c-ref", "referee_contact_id": "c-1", "code": "ABC123",
        "attributed_at": "2026-07-03T00:00:00+00:00"}))

    updated = mock_pool.last_update("contacts")
    assert updated["referred_by_contact_id"] == "c-ref"
    audit_row = mock_pool.last_insert("contact_audit_log")
    assert audit_row["contact_id_string"] == "c-1"
    assert json.loads(audit_row["detail"])["referrer_contact_id"] == "c-ref"


async def test_feedback_status_changed_stores_resolution_note(mock_pool) -> None:
    # `note` (what was done) travels on the status event; extra="allow" on the
    # SDK model means it parses even before the SDK adds the field explicitly.
    mock_pool.set_fetchval("c-1")
    await handle_feedback_status_changed(mock_pool, _parsed("feedback.status.changed.v1", {
        "feedback_id": "f-1", "status": "resolved", "actor": "ops",
        "changed_at": "2026-07-07T00:00:00+00:00",
        "note": "Called the contact; fixed in release 1.4"}))

    updated = mock_pool.last_update("feedback")
    assert updated["status"] == "resolved"
    assert updated["status_note"] == "Called the contact; fixed in release 1.4"


async def test_feedback_status_changed_without_note_leaves_column_untouched(mock_pool) -> None:
    # Pre-note events (and pre-note SDK models) keep working — status_note is
    # omitted from the UPDATE rather than nulled.
    mock_pool.set_fetchval("c-1")
    await handle_feedback_status_changed(mock_pool, _parsed("feedback.status.changed.v1", {
        "feedback_id": "f-1", "status": "acknowledged", "actor": "ops",
        "changed_at": "2026-07-07T00:00:00+00:00"}))

    updated = mock_pool.last_update("feedback")
    assert updated["status"] == "acknowledged"
    assert "status_note" not in updated


async def test_contact_updated_merges_attributes_and_mirrors_needs_review(mock_pool):
    # attributes is a DELTA — merged via jsonb ||, never overwritten — and
    # needs_review mirrors to its dedicated grid-filterable column (A2).
    await handle_contact_updated(mock_pool, _parsed("contact.updated.v1", {
        "contact_id": "c-1", "attributes": {"needs_review": True, "needs_review_reason": "dupe?"},
        "updated_at": "2026-07-08T00:00:00+00:00", "actor": "staff-1"}))

    upserted = mock_pool.last_insert("contacts")
    assert upserted["needs_review"] is True
    # merge_jsonb issues a jsonb-concat UPDATE for the attributes patch
    sql_all = " ".join(c.sql for c in mock_pool.connection.calls)
    assert "||" in sql_all and "attributes" in sql_all


async def test_stage_changed_mirrors_loan_status_when_present(mock_pool):
    await handle_contact_stage_changed(mock_pool, _parsed("contact.stage.changed.v1", {
        "contact_id": "c-1", "previous_stage": "waitlist", "stage": "customer",
        "changed_at": "2026-07-08T00:00:00+00:00", "loan_status": "disbursed"}))
    updated = mock_pool.last_update("contacts")
    assert updated["derived_stage"] == "customer"
    assert updated["loan_status"] == "disbursed"


async def test_stage_changed_without_loan_status_leaves_column_untouched(mock_pool):
    await handle_contact_stage_changed(mock_pool, _parsed("contact.stage.changed.v1", {
        "contact_id": "c-1", "stage": "waitlist",
        "changed_at": "2026-07-08T00:00:00+00:00"}))
    updated = mock_pool.last_update("contacts")
    assert "loan_status" not in updated


async def test_stage_changed_naive_downgrade_refused_without_state_basis(mock_pool):
    # Mirrors marketingService's apply_stage guard: a naive lead/waitlist event
    # must not downgrade a protected stage — only basis="state" may.
    mock_pool.set_fetchval("customer")  # current derived_stage
    await handle_contact_stage_changed(mock_pool, _parsed("contact.stage.changed.v1", {
        "contact_id": "c-1", "stage": "waitlist",
        "changed_at": "2026-07-08T00:00:00+00:00"}))
    assert mock_pool.last_update("contacts") is None  # refused


async def test_stage_changed_state_basis_may_downgrade(mock_pool):
    mock_pool.set_fetchval("applicant")
    await handle_contact_stage_changed(mock_pool, _parsed("contact.stage.changed.v1", {
        "contact_id": "c-1", "stage": "waitlist", "basis": "state",
        "changed_at": "2026-07-08T00:00:00+00:00"}))
    updated = mock_pool.last_update("contacts")
    assert updated["derived_stage"] == "waitlist"  # Bx abandonment — legitimate


async def test_batch_invitations_triggered_persists_outcome(mock_pool):
    # Phase 3: send outcomes persist on the batch row (and invited_at drives
    # the "invited" stage derivation).
    await handle_batch_invitations_triggered(mock_pool, _parsed(
        "batch.invitations.triggered.v1", {
            "batch_id": "b-1", "invited_count": 42, "skipped_unconsented": 3,
            "skipped_needs_review": 1, "triggered_at": "2026-07-08T02:00:00+00:00",
            "actor": "staff-1"}))
    updated = mock_pool.last_update("batches")
    assert updated["invited_count"] == 42
    assert updated["skipped_unconsented"] == 3
    assert updated["skipped_needs_review"] == 1
    assert updated["invited_at"] is not None
