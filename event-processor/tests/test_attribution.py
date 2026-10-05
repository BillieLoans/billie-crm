"""Ad-click attribution projection (BTB-404).

``conversation_started`` (routed liaison agent → CRM) carries
``payload.attribution`` for applications that arrived from an ad click. The
handler initialises the conversation row without overwriting anything a later
event has already set, then writes ``conversations.attribution`` only while
the column is still NULL, so the first value wins on replay and out-of-order
delivery.
"""

from __future__ import annotations

import json

import pytest

from billie_servicing.handlers.attribution import sanitise_attribution
from billie_servicing.handlers.conversation import handle_conversation_started

GOOD = {
    "gclid": "Cj0KCQjw-abc_123",
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "borrow-200",
    "utm_term": "pay advance",
    "matchtype": "p",
    "captured_at": "2026-10-12T01:02:03.000Z",
    "received_at": "2026-10-12T01:02:04+00:00",
}


def _event(payload: object) -> dict:
    return {
        "typ": "conversation_started",
        "cid": "CONV-ATTR-1",
        "usr": "CUS-1",
        "payload": payload,
    }


def _attribution_writes(mock_pool) -> list:
    """Every recorded SQL call that writes the attribution column."""
    return [c for c in mock_pool.calls if "SET attribution" in c.sql]


class TestSanitiseAttribution:
    def test_keeps_known_keys_and_timestamps(self) -> None:
        """Known parameters and both timestamps pass through unchanged."""
        assert sanitise_attribution(GOOD) == GOOD

    def test_drops_unknown_keys(self) -> None:
        """Keys outside the contract never reach the database."""
        out = sanitise_attribution({**GOOD, "$where": "1", "evil": "x"})
        assert out == GOOD

    def test_drops_bad_values_but_keeps_the_rest(self) -> None:
        """A value with a disallowed character, a non-string or an over-long
        value is dropped on its own."""
        out = sanitise_attribution(
            {
                "gclid": "abc",
                "utm_term": "<script>",
                "utm_campaign": {"$ne": None},
                "utm_content": "x" * 513,
            }
        )
        assert out == {"gclid": "abc"}

    @pytest.mark.parametrize(
        "value",
        [
            "$500 loan",
            "Brand (Exact)",
            "R&D",
            "what's a pay advance?",
            "prêt rapide",
            "[pay advance] #1 50% off!",
            "name@campaign*",
        ],
    )
    def test_keeps_ordinary_keyword_and_campaign_text(self, value: str) -> None:
        """Real keywords and campaign names carry currency signs, brackets,
        ampersands, apostrophes and non-ASCII letters."""
        assert sanitise_attribution({"utm_term": value}) == {"utm_term": value}

    @pytest.mark.parametrize(
        "value",
        ["<b>", 'say "hi"', "a=b", "a;b", "a\\b", "a{b}", "a`b", "tab\there", "google\n"],
    )
    def test_rejects_markup_control_and_syntax_characters(self, value: str) -> None:
        """Markup, quoting, assignment and control characters never survive —
        including a trailing newline."""
        assert sanitise_attribution({"utm_term": value}) is None

    @pytest.mark.parametrize("raw", [None, "gclid=abc", ["gclid"], {}, {"utm_term": ""}])
    def test_returns_none_when_nothing_survives(self, raw: object) -> None:
        """Non-dicts and dicts with no valid parameter yield None."""
        assert sanitise_attribution(raw) is None

    def test_timestamps_alone_are_not_attribution(self) -> None:
        """Timestamps without any parameter are not worth storing."""
        assert sanitise_attribution({"captured_at": "2026-10-12T01:02:03Z"}) is None


class TestConversationStartedAttribution:
    @pytest.mark.asyncio
    async def test_initialises_the_row_then_writes_attribution_only_when_null(
        self, mock_pool
    ) -> None:
        """The row is initialised first; the attribution UPDATE is guarded by
        ``attribution IS NULL`` (first write wins)."""
        await handle_conversation_started(
            mock_pool, _event({"application_number": "APP-1", "attribution": GOOD})
        )

        inserted = mock_pool.last_insert("conversations")
        assert inserted["conversation_id"] == "CONV-ATTR-1"
        assert inserted["customer_id_string"] == "CUS-1"
        assert inserted["application_number"] == "APP-1"
        updates = _attribution_writes(mock_pool)
        assert len(updates) == 1
        assert updates[0].sql.startswith("UPDATE conversations")
        assert "attribution IS NULL" in updates[0].sql
        assert json.loads(updates[0].args[0]) == GOOD
        assert updates[0].args[1] == "CONV-ATTR-1"

    @pytest.mark.asyncio
    async def test_accepts_a_json_string_payload(self, mock_pool) -> None:
        """The ledger may deliver ``payload`` as a JSON-encoded string: both the
        application number and the attribution are still read from it."""
        await handle_conversation_started(
            mock_pool,
            _event(json.dumps({"application_number": "APP-1", "attribution": GOOD})),
        )

        assert mock_pool.last_insert("conversations")["application_number"] == "APP-1"
        updates = _attribution_writes(mock_pool)
        assert json.loads(updates[0].args[0])["gclid"] == GOOD["gclid"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "payload",
        [
            {"application_number": "APP-1"},
            {"application_number": "APP-1", "attribution": None},
            {"application_number": "APP-1", "attribution": "gclid=abc"},
            {"application_number": "APP-1", "attribution": {"x": "y"}},
        ],
    )
    async def test_no_attribution_write_without_valid_attribution(
        self, mock_pool, payload: dict
    ) -> None:
        """An organic conversation is initialised and nothing else."""
        await handle_conversation_started(mock_pool, _event(payload))

        assert mock_pool.last_insert("conversations")["conversation_id"] == "CONV-ATTR-1"
        assert _attribution_writes(mock_pool) == []


class TestConversationStartedDoesNotRegressARow:
    """``conversation_started`` is an init event. It normally arrives after the
    first ``user_input`` has already created the row, and it can be processed
    late. Either way it may fill blanks but must never overwrite what a later
    event set — a closed conversation must not come back as active, and a
    re-keyed customer must not revert to the journey id."""

    @staticmethod
    async def _conflict_clause(mock_pool) -> str:
        await handle_conversation_started(
            mock_pool, _event({"application_number": "APP-1"})
        )
        insert_sql = next(c.sql for c in mock_pool.calls if c.op == "INSERT")
        assert "ON CONFLICT (conversation_id) DO UPDATE SET" in insert_sql
        # All whitespace removed, so the assertions do not depend on SQL layout.
        return "".join(insert_sql.split("DO UPDATE SET", 1)[1].split())

    @pytest.mark.asyncio
    async def test_status_is_never_updated_on_conflict(self, mock_pool) -> None:
        """Status belongs to the events that end or decide a conversation."""
        assert "status" not in await self._conflict_clause(mock_pool)

    @pytest.mark.asyncio
    async def test_customer_is_filled_only_when_missing(self, mock_pool) -> None:
        """An existing customer link or id wins over the started event's."""
        clause = await self._conflict_clause(mock_pool)
        assert (
            "customer_id_id=COALESCE(conversations.customer_id_id,EXCLUDED.customer_id_id)"
            in clause
        )
        assert (
            "customer_id_string=COALESCE(conversations.customer_id_string,"
            "EXCLUDED.customer_id_string)" in clause
        )

    @pytest.mark.asyncio
    async def test_application_number_is_filled_only_when_blank(self, mock_pool) -> None:
        """The row the first ``user_input`` created has a blank application
        number; that is filled. A real one is never replaced or blanked."""
        clause = await self._conflict_clause(mock_pool)
        assert (
            "application_number=COALESCE(NULLIF(conversations.application_number,''),"
            "EXCLUDED.application_number)" in clause
        )

    @pytest.mark.asyncio
    async def test_version_is_bumped_on_conflict(self, mock_pool) -> None:
        """The CRM's optimistic-concurrency layer sees the change."""
        assert "version=COALESCE(conversations.version,1)+1" in await self._conflict_clause(
            mock_pool
        )


def test_attribution_has_one_way_in() -> None:
    """Attribution arrives on ``conversation_started``; there is no separate
    attribution event to register."""
    from billie_servicing.main import setup_handlers

    class Recorder:
        def __init__(self) -> None:
            self.handlers: dict = {}

        def register_handler(self, event_type: str, handler: object) -> None:
            self.handlers[event_type] = handler

        def __getattr__(self, _name: str):  # tolerate other registration styles
            return lambda *_a, **_k: None

    recorder = Recorder()
    setup_handlers(recorder)
    assert recorder.handlers["conversation_started"] is handle_conversation_started
    assert "conversation_attribution" not in recorder.handlers
