"""Ad-click attribution projection (BTB-404).

The chat publishes a dedicated ``conversation_attribution`` event for
applications that arrived from an ad click. Its handler makes sure the
conversation row exists and writes ``conversations.attribution`` only while
the column is still NULL, so the first value wins on replay and out-of-order
delivery. No other column of an existing row is touched.
"""

from __future__ import annotations

import json

import pytest

from billie_servicing.handlers.attribution import sanitise_attribution
from billie_servicing.handlers.conversation import (
    handle_conversation_attribution,
    handle_conversation_started,
)

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
        "typ": "conversation_attribution",
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


class TestConversationAttribution:
    @pytest.mark.asyncio
    async def test_creates_the_row_then_writes_attribution_only_when_null(
        self, mock_pool
    ) -> None:
        """The row is ensured first; the UPDATE is guarded by
        ``attribution IS NULL`` (first write wins)."""
        await handle_conversation_attribution(
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
    async def test_never_overwrites_columns_of_an_existing_row(self, mock_pool) -> None:
        """The row is created with ON CONFLICT DO NOTHING — status, customer
        and application number of an existing row belong to other handlers —
        and the only UPDATE is the guarded attribution write."""
        await handle_conversation_attribution(
            mock_pool, _event({"application_number": "APP-1", "attribution": GOOD})
        )

        insert_sql = next(c.sql for c in mock_pool.calls if c.op == "INSERT")
        assert "ON CONFLICT (conversation_id) DO NOTHING" in insert_sql
        updates = [c for c in mock_pool.calls if c.op == "UPDATE"]
        assert updates == _attribution_writes(mock_pool)
        for column in ("status", "application_number", "customer_id"):
            assert f"{column} =" not in updates[0].sql.split("WHERE")[0]

    @pytest.mark.asyncio
    async def test_accepts_a_json_string_payload(self, mock_pool) -> None:
        """The ledger may deliver ``payload`` as a JSON-encoded string."""
        await handle_conversation_attribution(
            mock_pool,
            _event(json.dumps({"application_number": "APP-1", "attribution": GOOD})),
        )
        updates = _attribution_writes(mock_pool)
        assert json.loads(updates[0].args[0])["gclid"] == GOOD["gclid"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "payload",
        [{}, {"attribution": None}, {"attribution": "gclid=abc"}, {"attribution": {"x": "y"}}],
    )
    async def test_no_sql_at_all_without_valid_attribution(
        self, mock_pool, payload: dict
    ) -> None:
        """An event with nothing storable touches the database not at all."""
        await handle_conversation_attribution(mock_pool, _event(payload))
        assert mock_pool.calls == []

    @pytest.mark.asyncio
    async def test_conversation_started_does_not_write_attribution(self, mock_pool) -> None:
        """Attribution has one path in: the dedicated event."""
        await handle_conversation_started(
            mock_pool,
            {"cid": "CONV-ATTR-2", "usr": "CUS-1", "payload": {"attribution": GOOD}},
        )
        assert _attribution_writes(mock_pool) == []


def test_conversation_attribution_handler_is_registered() -> None:
    """The processor must dispatch ``conversation_attribution`` to the handler —
    an unregistered type is logged and dropped."""
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
    assert recorder.handlers["conversation_attribution"] is handle_conversation_attribution
