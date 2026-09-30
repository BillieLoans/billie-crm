"""BTB-392 (SP4 Task 7): scripts/unlink_identity_alias.py reverses a link in
the CRM projection (reconciliation runbook Step 4b)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).parent.parent / "scripts" / "unlink_identity_alias.py"
_spec = importlib.util.spec_from_file_location("unlink_identity_alias", _SCRIPT)
unlink = importlib.util.module_from_spec(_spec)
# Registered before exec so the script's dataclasses (postponed annotations)
# can resolve their module at class-creation time.
sys.modules["unlink_identity_alias"] = unlink
_spec.loader.exec_module(unlink)


def _plan(rows=None):
    return unlink.UnlinkPlan(alias_id="B", canonical_id="A", rows=rows or {})


def _updates(mock_pool, table):
    return [c for c in mock_pool.calls_against(table) if c.op == "UPDATE"]


@pytest.mark.asyncio
async def test_dry_run_counts_issue_no_update(mock_pool):
    mock_pool.set_fetchval(2)

    counts = await unlink.count_candidates(mock_pool.connection, _plan())

    assert counts == {"conversations": 2, "loan_accounts": 2, "applications": 2}
    assert not any(c.op == "UPDATE" for c in mock_pool.calls)


@pytest.mark.asyncio
async def test_apply_moves_origin_tagged_rows_back_and_clears_the_tombstone(mock_pool):
    # fetchval: alias ref, canonical ref
    mock_pool.set_fetchval_sequence(["b-ref", "a-ref"])

    result = await unlink.apply_unlink(mock_pool.connection, _plan())

    for table in ("conversations", "loan_accounts"):
        upd = _updates(mock_pool, table)[-1]
        assert upd.values["customer_id_string"] == "B"
        assert upd.values["customer_id_id"] == "b-ref"
        assert "identity_origin_customer_id = NULL" in upd.sql
        # The WHERE has an OR group, which MockPool's comma-split parser cannot
        # map into `where`; assert on the SQL text and the bound args instead.
        assert "WHERE customer_id_string = $3" in upd.sql
        assert upd.args[2] == "A"
        assert "identity_origin_customer_id = $1" in upd.sql  # origin = alias
    appl = _updates(mock_pool, "applications")[-1]
    assert appl.values["customer_id_id"] == "b-ref"
    assert "WHERE customer_id_id = $2" in appl.sql
    assert appl.args[1] == "a-ref"
    cust = _updates(mock_pool, "customers")[-1]
    assert "merged_into = NULL" in cust.sql
    assert "merged_link_id = NULL" in cust.sql
    assert "WHERE customer_id = $1 AND merged_into = $2" in cust.sql
    assert cust.args == ("B", "A")  # only a tombstone pointing at A
    # Row counts come from asyncpg's status string; MockConnection's stub
    # status is not a real count, so only the shape is asserted here.
    assert set(result.moved) == {"conversations", "loan_accounts", "applications"}
    assert all(isinstance(n, int) for n in result.moved.values())
    assert isinstance(result.tombstone_cleared, bool)


@pytest.mark.asyncio
async def test_rows_csv_moves_listed_rows_without_an_origin_id(mock_pool, tmp_path):
    csv_path = tmp_path / "rows.csv"
    csv_path.write_text(
        "# table,key_column,key_value\n"
        "conversations,conversation_id,conv-1\n"
        "loan_accounts,loan_account_id,LA-9\n"
        "applications,application_number,APP-7\n"
    )
    rows = unlink.read_rows_csv(str(csv_path))
    assert rows == {
        "conversations": ["conv-1"],
        "loan_accounts": ["LA-9"],
        "applications": ["APP-7"],
    }
    mock_pool.set_fetchval_sequence(["b-ref", "a-ref"])

    await unlink.apply_unlink(mock_pool.connection, _plan(rows))

    conv = _updates(mock_pool, "conversations")[-1]
    assert "conversation_id = ANY($4::text[])" in conv.sql
    assert conv.args[3] == ["conv-1"]
    appl = _updates(mock_pool, "applications")[-1]
    assert appl.args[3] == ["APP-7"]


def test_rows_csv_rejects_unknown_table_or_key(tmp_path):
    bad = tmp_path / "bad.csv"
    bad.write_text("customers,customer_id,B\n")
    with pytest.raises(SystemExit):
        unlink.read_rows_csv(str(bad))


@pytest.mark.asyncio
async def test_apply_without_a_canonical_row_leaves_applications_alone(mock_pool):
    mock_pool.set_fetchval_sequence(["b-ref", None])

    result = await unlink.apply_unlink(mock_pool.connection, _plan())

    assert not _updates(mock_pool, "applications")
    assert result.moved["applications"] == 0


def test_rowcount_parses_asyncpg_status():
    assert unlink._rowcount("UPDATE 3") == 3
    assert unlink._rowcount(None) == 0
