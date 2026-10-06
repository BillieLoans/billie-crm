"""Network provenance projection (BTB-406).

``conversation_started`` (routed liaison agent → CRM) carries
``payload.network`` — the client's country, ASN and IP read off the
Cloudflare-attested headers at ``/chat/init``. The handler initialises the
conversation row without overwriting anything, then writes
``conversations.network`` only while the column is still NULL, so the first
value wins on replay and out-of-order delivery.
"""

from __future__ import annotations

import json

import pytest

from billie_servicing.handlers.conversation import handle_conversation_started
from billie_servicing.handlers.network import sanitise_network

GOOD = {
    "country": "AU",
    "asn": "1221",
    "ip": "203.0.113.9",
    "received_at": "2026-10-12T01:02:04+00:00",
}


def _event(payload: object) -> dict:
    return {
        "typ": "conversation_started",
        "cid": "CONV-NET-1",
        "usr": "CUS-1",
        "payload": payload,
    }


def _network_writes(mock_pool: object) -> list:
    """Every recorded SQL call that writes the network column."""
    return [c for c in mock_pool.calls if "SET network" in c.sql]


class TestSanitiseNetwork:
    def test_keeps_known_keys(self) -> None:
        """Country, ASN, IP and the timestamp pass through unchanged."""
        assert sanitise_network(GOOD) == GOOD

    def test_drops_unknown_keys(self) -> None:
        """Keys outside the contract never reach the database."""
        assert sanitise_network({**GOOD, "$where": "1", "city": "Melbourne"}) == GOOD

    def test_keeps_cloudflare_special_codes(self) -> None:
        """Cloudflare sends T1 for Tor and XX for unknown; both are labels worth keeping."""
        assert sanitise_network({"country": "T1"}) == {"country": "T1"}
        assert sanitise_network({"country": "XX"}) == {"country": "XX"}

    @pytest.mark.parametrize("country", ["au", "AUS", "A", "", "1A", "<b>"])
    def test_drops_a_bad_country_but_keeps_the_rest(self, country: str) -> None:
        """A malformed country is dropped on its own."""
        out = sanitise_network({**GOOD, "country": country})
        assert out is not None
        assert "country" not in out
        assert out["asn"] == "1221"

    @pytest.mark.parametrize("asn", ["0", "4294967296", "12a", "-1", "", " 1221"])
    def test_drops_a_bad_asn(self, asn: str) -> None:
        """Out-of-range, non-numeric or padded ASNs are dropped."""
        out = sanitise_network({**GOOD, "asn": asn})
        assert out is not None and "asn" not in out

    def test_ipv6_round_trips(self) -> None:
        """IPv6 clients are ordinary."""
        out = sanitise_network({"ip": "2001:8004:6b21:16c9::1"})
        assert out == {"ip": "2001:8004:6b21:16c9::1"}

    @pytest.mark.parametrize("ip", ["203.0.113", "not an ip", "1.2.3.4; DROP", "", 1234])
    def test_drops_a_bad_ip(self, ip: object) -> None:
        """Anything ``ipaddress`` rejects is dropped."""
        out = sanitise_network({**GOOD, "ip": ip})
        assert out is not None and "ip" not in out

    def test_drops_a_bad_timestamp_only(self) -> None:
        """A garbage timestamp does not lose the record."""
        out = sanitise_network({**GOOD, "received_at": "yesterday <b>"})
        assert out is not None and "received_at" not in out and out["asn"] == "1221"

    def test_timestamp_alone_is_not_network(self) -> None:
        """A timestamp without any value is not worth storing."""
        assert sanitise_network({"received_at": "2026-10-12T01:02:03Z"}) is None

    @pytest.mark.parametrize("raw", [None, "country=AU", ["AU"], {}, {"x": "y"}])
    def test_returns_none_for_non_dicts_and_empty(self, raw: object) -> None:
        """Anything that is not a dict with a valid value yields None."""
        assert sanitise_network(raw) is None


class TestConversationStartedNetwork:
    @pytest.mark.asyncio
    async def test_initialises_the_row_then_writes_network_only_when_null(
        self, mock_pool: object
    ) -> None:
        """The row is initialised first; the network UPDATE is guarded by
        ``network IS NULL`` (first write wins)."""
        await handle_conversation_started(
            mock_pool, _event({"application_number": "APP-1", "network": GOOD})
        )

        inserted = mock_pool.last_insert("conversations")
        assert inserted["conversation_id"] == "CONV-NET-1"
        assert inserted["application_number"] == "APP-1"
        updates = _network_writes(mock_pool)
        assert len(updates) == 1
        assert updates[0].sql.startswith("UPDATE conversations")
        assert "network IS NULL" in updates[0].sql
        assert json.loads(updates[0].args[0]) == GOOD
        assert updates[0].args[1] == "CONV-NET-1"

    @pytest.mark.asyncio
    async def test_accepts_a_json_string_payload(self, mock_pool: object) -> None:
        """The ledger may deliver ``payload`` as a JSON-encoded string."""
        await handle_conversation_started(
            mock_pool,
            _event(json.dumps({"application_number": "APP-1", "network": GOOD})),
        )

        updates = _network_writes(mock_pool)
        assert json.loads(updates[0].args[0])["asn"] == "1221"

    @pytest.mark.asyncio
    async def test_attribution_and_network_both_write(self, mock_pool: object) -> None:
        """A conversation from an ad click carries both facets; each gets its
        own guarded UPDATE."""
        await handle_conversation_started(
            mock_pool,
            _event(
                {
                    "application_number": "APP-1",
                    "attribution": {"gclid": "abc"},
                    "network": GOOD,
                }
            ),
        )

        assert len([c for c in mock_pool.calls if "SET attribution" in c.sql]) == 1
        assert len(_network_writes(mock_pool)) == 1

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "payload",
        [
            {"application_number": "APP-1"},
            {"application_number": "APP-1", "network": None},
            {"application_number": "APP-1", "network": "country=AU"},
            {"application_number": "APP-1", "network": {"city": "Melbourne"}},
        ],
    )
    async def test_no_network_write_without_valid_network(
        self, mock_pool: object, payload: dict
    ) -> None:
        """A conversation without usable headers is initialised and nothing else."""
        await handle_conversation_started(mock_pool, _event(payload))

        assert mock_pool.last_insert("conversations")["conversation_id"] == "CONV-NET-1"
        assert _network_writes(mock_pool) == []
