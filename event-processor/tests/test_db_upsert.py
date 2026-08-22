"""db.upsert: optional DO UPDATE … WHERE guard and the command-tag return value."""

from __future__ import annotations

from billie_servicing.db import upsert

GUARD = (
    "COALESCE(customers.reapplication_block_state_version, 0) "
    "< EXCLUDED.reapplication_block_state_version"
)


async def test_update_where_is_appended_to_do_update(mock_pool):
    await upsert(
        mock_pool,
        "customers",
        conflict_columns=["customer_id"],
        values={"customer_id": "A", "reapplication_block_state_version": 7},
        update_where=GUARD,
    )
    sql = mock_pool.calls_against("customers")[-1].sql
    assert sql.endswith(
        "DO UPDATE SET reapplication_block_state_version = "
        f"EXCLUDED.reapplication_block_state_version WHERE {GUARD}"
    )


async def test_no_update_where_leaves_sql_unchanged(mock_pool):
    await upsert(
        mock_pool,
        "customers",
        conflict_columns=["customer_id"],
        values={"customer_id": "A", "x": 1},
    )
    sql = mock_pool.calls_against("customers")[-1].sql
    assert sql.endswith("DO UPDATE SET x = EXCLUDED.x")
    assert " WHERE " not in sql


async def test_update_where_ignored_with_do_nothing(mock_pool):
    await upsert(
        mock_pool, "t", conflict_columns=["id"], values={"id": 1},
        do_nothing_on_conflict=True, update_where="1 = 0",
    )
    assert mock_pool.calls[-1].sql.endswith("DO NOTHING")


async def test_returns_command_tag(mock_pool):
    tag = await upsert(mock_pool, "t", conflict_columns=["id"], values={"id": 1, "x": 2})
    assert tag == "INSERT 0 1"
