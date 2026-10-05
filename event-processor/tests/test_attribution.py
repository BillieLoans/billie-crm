"""Ad-click attribution projection (BTB-404).

``conversation_started`` may carry ``payload.attribution``. The handler writes
it to ``conversations.attribution`` only when the column is still NULL, so the
first value wins on replay and out-of-order delivery.
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
    return {"cid": "CONV-ATTR-1", "usr": "CUS-1", "payload": payload}


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

    @pytest.mark.parametrize("raw", [None, "gclid=abc", ["gclid"], {}, {"utm_term": ""}])
    def test_returns_none_when_nothing_survives(self, raw: object) -> None:
        """Non-dicts and dicts with no valid parameter yield None."""
        assert sanitise_attribution(raw) is None

    def test_timestamps_alone_are_not_attribution(self) -> None:
        """Timestamps without any parameter are not worth storing."""
        assert sanitise_attribution({"captured_at": "2026-10-12T01:02:03Z"}) is None


class TestConversationStartedAttribution:
    @pytest.mark.asyncio
    async def test_writes_attribution_only_when_null(self, mock_pool) -> None:
        """The UPDATE is guarded by ``attribution IS NULL`` (first write wins)."""
        await handle_conversation_started(
            mock_pool, _event({"application_number": "APP-1", "attribution": GOOD})
        )

        assert mock_pool.last_insert("conversations")["conversation_id"] == "CONV-ATTR-1"
        updates = _attribution_writes(mock_pool)
        assert len(updates) == 1
        assert updates[0].sql.startswith("UPDATE conversations")
        assert "attribution IS NULL" in updates[0].sql
        assert json.loads(updates[0].args[0]) == GOOD
        assert updates[0].args[1] == "CONV-ATTR-1"

    @pytest.mark.asyncio
    async def test_accepts_a_json_string_payload(self, mock_pool) -> None:
        """The ledger may deliver ``payload`` as a JSON-encoded string."""
        await handle_conversation_started(
            mock_pool,
            _event(json.dumps({"application_number": "APP-1", "attribution": GOOD})),
        )
        updates = _attribution_writes(mock_pool)
        assert json.loads(updates[0].args[0])["gclid"] == GOOD["gclid"]

    @pytest.mark.asyncio
    async def test_no_update_without_attribution(self, mock_pool) -> None:
        """An organic conversation issues no attribution UPDATE at all."""
        await handle_conversation_started(mock_pool, _event({"application_number": "APP-1"}))
        assert _attribution_writes(mock_pool) == []

    @pytest.mark.asyncio
    async def test_attribution_failure_never_fails_the_handler(self, mock_pool) -> None:
        """A failing attribution write is logged and swallowed; the row stays."""
        original = mock_pool.connection._record_execute

        async def flaky(sql: str, *args: object) -> str:
            if "SET attribution" in sql:
                raise RuntimeError("column does not exist")
            return await original(sql, *args)

        mock_pool.execute.side_effect = flaky
        await handle_conversation_started(
            mock_pool, _event({"application_number": "APP-1", "attribution": GOOD})
        )
        assert mock_pool.last_insert("conversations")["conversation_id"] == "CONV-ATTR-1"
