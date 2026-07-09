# Fraud Alerting — Part B (billie-crm ingestion + display + alert) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In billie-crm, ingest `fraud_risk.assessment.v1` / `fraud_risk.halt.v1`, persist them, show a read-only fraud panel on the application view, and raise a customer-level fraud chip in the existing AttentionStrip alert framework.

**Architecture:** billie-crm is two processes over one Postgres. The **Python event-processor** (`event-processor/`) consumes `inbox:billie-servicing` (where the fraud events already arrive, currently dropped) and writes Postgres; two new handlers persist the fraud data. The **Payload CMS / Next.js** app (`src/`) reads Postgres and renders the staff UI; changes there add the display + alert. The `conversations.assessments_fraud_check` JSONB column **already exists** (no migration for the panel); a small `customers.fraudRisk` group + migration backs the customer chip.

**Tech Stack:** Python 3.11 (asyncpg, structlog, pytest, ruff, mypy); TypeScript / Payload 3 / Next 16 / React 19 (pnpm, Vitest, Prettier).

**Spec:** `docs/superpowers/specs/2026-07-09-fraud-alerting-slack-crm-design.md` (Part B). **This plan runs in `/Users/rohansharp/workspace/billie-crm`**, on its own branch/PR — independent of billieChat (Part A).

## Global Constraints

- **Repo:** `/Users/rohansharp/workspace/billie-crm`. Python side under `event-processor/`; TS side under `src/`.
- **Fraud events arrive as a raw dict envelope** (no typed SDK branch). In handlers: `payload = parse_payload(event)`; `conversation_id = event.get("cid") or event.get("conv") or payload.get("conversation_id")`; `customer_id = event.get("usr")`. Never use attribute access (`event.payload`).
- **Keys:** `conversations` is keyed on `conversation_id` (reliable — `application_number` is often empty early). `customers` is keyed on `customer_id`.
- **JSONB writes need `json.dumps`** (asyncpg has no dict→jsonb codec) — mirror `_set_assessment`.
- **`conversations.assessments_fraud_check` already exists** (column + Payload field). No migration needed for the application-panel data.
- **Payload collections are read-only projections** — only the Python processor writes them (`create/update/delete: () => false`). Group fields flatten camelCase→snake_case (`fraudRisk.score` → `fraud_risk_score`).
- **After any collection change:** `pnpm generate:types` (and `pnpm generate:importmap` only if a component is registered — not needed here).
- **Python tests:** run from `event-processor/`: `pytest`, `ruff check src tests`, `mypy src` (strict, py311, line-length 100). MockPool fixture (`mock_pool`) — no real DB.
- **TS checks:** `pnpm typecheck` (tsc), `pnpm lint` (eslint), `pnpm build`. Vitest (`pnpm exec vitest run <file> --config ./vitest.config.mts`) spins a **Postgres testcontainer via globalSetup — needs Docker**; if Docker is unavailable, rely on typecheck+lint+build and note the vitest run as pending.
- **Prettier (TS):** single quotes, **no semicolons**, trailing commas everywhere, 100-col width.
- **Assessment persistence policy:** skip LOW (benign); persist MEDIUM+ into `assessments_fraud_check` (latest wins, matching how other assessments overwrite). The customer chip is driven by `fraud_risk.halt.v1` (HIGH/CRITICAL).

---

### Task 1: Python fraud handlers (event-processor)

**Files:**
- Create: `event-processor/src/billie_servicing/handlers/fraud.py`
- Modify: `event-processor/src/billie_servicing/handlers/conversation.py` (add `_ASSESSMENT_COLUMNS["fraudCheck"]`)
- Modify: `event-processor/src/billie_servicing/handlers/__init__.py` (export)
- Modify: `event-processor/src/billie_servicing/main.py` (import + register)
- Test: `event-processor/tests/test_fraud_risk.py`

**Interfaces:**
- Produces: `async handle_fraud_risk_assessment(pool, event)` and `async handle_fraud_risk_halt(pool, event)`.

- [ ] **Step 1: Add the fraudCheck column mapping**

In `event-processor/src/billie_servicing/handlers/conversation.py`, add one entry to `_ASSESSMENT_COLUMNS` (around line 35-41):

```python
_ASSESSMENT_COLUMNS = {
    "identityRisk": "assessments_identity_risk",
    "serviceability": "assessments_serviceability",
    "accountConduct": "assessments_account_conduct",
    "postIdentityRisk": "assessments_post_identity_risk",
    "creditAssessmentComplete": "assessments_credit_assessment_complete",
    "fraudCheck": "assessments_fraud_check",
}
```

- [ ] **Step 2: Write the failing tests**

Create `event-processor/tests/test_fraud_risk.py`:

```python
"""Tests for the fraud_risk.* handlers."""
import pytest

from billie_servicing.handlers.fraud import (
    handle_fraud_risk_assessment,
    handle_fraud_risk_halt,
)

CONV = "7d5ee9c2-dd6b-4091-8a3a-6c148a4c4142"

ASSESSMENT_PAYLOAD = {
    "conversation_id": CONV,
    "application_number": "",
    "final_score": 70,
    "severity": "HIGH",
    "categories": ["PROMPT_INJECTION"],
    "rationale": "asked to ignore instructions",
    "signals": ["ignore all previous"],
    "would_halt": True,
    "mode": "shadow",
}

HALT_PAYLOAD = dict(ASSESSMENT_PAYLOAD)


class TestFraudRiskAssessment:
    @pytest.mark.asyncio
    async def test_medium_plus_writes_fraud_check(self, mock_pool):
        event = {"typ": "fraud_risk.assessment.v1", "usr": "CUST1", "conv": CONV,
                 "payload": dict(ASSESSMENT_PAYLOAD)}
        await handle_fraud_risk_assessment(mock_pool, event)
        updates = [c for c in mock_pool.calls_against("conversations")
                   if c.op == "UPDATE" and "assessments_fraud_check" in c.values]
        assert updates, "expected an assessments_fraud_check UPDATE"

    @pytest.mark.asyncio
    async def test_low_is_skipped(self, mock_pool):
        low = dict(ASSESSMENT_PAYLOAD, severity="LOW", final_score=5)
        event = {"typ": "fraud_risk.assessment.v1", "usr": "CUST1", "conv": CONV,
                 "payload": low}
        await handle_fraud_risk_assessment(mock_pool, event)
        updates = [c for c in mock_pool.calls_against("conversations")
                   if "assessments_fraud_check" in (c.values or {})]
        assert not updates, "LOW severity must not be persisted"


class TestFraudRiskHalt:
    @pytest.mark.asyncio
    async def test_sets_customer_fraud_risk_active(self, mock_pool):
        event = {"typ": "fraud_risk.halt.v1", "usr": "CUST1", "conv": CONV,
                 "payload": dict(HALT_PAYLOAD)}
        await handle_fraud_risk_halt(mock_pool, event)
        doc = mock_pool.last_upsert("customers")
        assert doc is not None
        assert doc["customer_id"] == "CUST1"
        assert doc["fraud_risk_active"] is True
        assert doc["fraud_risk_severity"] == "HIGH"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/rohansharp/workspace/billie-crm/event-processor && python -m pytest tests/test_fraud_risk.py -v`
Expected: FAIL — `ModuleNotFoundError: billie_servicing.handlers.fraud`.

- [ ] **Step 4: Write the handlers**

Create `event-processor/src/billie_servicing/handlers/fraud.py`:

```python
"""Handlers for fraud_risk.* events emitted by the billieChat FraudRiskAgent."""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog

from ..db import coerce_date, upsert
from .conversation import _ASSESSMENT_COLUMNS, _set_assessment
from .identity import resolve_canonical_customer_id
from .sanitize import parse_payload, safe_str, strip_dollar_keys

logger = structlog.get_logger()

_MEDIUM_PLUS = {"MEDIUM", "HIGH", "CRITICAL"}


async def handle_fraud_risk_assessment(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Persist a MEDIUM+ fraud assessment onto the conversation's fraudCheck slot.

    LOW (benign) assessments are skipped. The latest MEDIUM+ assessment wins,
    matching how the other assessment columns overwrite.
    """
    payload = parse_payload(event)
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or payload.get("conversation_id"),
        "conversation_id",
    )
    severity = str(payload.get("severity", "")).upper()
    log = logger.bind(conversation_id=conversation_id, severity=severity)

    if severity not in _MEDIUM_PLUS:
        log.info("fraud_risk.assessment.v1 below MEDIUM — skipping")
        return
    if not conversation_id:
        log.warning("fraud_risk.assessment.v1 without conversation id — skipping")
        return

    data = strip_dollar_keys(payload)
    await _set_assessment(pool, conversation_id, _ASSESSMENT_COLUMNS["fraudCheck"], data)
    log.info("fraud check assessment persisted")


async def handle_fraud_risk_halt(pool: asyncpg.Pool, event: dict[str, Any]) -> None:
    """Raise the customer-level fraud alert from a HIGH/CRITICAL fraud_risk.halt.v1.

    Mirrors the reapplication-block customer mirror: resolve the canonical customer
    id and upsert the fraud_risk_* fields that drive the AttentionStrip chip.
    """
    payload = parse_payload(event)
    severity = str(payload.get("severity", "")).upper()
    categories = payload.get("categories") or []
    score = payload.get("final_score")

    customer_id = safe_str(event.get("usr") or payload.get("customer_id"), "customer_id")
    canonical_id = await resolve_canonical_customer_id(pool, customer_id or None)
    log = logger.bind(customer_id=customer_id, severity=severity)
    if not canonical_id:
        log.warning("fraud_risk.halt.v1 without resolvable customer id — no mirror")
        return

    now = datetime.now(UTC)
    await upsert(
        pool,
        "customers",
        conflict_columns=["customer_id"],
        values={
            "customer_id": canonical_id,
            "fraud_risk_severity": severity or None,
            "fraud_risk_score": int(score) if isinstance(score, (int, float)) else None,
            "fraud_risk_categories": json.dumps(categories),
            "fraud_risk_flagged_at": coerce_date(payload.get("flagged_at")) or now,
            "fraud_risk_active": True,
            "updated_at": now,
            "created_at": now,
        },
        insert_only_columns=["created_at"],
    )
    log.info("customer fraud-risk alert raised")
```

- [ ] **Step 5: Export the handlers**

In `event-processor/src/billie_servicing/handlers/__init__.py`, add to the import block:

```python
from .fraud import (
    handle_fraud_risk_assessment,
    handle_fraud_risk_halt,
)
```

and add both names to the `__all__` list (keep it sorted/consistent with the file).

- [ ] **Step 6: Register the handlers**

In `event-processor/src/billie_servicing/main.py`, add both names to the `.handlers` import block (near `handle_final_decision`), and inside `setup_handlers()` (near the assessment registrations):

```python
    processor.register_handler("fraud_risk.assessment.v1", handle_fraud_risk_assessment)
    processor.register_handler("fraud_risk.halt.v1", handle_fraud_risk_halt)
```

- [ ] **Step 7: Run tests + lint + type-check**

Run: `cd /Users/rohansharp/workspace/billie-crm/event-processor && python -m pytest tests/test_fraud_risk.py -v`
Expected: PASS (4 tests).
Run: `cd /Users/rohansharp/workspace/billie-crm/event-processor && ruff check src tests && mypy src`
Expected: clean. (If `mypy` flags the `fraud_risk_score` int cast or dict typing, address minimally.)

- [ ] **Step 8: Commit**

```bash
cd /Users/rohansharp/workspace/billie-crm
git add event-processor/
git commit -m "feat(fraud): ingest fraud_risk.* — fraudCheck assessment + customer fraud-risk mirror"
```

---

### Task 2: Customers `fraudRisk` group + migration

**Files:**
- Modify: `src/collections/Customers.ts`
- Create: `src/migrations/<timestamp>_fraud_risk.ts`
- Modify: `src/payload-types.ts` (generated — do not hand-edit; run the generator)

**Interfaces:**
- Produces columns `customers.fraud_risk_{severity,score,categories,flagged_at,active}` and the `customer.fraudRisk` field the API/hook (Task 3) reads.

- [ ] **Step 1: Add the group to Customers.ts**

Insert this group as a peer in the `fields: [...]` array of `src/collections/Customers.ts`, right after the `identityVerification` group (mirroring the `reapplicationBlock`/`identityVerification` posture — `admin.readOnly: true`):

```ts
    {
      // Latest HIGH/CRITICAL fraud-risk incident, mirrored from fraud_risk.halt.v1
      // (billieChat FraudRiskAgent). Drives the AttentionStrip fraud chip.
      name: 'fraudRisk',
      type: 'group',
      admin: {
        readOnly: true,
        description: 'Latest HIGH/CRITICAL fraud-risk incident (flagged for review)',
      },
      fields: [
        {
          name: 'severity',
          type: 'text',
          admin: { description: 'HIGH or CRITICAL' },
        },
        {
          name: 'score',
          type: 'number',
          admin: { description: 'Final fraud risk score 0-100' },
        },
        {
          name: 'categories',
          type: 'json',
          admin: { description: 'Detected fraud/abuse categories' },
        },
        {
          name: 'flaggedAt',
          type: 'date',
        },
        {
          name: 'active',
          type: 'checkbox',
          admin: { description: 'True while the fraud alert is active' },
        },
      ],
    },
```

- [ ] **Step 2: Create the migration**

Create `src/migrations/<YYYYMMDD_HHMMSS>_fraud_risk.ts` (use the actual timestamp; match the format of `20260610_114936_reapplication_block_identity_verification.ts`):

```ts
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_severity" varchar;
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_score" numeric;
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_categories" jsonb;
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_flagged_at" timestamp(3) with time zone;
  ALTER TABLE "customers" ADD COLUMN "fraud_risk_active" boolean;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_severity";
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_score";
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_categories";
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_flagged_at";
  ALTER TABLE "customers" DROP COLUMN "fraud_risk_active";`)
}
```

(Preferred: generate the migration scaffold via `make -C infra/fly pg-migrate-create ENV=dev NAME=fraud_risk` against a local Postgres, then paste the DDL above; if no local Postgres is available, hand-author the file with the current timestamp — dev/test use `push: true` so the columns are created from the collection field at boot regardless.)

- [ ] **Step 3: Regenerate types**

Run: `cd /Users/rohansharp/workspace/billie-crm && pnpm generate:types`
Expected: `src/payload-types.ts` now contains a `fraudRisk?: {...}` block on the `Customer` type.

- [ ] **Step 4: Type-check**

Run: `cd /Users/rohansharp/workspace/billie-crm && pnpm typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/rohansharp/workspace/billie-crm
git add src/collections/Customers.ts src/migrations/ src/payload-types.ts
git commit -m "feat(fraud): customers.fraudRisk group + migration"
```

---

### Task 3: Customer API + hook + AttentionStrip fraud chip

**Files:**
- Modify: `src/app/api/customer/[customerId]/route.ts`
- Modify: `src/hooks/queries/useCustomer.ts`
- Modify: `src/lib/accountTriage.ts`
- Modify: `src/components/ServicingView/AttentionStrip.tsx`
- Modify: `src/components/ServicingView/ServicingView.tsx`
- Test: `tests/unit/lib/account-triage.test.ts`, `tests/unit/ui/attention-strip.test.tsx`

**Interfaces:**
- Consumes `customer.fraudRisk` (Task 2). Produces the `fraud_risk` AttentionItem kind + the customer-cockpit chip.

- [ ] **Step 1: Expose fraudRisk from the API**

In `src/app/api/customer/[customerId]/route.ts`, add one line to the returned `customer` object, right after `identityVerification: customer.identityVerification ?? null,`:

```ts
        fraudRisk: customer.fraudRisk ?? null,
```

- [ ] **Step 2: Add fraudRisk to CustomerData**

In `src/hooks/queries/useCustomer.ts`, add to the `CustomerData` interface, right after the `identityVerification?` block and before `loanAccounts?`:

```ts
  /** Latest HIGH/CRITICAL fraud-risk incident (billieChat FraudRiskAgent). */
  fraudRisk?: {
    severity?: string | null
    score?: number | null
    categories?: string[] | null
    flaggedAt?: string | null
    active?: boolean | null
  } | null
```

- [ ] **Step 3: Write the failing accountTriage test**

Append to `tests/unit/lib/account-triage.test.ts`:

```ts
  it('emits a high-severity fraud_risk chip when fraudRisk is active', () => {
    const items = getAttentionItems({
      vulnerable: false,
      accounts: [],
      fraudRisk: { severity: 'CRITICAL', score: 90, active: true },
      today: TODAY,
    })
    expect(items.map((i) => i.kind)).toContain('fraud_risk')
    const chip = items.find((i) => i.kind === 'fraud_risk')!
    expect(chip.severity).toBe('high')
    expect(chip.accountId).toBeNull()
    expect(chip.label).toContain('CRITICAL')
  })

  it('does not emit a fraud_risk chip when inactive', () => {
    const items = getAttentionItems({
      vulnerable: false,
      accounts: [],
      fraudRisk: { severity: 'CRITICAL', score: 90, active: false },
      today: TODAY,
    })
    expect(items.map((i) => i.kind)).not.toContain('fraud_risk')
  })
```

- [ ] **Step 4: Run it to verify failure**

Run: `cd /Users/rohansharp/workspace/billie-crm && pnpm exec vitest run tests/unit/lib/account-triage.test.ts --config ./vitest.config.mts`
Expected: FAIL — `getAttentionItems` has no `fraudRisk` param / no `fraud_risk` kind. (If Docker/Postgres is unavailable and globalSetup fails, note it and rely on `pnpm typecheck` for this step; the assertions still document intent.)

- [ ] **Step 5: Implement the accountTriage branch**

In `src/lib/accountTriage.ts`:

(a) Add `| 'fraud_risk'` to the `AttentionItem['kind']` union.

(b) Add the opts param + branch in `getAttentionItems`. Add `fraudRisk?: CustomerData['fraudRisk']` to the opts type, destructure `fraudRisk = null` (with the other defaults), and add this branch (after the reapplication-block branch):

```ts
  // Fraud risk (billieChat FraudRiskAgent) — customer-level, active HIGH/CRITICAL.
  if (fraudRisk?.active && (fraudRisk.severity ?? '').toUpperCase() !== '') {
    items.push({
      kind: 'fraud_risk',
      label: `Fraud risk: ${(fraudRisk.severity ?? '').toUpperCase()} — flagged for review`,
      accountId: null,
      severity: 'high',
    })
  }
```

- [ ] **Step 6: Add the ICON + thread it in**

(a) In `src/components/ServicingView/AttentionStrip.tsx`, add to the `ICON` record (required for the exhaustive `Record` to typecheck):

```ts
  fraud_risk: '🚩',
```

(b) In `src/components/ServicingView/ServicingView.tsx`, add `fraudRisk: customer?.fraudRisk ?? null` to the `getAttentionItems({...})` call and add `customer?.fraudRisk` to that `useMemo`'s dependency array.

- [ ] **Step 7: Add the AttentionStrip component test**

Append to `tests/unit/ui/attention-strip.test.tsx` a case rendering an `items` array containing `{ kind: 'fraud_risk', label: 'Fraud risk: CRITICAL — flagged for review', accountId: null, severity: 'high' }` and asserting the chip text renders and `data-testid="attention-chip-fraud_risk"` is present and disabled (accountId null). Follow the existing test structure in that file.

- [ ] **Step 8: Run tests + typecheck + lint**

Run: `cd /Users/rohansharp/workspace/billie-crm && pnpm exec vitest run tests/unit/lib/account-triage.test.ts tests/unit/ui/attention-strip.test.tsx --config ./vitest.config.mts`
Expected: PASS (or, if Docker unavailable, `pnpm typecheck` + `pnpm lint` clean and vitest noted as pending-Docker).
Run: `cd /Users/rohansharp/workspace/billie-crm && pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
cd /Users/rohansharp/workspace/billie-crm
git add src/ tests/
git commit -m "feat(fraud): customer fraud-risk chip in AttentionStrip + API/hook wiring"
```

---

### Task 4: Fraud panel on the application view

**Files:**
- Modify: `src/components/ConversationDetailView/AssessmentPanel/index.tsx`

**Interfaces:**
- Consumes `assessments.fraudCheck` (already surfaced by `/api/conversations/[id]`; no API/schema change).

- [ ] **Step 1: Derive the fraud data**

In `AssessmentPanel/index.tsx`, near the other assessment derivations (around lines 170-173), add:

```ts
  // Fraud risk (billieChat FraudRiskAgent) — written to assessments.fraudCheck.
  const fraudCheck = assessments?.fraudCheck as Record<string, unknown> | undefined
  const fraudSeverity = (fraudCheck?.severity as string | undefined)?.toUpperCase()
  const fraudSummary = fraudSeverity ? fraudSeverity : 'No data'
```

- [ ] **Step 2: Add the section**

Add a `<AssessmentSection>` (modeled on the Post-IDV Check section) right after the Post-IDV Check section closes and before the Statements section:

```tsx
      {/* Fraud risk */}
      <AssessmentSection title="Fraud risk" summary={fraudSummary}>
        {fraudCheck ? (
          <div>
            <p className={fraudSeverity && ['HIGH', 'CRITICAL'].includes(fraudSeverity) ? styles.fail : styles.pass}>
              {fraudSeverity} — score {String(fraudCheck.final_score ?? '?')}
            </p>
            <pre className={styles.jsonPreview}>{JSON.stringify(fraudCheck, null, 2)}</pre>
          </div>
        ) : (
          <p>No fraud-risk assessment data.</p>
        )}
      </AssessmentSection>
```

- [ ] **Step 3: Type-check + lint**

Run: `cd /Users/rohansharp/workspace/billie-crm && pnpm typecheck && pnpm lint`
Expected: clean. (`styles.pass`/`styles.fail`/`styles.jsonPreview` already exist in the panel's CSS module — reused above.)

- [ ] **Step 4: Commit**

```bash
cd /Users/rohansharp/workspace/billie-crm
git add src/components/ConversationDetailView/AssessmentPanel/index.tsx
git commit -m "feat(fraud): fraud-risk section on the application AssessmentPanel"
```

---

### Task 5: Verification

**Files:** none (verification only).

- [ ] **Step 1: Python suite**

Run: `cd /Users/rohansharp/workspace/billie-crm/event-processor && python -m pytest tests/test_fraud_risk.py tests/test_handler_exports.py -v && ruff check src tests && mypy src`
Expected: all pass; handler-exports test green (confirms `__init__.py`/`__all__` in sync); ruff/mypy clean.

- [ ] **Step 2: TS checks**

Run: `cd /Users/rohansharp/workspace/billie-crm && pnpm typecheck && pnpm lint && pnpm build`
Expected: clean build.
Run (if Docker available): `pnpm exec vitest run tests/unit/lib/account-triage.test.ts tests/unit/ui/attention-strip.test.tsx --config ./vitest.config.mts`
Expected: pass. If Docker is unavailable, record that the two vitest files are pending a Docker-enabled run; typecheck/lint/build stand as the gate.

- [ ] **Step 3: Commit any fixes**

```bash
cd /Users/rohansharp/workspace/billie-crm && git add -A && git commit -m "chore(fraud): verification fixes" || echo "nothing to commit"
```

## Rollout note

billie-crm already receives `fraud_risk.*` on `inbox:billie-servicing` (routed by billieChat's broker), so registering the handlers starts consuming them immediately on the next event-processor deploy — no billieChat change. The migration adds the `customers.fraud_risk_*` columns (applied at deploy; dev/test use `push: true`). The application-panel data needs no migration (the `assessments_fraud_check` column already exists).
