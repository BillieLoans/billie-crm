"""Handler for captured ClickSend inbound SMS (``clicksend.inbound.received.v1``).

The CRM webhook enqueues the raw inbound onto the internal stream and returns
200; this handler does the async work: normalise the sender number, resolve it
to a marketing contact via the projection, and issue a marketingService
``LogInteraction`` (kind=message_in) so the reply lands on the contact timeline
as a proper ``contact.interaction.logged.v1`` event. Unresolvable / unmatched
senders are logged and skipped (no phantom contacts from stray SMS).
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog

from .. import marketing_client

logger = structlog.get_logger()


def _parse_payload(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("payload", {})
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return {}
    return payload if isinstance(payload, dict) else {}


def normalise_au_mobile(raw: str | None) -> str | None:
    """Normalise an AU mobile to E.164 (``+61XXXXXXXXX``); None if it can't be."""
    if not raw:
        return None
    digits = re.sub(r"[^\d+]", "", raw)
    if digits.startswith("+61"):
        candidate = digits
    elif digits.startswith("61"):
        candidate = "+" + digits
    elif digits.startswith("0"):
        candidate = "+61" + digits[1:]
    elif digits.startswith("4") and len(digits) == 9:
        candidate = "+61" + digits
    else:
        return None
    return candidate if re.fullmatch(r"\+61\d{9}", candidate) else None


def _coerce_occurred_at(ts: str | int | None) -> str:
    """ClickSend timestamps are unix seconds; return ISO-8601 or '' (= now)."""
    if ts is None or ts == "":
        return ""
    try:
        return datetime.fromtimestamp(int(ts), tz=UTC).isoformat()
    except (ValueError, TypeError, OSError):
        return ""


async def handle_clicksend_inbound(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Handle ``clicksend.inbound.received.v1`` — resolve sender → LogInteraction."""
    payload = _parse_payload(event)
    mobile = normalise_au_mobile(payload.get("from"))
    if not mobile:
        logger.warning("clicksend inbound: unnormalisable sender, skipping")
        return

    contact_id = await pool.fetchval(
        "SELECT contact_id FROM contacts WHERE mobile_e164 = $1 AND erased IS NOT TRUE",
        mobile,
    )
    if not contact_id:
        logger.warning("clicksend inbound: no contact for sender, skipping", mobile=mobile)
        return

    message_id = payload.get("message_id") or ""
    metadata = {
        k: payload.get(k)
        for k in ("to", "custom_string", "original_message_id", "message_id")
        if payload.get(k)
    }
    await marketing_client.log_interaction(
        idempotency_key=f"clicksend:{message_id or mobile}",
        contact_id=contact_id,
        kind="message_in",
        channel="sms",
        direction="inbound",
        body=payload.get("body") or "",
        source_system="clicksend",
        occurred_at=_coerce_occurred_at(payload.get("timestamp") or payload.get("timestamp_send")),
        metadata_json=json.dumps(metadata),
        actor="clicksend",
    )
    logger.info("clicksend inbound logged", contact_id=contact_id, message_id=message_id)
