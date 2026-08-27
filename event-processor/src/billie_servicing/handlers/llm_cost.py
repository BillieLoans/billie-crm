"""llm_logs → llm_costs projection handler (BTB-302).

Projection, not a copy: only numeric fields and ids land in the CRM cost
store. ``system_prompt``, ``non_system_context``, ``llm_response_text``,
``response_format`` and ``tools`` are never read past this module's
allowlist — no customer PII in the cost store.

Idempotency: rows are keyed by the llm_logs stream id with
``ON CONFLICT DO NOTHING``; the per-conversation rollup increments only
when the row actually inserted, so at-least-once redelivery can never
double-count.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import structlog

from ..db import upsert
from ..llm_rates import RATE_VERSION, recompute_cost

logger = structlog.get_logger()


def _num(value: Any, cast=int, default=0):
    try:
        return cast(value)
    except (TypeError, ValueError):
        return default


async def handle_llm_log(pool: Any, stream_id: str, fields: dict[str, Any]) -> None:
    """Project one llm_logs stream entry into ``llm_costs`` (+ rollup)."""
    model = str(fields.get("model") or "unknown")
    agent_name = str(fields.get("agent_name") or "")
    conversation_id = fields.get("conversation_id") or None

    prompt_tokens = _num(fields.get("prompt_tokens"))
    completion_tokens = _num(fields.get("completion_tokens"))
    cached_tokens = _num(fields.get("cached_tokens"))
    reasoning_tokens = _num(fields.get("reasoning_tokens"))
    total_tokens = _num(fields.get("total_tokens"))
    service_tier = str(fields.get("service_tier") or "")
    logged_cost = _num(fields.get("llm_cost"), cast=float, default=0.0)

    computed_cost, priced = recompute_cost(
        model,
        agent_name,
        prompt_tokens,
        completion_tokens,
        cached_tokens,
        service_tier=service_tier,
    )

    # Stream ids are "<ms>-<seq>" — the ms half is the call timestamp.
    try:
        called_at = datetime.fromtimestamp(
            int(stream_id.split("-")[0]) / 1000, tz=timezone.utc
        )
    except (ValueError, IndexError):
        called_at = datetime.now(timezone.utc)

    now = datetime.now(timezone.utc)
    tag = await upsert(
        pool,
        "llm_costs",
        conflict_columns=["stream_id"],
        do_nothing_on_conflict=True,
        values={
            "stream_id": stream_id,
            "conversation_id": conversation_id,
            "seq": _num(fields.get("seq"), default=None),
            "model": model,
            "agent_name": agent_name,
            "service_tier": service_tier,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "cached_tokens": cached_tokens,
            "reasoning_tokens": reasoning_tokens,
            "total_tokens": total_tokens,
            "response_time_ms": _num(fields.get("response_time_ms")),
            "logged_cost_usd": logged_cost,
            "computed_cost_usd": computed_cost,
            "rate_version": RATE_VERSION,
            "priced": priced,
            "called_at": called_at,
            "updated_at": now,
            "created_at": now,
        },
    )

    inserted = isinstance(tag, str) and tag.endswith(" 1")
    if not inserted:
        logger.debug("llm_costs row already projected", stream_id=stream_id)
        return

    if not priced:
        logger.warning(
            "Unpriced model in llm_logs — rate table needs updating",
            model=model,
            stream_id=stream_id,
        )

    if conversation_id:
        # Incremental rollup: cost per application surfaces directly on the
        # conversation record (joined to application/customer in the CRM).
        await pool.execute(
            "UPDATE conversations SET "
            "llm_cost_total_usd = COALESCE(llm_cost_total_usd, 0) + $2, "
            "llm_call_count = COALESCE(llm_call_count, 0) + 1, "
            "llm_unpriced_count = COALESCE(llm_unpriced_count, 0) + $3, "
            "updated_at = $4 "
            "WHERE conversation_id = $1",
            conversation_id,
            computed_cost if priced else 0.0,
            0 if priced else 1,
            now,
        )
