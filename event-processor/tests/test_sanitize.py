"""
Tests for sanitization utilities and their integration with event handlers.

Covers:
- safe_str() input validation (H5: NoSQL injection prevention)
- strip_dollar_keys() MongoDB operator stripping
- Integration with conversation and writeoff handlers
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from billie_servicing.handlers.sanitize import safe_str, strip_dollar_keys
from billie_servicing.handlers.conversation import (
    handle_conversation_started,
    handle_utterance,
    handle_final_decision,
)
from billie_servicing.handlers.writeoff import handle_writeoff_approved


class TestSafeStr:
    """Tests for safe_str() utility function."""

    def test_returns_string_for_valid_string_input(self):
        """H5: Should return the same string for valid string input."""
        assert safe_str("hello", "field") == "hello"

    def test_returns_empty_string_for_none(self):
        """H5: Should return empty string for None input."""
        assert safe_str(None, "field") == ""

    def test_converts_integer_to_string(self):
        """H5: Should convert integer values to their string representation."""
        assert safe_str(42, "field") == "42"

    def test_raises_for_dict_input(self):
        """H5: Should reject dict values (NoSQL injection attempt like {"$ne": null})."""
        with pytest.raises(ValueError, match="field_name"):
            safe_str({"$ne": None}, "field_name")

    def test_raises_for_list_input(self):
        """H5: Should reject list values."""
        with pytest.raises(ValueError, match="tags"):
            safe_str(["a", "b"], "tags")

    def test_raises_for_nested_dict_input(self):
        """H5: Should reject nested dict values (e.g., {"$gt": ""})."""
        with pytest.raises(ValueError, match="query_field"):
            safe_str({"$gt": ""}, "query_field")

    def test_includes_field_name_in_error_message(self):
        """H5: Error message should include the field name for debugging."""
        with pytest.raises(ValueError, match="conversation_id"):
            safe_str({"$ne": None}, "conversation_id")


class TestStripDollarKeys:
    """Tests for strip_dollar_keys() utility function."""

    def test_returns_dict_unchanged_when_no_dollar_keys(self):
        """H5: Should return dict as-is when no dollar-prefixed keys exist."""
        data = {"name": "John", "age": 30}
        result = strip_dollar_keys(data)
        assert result == {"name": "John", "age": 30}

    def test_strips_keys_starting_with_dollar(self):
        """H5: Should remove keys starting with '$' (e.g., $set, $ne)."""
        data = {"name": "John", "$set": {"role": "admin"}, "$ne": None}
        result = strip_dollar_keys(data)
        assert result == {"name": "John"}

    def test_preserves_non_dollar_keys(self):
        """H5: Should keep all keys that do not start with '$'."""
        data = {"status": "active", "$unset": True, "count": 5}
        result = strip_dollar_keys(data)
        assert result == {"status": "active", "count": 5}

    def test_handles_empty_dict(self):
        """H5: Should return empty dict for empty input."""
        assert strip_dollar_keys({}) == {}

    def test_handles_dict_with_only_dollar_keys(self):
        """H5: Should return empty dict when all keys are dollar-prefixed."""
        data = {"$set": 1, "$ne": None, "$gt": ""}
        result = strip_dollar_keys(data)
        assert result == {}


class TestConversationHandlerSanitization:
    """Integration tests: conversation handlers reject NoSQL injection payloads."""

    @pytest.mark.asyncio
    async def test_conversation_started_rejects_nosql_injection(self, mock_db):
        """H5: Should reject events with dict values in query fields."""
        malicious_event = {
            "typ": "conversation_started",
            "cid": {"$ne": None},  # NoSQL injection attempt
            "usr": "CUS-001",
        }
        with pytest.raises(ValueError, match="conversation_id"):
            await handle_conversation_started(mock_db, malicious_event)

    @pytest.mark.asyncio
    async def test_utterance_rejects_nosql_injection(self, mock_db):
        """H5: Should reject events with dict values in query fields."""
        malicious_event = {
            "typ": "user_input",
            "cid": {"$ne": None},  # NoSQL injection attempt
            "payload": {"utterance": "hello"},
        }
        with pytest.raises(ValueError, match="conversation_id"):
            await handle_utterance(mock_db, malicious_event)

    @pytest.mark.asyncio
    async def test_final_decision_rejects_nosql_injection(self, mock_db):
        """H5: Should reject events with dict values in query fields."""
        malicious_event = {
            "typ": "final_decision",
            "cid": {"$ne": None},  # NoSQL injection attempt
            "decision": "APPROVED",
        }
        with pytest.raises(ValueError, match="conversation_id"):
            await handle_final_decision(mock_db, malicious_event)

    @pytest.mark.asyncio
    async def test_conversation_started_accepts_valid_string_cid(self, mock_db):
        """H5: Should accept events with valid string cid values."""
        valid_event = {
            "typ": "conversation_started",
            "cid": "CONV-001",
            "usr": "CUS-001",
        }
        # Should not raise - handler completes successfully
        await handle_conversation_started(mock_db, valid_event)

        # Verify conversation was upserted
        mock_db.conversations.update_one.assert_called_once()


class TestWriteoffHandlerSanitization:
    """Integration tests: writeoff handlers reject NoSQL injection payloads."""

    @pytest.mark.asyncio
    async def test_writeoff_approved_rejects_nosql_injection(self, mock_db):
        """H5: Should reject events with dict values in query fields."""
        malicious_event = {
            "typ": "writeoff.approved.v1",
            "conv": {"$ne": None},  # NoSQL injection attempt
            "cause": "evt-123",
            "payload": "{}",
        }
        with pytest.raises(ValueError, match="request_id"):
            await handle_writeoff_approved(mock_db, malicious_event)
