"""``db.merge_jsonb_entry`` — per-key merge into an object-of-objects jsonb
column (identity verification attempts, spec 2026-09-15)."""

from __future__ import annotations

import json

import pytest

from billie_servicing.db import merge_jsonb_entry


@pytest.mark.asyncio
async def test_merges_into_the_entry_not_over_it(mock_pool):
    await merge_jsonb_entry(
        mock_pool,
        "conversations",
        column="identity_verification_attempts",
        key_column="conversation_id",
        key_value="conv-1",
        entry_key="60000650",
        patch={"attempt_number": 1},
        bump_version=True,
    )
    call = mock_pool.calls[-1]
    assert "jsonb_set(COALESCE(identity_verification_attempts, '{}'::jsonb)" in call.sql
    assert "COALESCE(identity_verification_attempts -> $1, '{}'::jsonb) || $2::jsonb" in call.sql
    assert "version = COALESCE(version, 1) + 1" in call.sql
    assert call.args[0] == "60000650"
    assert json.loads(call.args[1]) == {"attempt_number": 1}
    assert call.args[2] == "conv-1"


@pytest.mark.asyncio
async def test_no_version_bump_by_default(mock_pool):
    await merge_jsonb_entry(
        mock_pool,
        "conversations",
        column="identity_verification_attempts",
        key_column="conversation_id",
        key_value="conv-1",
        entry_key="attempt-1",
        patch={},
    )
    assert "version" not in mock_pool.calls[-1].sql
