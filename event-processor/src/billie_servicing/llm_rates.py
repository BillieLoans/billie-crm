"""Versioned LLM rate table + genuine-cost recomputation (BTB-302).

Ported from billieChat ``backend/tools/llm_cost/llm_cost_report.py`` (the
BTB-301 one-off, verified against prod). Rates are USD per token, sourced
from litellm's ``model_prices_and_context_window.json`` cross-checked
against OpenAI's published GPT-5.6 rate card.

Semantics:
- ``prompt_tokens`` INCLUDES cached tokens → uncached = prompt − cached.
- Cached input bills at the cache-read rate.
- Priority tier is 2× standard; the logged ``service_tier`` beats the
  agent-name derivation (which is only a config-file inference).
- Rates step up above the 272k-input-token long-context threshold.

RATE VERSIONING (the design decision that matters): every projected row
stores tokens AND both costs AND ``RATE_VERSION``, so historical figures
never silently restate when rates change (Sol is on promotional pricing
through 21 Nov 2026) and re-pricing after a correction stays possible.
When rates change: append here, bump ``RATE_VERSION`` with the new
``effective_from``, and keep the table in sync with billieChat's
``config.prod.json`` model roster. A model missing from the table is
returned as UNPRICED — never silently costed at zero (the exact failure
mode BTB-301 exists to catch).
"""

from __future__ import annotations

#: Bump on every rate change; stamped onto each projected row.
RATE_VERSION = "2026-08-26.litellm+openai-gpt5.6"

#: Effective window of the current table (informational; the per-row stamp
#: is what makes history trustworthy).
RATE_EFFECTIVE_FROM = "2026-08-01"

LONG_CTX_THRESHOLD = 272_000

RATES: dict[str, dict[str, float]] = {
    "gpt-5.6-luna": {
        "in": 2e-07, "cached": 2e-08, "out": 1.2e-06,
        "in_pri": 4e-07, "cached_pri": 4e-08, "out_pri": 2.4e-06,
        "in_long": 4e-07, "cached_long": 4e-08, "out_long": 1.8e-06,
    },
    "gpt-5.6-terra": {
        "in": 2e-06, "cached": 2e-07, "out": 1.2e-05,
        "in_pri": 4e-06, "cached_pri": 4e-07, "out_pri": 2.4e-05,
        "in_long": 4e-06, "cached_long": 4e-07, "out_long": 1.8e-05,
    },
    "gpt-5.4": {
        "in": 2.5e-06, "cached": 2.5e-07, "out": 1.5e-05,
        "in_pri": 5e-06, "cached_pri": 5e-07, "out_pri": 3e-05,
        "in_long": 5e-06, "cached_long": 5e-07, "out_long": 2.25e-05,
    },
}

#: billieChat config.prod.json → llm_service_tier_overrides (priority = 2×).
PRIORITY_AGENTS = {"contractAgent", "customerLiaisonAgent"}


def recompute_cost(
    model: str,
    agent_name: str,
    prompt_tokens: int,
    completion_tokens: int,
    cached_tokens: int,
    service_tier: str = "",
) -> tuple[float, bool]:
    """Genuine cost from token counts × published rates → (cost, priced?)."""
    rate = RATES.get(model)
    if rate is None:  # dated snapshot names, e.g. "gpt-5.6-luna-2026-01-01"
        for known, table in RATES.items():
            if model.startswith(known):
                rate = table
                break
    if rate is None:
        return 0.0, False

    tier = (service_tier or "").strip().lower()
    if tier == "priority":
        priority = True
    elif tier in ("standard", "default", "auto", "flex", "scale"):
        priority = False
    else:
        priority = agent_name in PRIORITY_AGENTS

    if prompt_tokens > LONG_CTX_THRESHOLD:
        i, c, o = rate["in_long"], rate["cached_long"], rate["out_long"]
    elif priority:
        i, c, o = rate["in_pri"], rate["cached_pri"], rate["out_pri"]
    else:
        i, c, o = rate["in"], rate["cached"], rate["out"]

    cached = max(0, min(cached_tokens, prompt_tokens))
    uncached = prompt_tokens - cached
    return uncached * i + cached * c + completion_tokens * o, True
