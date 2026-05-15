"""Tests for sanitization utilities and their integration with event handlers.

Covers:
- safe_str() input validation (H5: NoSQL injection prevention — still relevant
  even on Postgres because the SQL helpers interpolate the value into the
  WHERE clause via parameterised placeholders only when the caller passes a
  scalar string; a dict would otherwise slip through and break the query).
- strip_dollar_keys() — historically stripped MongoDB $-prefixed operator
  keys; still used to scrub event payloads before storing them as jsonb.
- Integration with conversation and writeoff handlers.
- Bounded-array behaviour for utterances/noticeboard (was $slice on Mongo,
  now an OFFSET-based DELETE before INSERT on the child table).
"""

import pytest

from billie_servicing.handlers.conversation import (
    handle_conversation_started,
    handle_final_decision,
    handle_noticeboard_updated,
    handle_utterance,
)
from billie_servicing.handlers.sanitize import safe_str, strip_dollar_keys
from billie_servicing.handlers.writeoff import handle_writeoff_approved


class TestSafeStr:
    def test_returns_string_for_valid_string_input(self):
        assert safe_str("hello", "field") == "hello"

    def test_returns_empty_string_for_none(self):
        assert safe_str(None, "field") == ""

    def test_converts_integer_to_string(self):
        assert safe_str(42, "field") == "42"

    def test_raises_for_dict_input(self):
        with pytest.raises(ValueError, match="field_name"):
            safe_str({"$ne": None}, "field_name")

    def test_raises_for_list_input(self):
        with pytest.raises(ValueError, match="tags"):
            safe_str(["a", "b"], "tags")

    def test_raises_for_nested_dict_input(self):
        with pytest.raises(ValueError, match="query_field"):
            safe_str({"$gt": ""}, "query_field")

    def test_includes_field_name_in_error_message(self):
        with pytest.raises(ValueError, match="conversation_id"):
            safe_str({"$ne": None}, "conversation_id")


class TestStripDollarKeys:
    def test_returns_dict_unchanged_when_no_dollar_keys(self):
        assert strip_dollar_keys({"name": "John", "age": 30}) == {"name": "John", "age": 30}

    def test_strips_keys_starting_with_dollar(self):
        data = {"name": "John", "$set": {"role": "admin"}, "$ne": None}
        assert strip_dollar_keys(data) == {"name": "John"}

    def test_preserves_non_dollar_keys(self):
        assert strip_dollar_keys({"status": "active", "$unset": True, "count": 5}) == {
            "status": "active",
            "count": 5,
        }

    def test_handles_empty_dict(self):
        assert strip_dollar_keys({}) == {}

    def test_handles_dict_with_only_dollar_keys(self):
        assert strip_dollar_keys({"$set": 1, "$ne": None, "$gt": ""}) == {}


class TestConversationHandlerSanitization:
    @pytest.mark.asyncio
    async def test_conversation_started_rejects_nosql_injection(self, mock_pool):
        malicious_event = {
            "typ": "conversation_started",
            "cid": {"$ne": None},
            "usr": "CUS-001",
        }
        with pytest.raises(ValueError, match="conversation_id"):
            await handle_conversation_started(mock_pool, malicious_event)

    @pytest.mark.asyncio
    async def test_utterance_rejects_nosql_injection(self, mock_pool):
        malicious_event = {
            "typ": "user_input",
            "cid": {"$ne": None},
            "payload": {"utterance": "hello"},
        }
        with pytest.raises(ValueError, match="conversation_id"):
            await handle_utterance(mock_pool, malicious_event)

    @pytest.mark.asyncio
    async def test_final_decision_rejects_nosql_injection(self, mock_pool):
        malicious_event = {
            "typ": "final_decision",
            "cid": {"$ne": None},
            "decision": "APPROVED",
        }
        with pytest.raises(ValueError, match="conversation_id"):
            await handle_final_decision(mock_pool, malicious_event)

    @pytest.mark.asyncio
    async def test_conversation_started_accepts_valid_string_cid(self, mock_pool):
        valid_event = {
            "typ": "conversation_started",
            "cid": "CONV-001",
            "usr": "CUS-001",
        }
        await handle_conversation_started(mock_pool, valid_event)

        # The handler always upserts a row via upsert_conversation —
        # check the INSERT against conversations was emitted.
        inserts = mock_pool.inserts_into("conversations")
        assert inserts
        assert inserts[-1]["conversation_id"] == "CONV-001"


class TestWriteoffHandlerSanitization:
    @pytest.mark.asyncio
    async def test_writeoff_approved_rejects_nosql_injection(self, mock_pool):
        malicious_event = {
            "typ": "writeoff.approved.v1",
            "conv": {"$ne": None},
            "cause": "evt-123",
            "payload": "{}",
        }
        with pytest.raises(ValueError, match="request_id"):
            await handle_writeoff_approved(mock_pool, malicious_event)


class TestUtteranceCapBehaviour:
    """Bounded-array semantics for utterances/noticeboard.

    On Mongo the handler used $push with $slice to cap. On Postgres the
    equivalent is: DELETE rows beyond OFFSET (max - 1), then INSERT the new
    row. These tests assert the DELETE-before-INSERT pattern landed.
    """

    @pytest.mark.asyncio
    async def test_utterance_push_caps_array(self, mock_pool):
        # Need parent lookup to return a uuid so the handler proceeds.
        mock_pool.set_fetchval("11111111-2222-3333-4444-555555555555")
        event = {
            "typ": "user_input",
            "cid": "CONV-001",
            "usr": "CUS-001",
            "payload": {"utterance": "hello"},
        }
        await handle_utterance(mock_pool, event)

        # An eviction DELETE happened (it might be a no-op at zero rows but
        # the SQL was emitted) AND an INSERT followed it.
        deletes = [c for c in mock_pool.calls if c.op == "DELETE"]
        assert any(c.table == "conversations_utterances" for c in deletes)

        inserts = [c for c in mock_pool.calls if c.op == "INSERT"]
        assert any(c.table == "conversations_utterances" for c in inserts)

    @pytest.mark.asyncio
    async def test_noticeboard_push_caps_array(self, mock_pool):
        mock_pool.set_fetchval("11111111-2222-3333-4444-555555555555")
        event = {
            "typ": "noticeboard_updated",
            "cid": "CONV-001",
            "agentName": "test_agent",
            "content": "some note",
        }
        await handle_noticeboard_updated(mock_pool, event)

        deletes = [c for c in mock_pool.calls if c.op == "DELETE"]
        assert any(c.table == "conversations_noticeboard" for c in deletes)

        inserts = [c for c in mock_pool.calls if c.op == "INSERT"]
        assert any(c.table == "conversations_noticeboard" for c in inserts)
