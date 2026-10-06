"""Network provenance carried on ``conversation_started`` (BTB-406).

The chat reads the client's country, ASN and IP off the Cloudflare-attested
request headers at ``/chat/init`` and publishes them as ``payload.network``.
They are re-validated here even though the chat backend already did: known
keys only, each with a strict shape. Labelling only — nothing scores on it.
The IP is personal information; the detail route serves it to supervisors only.
"""

from __future__ import annotations

import ipaddress
import re

_MAX_ASN = 4_294_967_295  # 32-bit ASN space
# ISO 3166-1 alpha-2, plus Cloudflare's "T1" (Tor) and "XX" (unknown) — both
# are kept as useful labels. The second character admits a digit for T1 only.
_COUNTRY_RE = re.compile(r"[A-Z][A-Z0-9]")
# Decimal, no sign, no padding: the chat normalises before publishing.
_ASN_RE = re.compile(r"[1-9][0-9]{0,9}")
_TIMESTAMP_RE = re.compile(r"[0-9T:.+\-Z]{10,40}")


def _ip(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return None


def sanitise_network(raw: object) -> dict[str, str] | None:
    """Return the storable network dict, or None when nothing is valid."""
    if not isinstance(raw, dict):
        return None
    out: dict[str, str] = {}
    country = raw.get("country")
    if isinstance(country, str) and _COUNTRY_RE.fullmatch(country):
        out["country"] = country
    asn = raw.get("asn")
    if isinstance(asn, str) and _ASN_RE.fullmatch(asn) and int(asn) <= _MAX_ASN:
        out["asn"] = asn
    ip = _ip(raw.get("ip"))
    if ip:
        out["ip"] = ip
    if not out:
        return None
    received_at = raw.get("received_at")
    if isinstance(received_at, str) and _TIMESTAMP_RE.fullmatch(received_at):
        out["received_at"] = received_at
    return out
