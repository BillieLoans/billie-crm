"""help@ mailbox connector (Decision J).

Polls an IMAP inbox and logs each email as an inbound ``message_in``
interaction on the matching contact's timeline, via the same
MarketingService.LogInteraction command every other channel uses. Contacts
are resolved by sender email (non-erased, non-merged). Unmatched senders are
skipped (marked seen) — help@ receives plenty of mail from non-contacts, and
inventing contacts from inbound email is deliberately out of scope.

Idempotent: the LogInteraction idempotency key derives from the Message-ID
(or a content hash when absent), so a crash between processing and marking
seen cannot double-log an email.

Enabled only when ``HELP_MAILBOX_IMAP_HOST`` is configured; see config.py.
"""

from __future__ import annotations

import asyncio
import email
import email.utils
import hashlib
import imaplib
import json
from dataclasses import dataclass
from datetime import timezone

import asyncpg
import structlog

from . import marketing_client
from .config import settings

logger = structlog.get_logger(__name__)

BODY_MAX_CHARS = 4000


@dataclass
class ParsedEmail:
    from_addr: str
    subject: str
    body: str
    message_id: str
    occurred_at: str  # ISO-8601 UTC, or "" when the Date header is absent


def parse_help_email(raw: bytes) -> ParsedEmail | None:
    """Parse a raw RFC-822 message into the fields we log. Returns None when
    there is no usable sender address."""
    msg = email.message_from_bytes(raw)

    _, from_addr = email.utils.parseaddr(msg.get("From", ""))
    if not from_addr or "@" not in from_addr:
        return None

    subject = str(msg.get("Subject", "") or "").strip()

    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get_filename():
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    body = payload.decode(charset, errors="replace")
                    break
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            body = payload.decode(charset, errors="replace")
    body = body.strip()[:BODY_MAX_CHARS]

    message_id = str(msg.get("Message-ID", "") or "").strip()
    if not message_id:
        message_id = hashlib.sha256(raw).hexdigest()[:32]

    occurred_at = ""
    date_hdr = msg.get("Date")
    if date_hdr:
        try:
            dt = email.utils.parsedate_to_datetime(date_hdr)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            occurred_at = dt.astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError):
            pass

    return ParsedEmail(
        from_addr=from_addr.lower(),
        subject=subject,
        body=body,
        message_id=message_id,
        occurred_at=occurred_at,
    )


async def process_help_email(pool: asyncpg.Pool, raw: bytes) -> str:
    """Log one raw email against its contact. Returns a status string:
    ``logged`` | ``no_contact`` | ``unparseable``."""
    parsed = parse_help_email(raw)
    if parsed is None:
        return "unparseable"

    contact_id = await pool.fetchval(
        "SELECT contact_id FROM contacts"
        " WHERE lower(email) = $1"
        " AND erased IS NOT TRUE AND merged_into IS NULL"
        " ORDER BY updated_at DESC LIMIT 1",
        parsed.from_addr,
    )
    if contact_id is None:
        logger.info("help_mailbox: no contact for sender; skipping")
        return "no_contact"

    idempotency_key = (
        "helpmail:" + hashlib.sha256(parsed.message_id.encode()).hexdigest()[:24]
    )
    await marketing_client.log_interaction(
        idempotency_key=idempotency_key,
        contact_id=str(contact_id),
        kind="message_in",
        channel="email",
        direction="inbound",
        subject=parsed.subject,
        body=parsed.body,
        source_system="help_mailbox",
        occurred_at=parsed.occurred_at,
        metadata_json=json.dumps({"mailbox": "help", "message_id": parsed.message_id}),
        actor="help_mailbox",
    )
    logger.info("help_mailbox: interaction logged", contact_id=str(contact_id))
    return "logged"


def _fetch_unseen() -> list[tuple[bytes, bytes]]:
    """Fetch (uid, raw_bytes) for every unseen message. Synchronous —
    imaplib has no async API; callers run this in a thread."""
    conn = imaplib.IMAP4_SSL(
        settings.help_mailbox_imap_host, settings.help_mailbox_imap_port
    )
    try:
        conn.login(settings.help_mailbox_user, settings.help_mailbox_password)
        conn.select(settings.help_mailbox_folder)
        _, data = conn.uid("search", None, "UNSEEN")
        uids = data[0].split() if data and data[0] else []
        out: list[tuple[bytes, bytes]] = []
        for uid in uids:
            _, msg_data = conn.uid("fetch", uid, "(RFC822)")
            for part in msg_data or []:
                if isinstance(part, tuple) and len(part) >= 2:
                    out.append((uid, part[1]))
                    break
        return out
    finally:
        try:
            conn.logout()
        except Exception:  # noqa: BLE001 — best-effort teardown
            pass


def _mark_seen(uids: list[bytes]) -> None:
    if not uids:
        return
    conn = imaplib.IMAP4_SSL(
        settings.help_mailbox_imap_host, settings.help_mailbox_imap_port
    )
    try:
        conn.login(settings.help_mailbox_user, settings.help_mailbox_password)
        conn.select(settings.help_mailbox_folder)
        for uid in uids:
            conn.uid("store", uid, "+FLAGS", "(\\Seen)")
    finally:
        try:
            conn.logout()
        except Exception:  # noqa: BLE001
            pass


async def run_help_mailbox_loop(pool: asyncpg.Pool) -> None:
    """Poll the help@ mailbox forever. One IMAP round per interval; every
    processed message (logged, unmatched or unparseable) is marked seen —
    idempotency keys make crash-window replays harmless."""
    logger.info(
        "help_mailbox: polling enabled",
        host=settings.help_mailbox_imap_host,
        interval=settings.help_mailbox_poll_seconds,
    )
    while True:
        try:
            messages = await asyncio.to_thread(_fetch_unseen)
            processed: list[bytes] = []
            for uid, raw in messages:
                try:
                    await process_help_email(pool, raw)
                    processed.append(uid)
                except Exception:  # noqa: BLE001 — skip poisoned message, keep loop alive
                    logger.exception("help_mailbox: failed to process message")
            await asyncio.to_thread(_mark_seen, processed)
        except Exception:  # noqa: BLE001 — IMAP outages must not kill the loop
            logger.exception("help_mailbox: poll failed")
        await asyncio.sleep(settings.help_mailbox_poll_seconds)
