"""Ad-click attribution carried on ``conversation_started`` (BTB-404).

The chat captures gclid/gbraid/wbraid/UTM/matchtype from the Apply URL and
publishes them as ``payload.attribution``. The values originate in a URL
anyone can craft, so they are re-validated here even though the chat backend
already sanitised them: known keys only, short plain strings only.
"""

from __future__ import annotations

import re

ATTRIBUTION_KEYS = (
    "gclid",
    "gbraid",
    "wbraid",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "matchtype",
)
_TIMESTAMP_KEYS = ("captured_at", "received_at")
_MAX_LEN = 512
_VALUE_RE = re.compile(r"^[A-Za-z0-9 _\-.~+:|,/]+$")
_TIMESTAMP_RE = re.compile(r"^[0-9T:.+\-Z]{10,40}$")


def sanitise_attribution(raw: object) -> dict[str, str] | None:
    """Return the storable attribution dict, or None when nothing is valid."""
    if not isinstance(raw, dict):
        return None
    out: dict[str, str] = {}
    for key in ATTRIBUTION_KEYS:
        value = raw.get(key)
        if (
            isinstance(value, str)
            and 0 < len(value) <= _MAX_LEN
            and _VALUE_RE.match(value)
        ):
            out[key] = value
    if not out:
        return None
    for key in _TIMESTAMP_KEYS:
        value = raw.get(key)
        if isinstance(value, str) and _TIMESTAMP_RE.match(value):
            out[key] = value
    return out
