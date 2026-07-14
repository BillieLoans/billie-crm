"""help@ mailbox connector: parsing + contact resolution + interaction logging."""

from unittest.mock import AsyncMock, patch

from billie_servicing.help_mailbox import parse_help_email, process_help_email


def _raw(
    from_hdr="Rohan Sharp <Rohan@Billie.LOANS>",
    subject="Trouble with my repayment",
    body="Hi team,\r\nSomething went wrong.\r\n",
    message_id="<abc123@mail.example>",
    date="Tue, 14 Jul 2026 10:00:00 +1000",
):
    headers = [f"From: {from_hdr}", f"Subject: {subject}"]
    if message_id:
        headers.append(f"Message-ID: {message_id}")
    if date:
        headers.append(f"Date: {date}")
    headers.append('Content-Type: text/plain; charset="utf-8"')
    return ("\r\n".join(headers) + "\r\n\r\n" + body).encode()


class FakePool:
    def __init__(self, contact_id):
        self._contact_id = contact_id
        self.queries = []

    async def fetchval(self, sql, *args):
        self.queries.append((sql, args))
        return self._contact_id


def test_parse_extracts_normalised_sender_subject_body_and_utc_date():
    parsed = parse_help_email(_raw())
    assert parsed.from_addr == "rohan@billie.loans"  # lowercased
    assert parsed.subject == "Trouble with my repayment"
    assert parsed.body.startswith("Hi team,")
    assert parsed.message_id == "<abc123@mail.example>"
    assert parsed.occurred_at == "2026-07-14T00:00:00+00:00"  # AEST -> UTC


def test_parse_without_message_id_or_date_still_yields_stable_key():
    raw = _raw(message_id=None, date=None)
    a, b = parse_help_email(raw), parse_help_email(raw)
    assert a.message_id and a.message_id == b.message_id  # content hash, stable
    assert a.occurred_at == ""


def test_parse_rejects_missing_sender():
    assert parse_help_email(b"Subject: no sender\r\n\r\nhello") is None


async def test_process_logs_inbound_interaction_for_matching_contact():
    pool = FakePool("c-1")
    with patch(
        "billie_servicing.help_mailbox.marketing_client.log_interaction",
        AsyncMock(return_value="ev-1"),
    ) as log:
        status = await process_help_email(pool, _raw())

    assert status == "logged"
    # Resolution excludes erased and merged records
    sql, args = pool.queries[0]
    assert "erased IS NOT TRUE" in sql and "merged_into IS NULL" in sql
    assert args == ("rohan@billie.loans",)

    kwargs = log.call_args.kwargs
    assert kwargs["contact_id"] == "c-1"
    assert kwargs["kind"] == "message_in"
    assert kwargs["channel"] == "email"
    assert kwargs["direction"] == "inbound"
    assert kwargs["source_system"] == "help_mailbox"
    assert kwargs["idempotency_key"].startswith("helpmail:")


async def test_process_skips_unknown_sender_without_logging():
    pool = FakePool(None)
    with patch(
        "billie_servicing.help_mailbox.marketing_client.log_interaction",
        AsyncMock(),
    ) as log:
        status = await process_help_email(pool, _raw())
    assert status == "no_contact"
    log.assert_not_awaited()
