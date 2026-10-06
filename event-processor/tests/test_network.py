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
