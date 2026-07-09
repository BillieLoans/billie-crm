# Fraud Alerting — Slack (billieChat) + CRM ingestion/display/alert (billie-crm) — Design

- **Date:** 2026-07-09
- **Status:** Approved design, pending implementation plans
- **Depends on:** the FraudRiskAgent (`docs/superpowers/specs/2026-07-08-fraud-risk-agent-design.md`, merged to `main` in PR #136), which emits `fraud_risk.assessment.v1` and `fraud_risk.halt.v1` to `chatLedger`.

## 1. Goal

When the FraudRiskAgent detects a **HIGH or CRITICAL** incident:

1. **Part A (billieChat):** page the **support** Slack channel, including a deep link into the CRM application view for that conversation.
2. **Part B (billie-crm):** ingest the `fraud_risk.*` events, persist the assessment, display it read-only on the application view, and raise a passive customer-level alert using the CRM's existing AttentionStrip alert framework.

The two parts live in **two repos** and ship as **two implementation plans / branches**, executed in order (Part A first).

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Slack trigger | Fire on **HIGH + CRITICAL**, in **shadow and enforce** modes (never `off`) |
| 2 | Slack failure | **Best-effort / non-fatal** — a Slack failure never interrupts scoring, emission, or the enforce-mode stop |
| 3 | Slack content | Includes a **deep link** to the CRM application view for the conversation |
| 4 | CRM alert style | **Passive banner + panel** — read-only fraud panel on the application view + a fraud chip in the customer cockpit's AttentionStrip (leverages the existing framework; no new alert framework) |
| 5 | CRM primary alert surface | **Customer-level** (keyed by `customer_id`), because HIGH/CRITICAL incidents often precede an `application_number` |

---

## Part A — billieChat: Slack support alert

### A1. Trigger point

In `backend/backend/src/agents/fraudRiskAgent/fraudRiskAgent.py`, `handle_user_input`, after `severity` is computed (and after the `off`-mode early return), when `severity in {HIGH, CRITICAL}` (the existing `_HALTING` set): fire a support-channel Slack alert. Placed **before** the enforce-only branch, so it pages in both `shadow` and `enforce`.

### A2. Fire-once per conversation

A multi-message probing session must page support **once**, not per message. Add a guard to `state.py`:

- `async try_claim_alert(self, conv: str, ttl: int) -> bool` — `SET fraudRisk:alerted:{conv} "1" NX EX ttl`; returns `True` only on the first claim (mirrors `try_claim_halt`). The alert fires only when the claim is won.

### A3. The alert call

Uses the existing framework: `slackUtils.send_slack_alert(message, *, category="incidents", title=..., color="danger", fields=[...])`, which routes to `SLACK_SUPPORT_WEBHOOK_URL` (the support channel), lazy-imported. Because `send_slack_alert` is synchronous/blocking (`requests.post`, 10s timeout) and the handler is async, it runs via `asyncio.to_thread(...)`.

Message contents: severity, conversation id, application number, final score, categories, `would_halt`, mode, and a **deep link** (§A4). Example (mrkdwn):

```
[FRAUD RISK CRITICAL] conv=<conv> application=<app> score=85
categories=[PROMPT_INJECTION, SYSTEM_PROMPT_EXFIL] would_halt=true mode=shadow
<https://crm.example/admin/applications/<conv>|Open in CRM>
```

Plus `fields` (severity, score, application, conversation, mode) for the Slack attachment, matching the OTP-incident call site's shape.

### A4. CRM deep link

- New config key **`crm_base_url`** (env override **`CRM_BASE_URL`**), set per environment (dev `http://localhost:3000`; demo/prod the deployed billie-crm admin base URLs). Added to all four `config.{dev,test,demo,prod}.json`.
- Deep link: `{crm_base_url}/admin/applications/{conversation_id}` — the CRM application/conversation detail view. The exact path segment and whether it keys on `conversation_id` vs `application_number` is confirmed against the CRM's `ApplicationsRouter` during Part B planning; `conversation_id` (always present on the fraud event as `conv`) is the default.
- If `crm_base_url` is unset/empty, the link is **omitted** from the message (the alert still fires).

### A5. Non-fatal contract

The entire alert path — claim, deep-link construction, `asyncio.to_thread(send_slack_alert)` — is wrapped in a single `try/except Exception` that only `logger.warning`s on failure. It runs **after** the assessment is emitted and does not gate the halt event or the enforce-mode `post_to_noticeboard`. Consequences of any failure (missing `SLACK_SUPPORT_WEBHOOK_URL`, HTTP error, timeout, missing `crm_base_url`): the alert is skipped/incomplete, a warning is logged, and `handle_user_input` proceeds exactly as if alerting were absent. `send_slack_alert` itself already no-ops (returns `False`) when the webhook env var is unset.

### A6. Files (Part A)

- **Modify** `backend/backend/src/agents/fraudRiskAgent/fraudRiskAgent.py` — the guarded alert block + a small `_alert_support(...)` helper.
- **Modify** `backend/backend/src/agents/fraudRiskAgent/state.py` — `try_claim_alert`.
- **Modify** `backend/backend/src/config.{dev,test,demo,prod}.json` — `crm_base_url` + `fraudRisk_alert_ttl_seconds` (fire-once TTL, default 86400).
- **Modify** `backend/tests/unit/agents/test_fraudRiskAgent.py`, `test_fraudRiskState.py` — tests.

### A7. Tests (Part A)

- Alert fires (mocked `send_slack_alert`) on HIGH and CRITICAL; not on LOW/MEDIUM; not in `off`; fires in both `shadow` and `enforce`.
- Fire-once: two HIGH/CRITICAL messages in one conversation → one alert (claim guard).
- Deep link present when `crm_base_url` set; omitted when unset.
- **Slack failure is non-fatal:** with `send_slack_alert` raising, `handle_user_input` still emits the assessment and (enforce) posts the stop — no exception propagates.
- `try_claim_alert` unit test in `test_fraudRiskState.py` (SET NX true then false).

---

## Part B — billie-crm: ingest → persist → display → alert

Entirely within `/Users/rohansharp/workspace/billie-crm`. billieChat needs no change — the broker already routes `fraud_risk.assessment.v1` / `fraud_risk.halt.v1` into `inbox:billie-servicing`, where they currently arrive and are silently ACK-dropped (no handler). billie-crm is a two-process system: a **Python event-processor** (consumer) and a **Payload CMS / Next.js** app (UI + API) over one Postgres.

### B1. Ingest (Python event-processor)

New `event-processor/src/billie_servicing/handlers/fraud_risk.py`, exported from `handlers/__init__.py` and registered in `main.py:setup_handlers`:

- **`handle_fraud_risk_assessment(pool, event)`** — for `fraud_risk.assessment.v1`. Parses the envelope payload (the `FraudRiskDecision` dict: `final_score`, `severity`, `categories`, `rationale`, `signals`, `would_halt`, `mode`, `conversation_id`, `application_number`). **Skips LOW** (benign — no write). For MEDIUM+, upserts a rolling fraud summary into the application record's **existing** `assessments.fraudCheck` JSONB slot (`conversations.assessments_fraud_check`), via `merge_jsonb`/`upsert_conversation`: `{ latest: {...}, peak_severity, peak_score, flagged_count, last_flagged_at }`. **Update-only** keyed by the conversation's stable id — does not create a conversation row if none exists (mirrors the `handle_assessment` / reapplication handlers; exact key column read from `Conversations.ts` at plan time).
- **`handle_fraud_risk_halt(pool, event)`** — for `fraud_risk.halt.v1` (HIGH/CRITICAL). Raises the **customer-level** fraud alert by upserting `customers.fraud_risk_*` (keyed by `customer_id`, update-only): severity, score, categories, `flagged_at`, `active=true`. This drives the AttentionStrip chip.

The processor's `_parse_event` needs no change (unknown prefixes already fall to the envelope path, matching `application.reapplication_blocked.v1`); a `fraud_risk.` branch is optional and out of scope for v1.

### B2. Persist

- **Application/conversation level:** reuse `conversations.assessments_fraud_check` (JSONB, already migrated — no schema change).
- **Customer level:** add a `fraudRisk` group to `src/collections/Customers.ts` (modeled on the `reapplicationBlock`/`identityVerification` groups), flattening to columns `fraud_risk_severity`, `fraud_risk_score`, `fraud_risk_categories`, `fraud_risk_flagged_at`, `fraud_risk_active`. Add a migration under `src/migrations/` mirroring `20260610_114936_reapplication_block_identity_verification.ts`, then `pnpm generate:types`.

### B3. Display — application view

Add a **Fraud risk** section to `src/components/ConversationDetailView/AssessmentPanel/index.tsx`, reading the `assessments.fraudCheck` data already surfaced by `GET /api/conversations/[conversationId]` (`route.ts:172`): peak severity (color-coded), score, categories, rationale, last-flagged time, flagged count. No API change needed for this panel. (A HIGH/CRITICAL branch in `DecisionBanner` is optional polish, out of scope for v1.)

### B4. Alert — customer cockpit (AttentionStrip)

Leverage the existing framework:

- **Data:** add `fraudRisk` to the `CustomerData` type in `src/hooks/queries/useCustomer.ts` and return `fraudRisk: customer.fraudRisk ?? null` from `src/app/api/customer/[customerId]/route.ts` (alongside `reapplicationBlock`/`identityVerification`).
- **Logic:** add a `fraud_risk` kind to the `AttentionItem` union and a branch in `getAttentionItems(...)` in `src/lib/accountTriage.ts` — emit a chip when `fraudRisk?.active` and severity is HIGH/CRITICAL, e.g. `label: "Fraud risk: CRITICAL — flagged for review"`, `severity: 'high'`.
- **UI:** add a `fraud_risk` entry to the `ICON` map in `src/components/ServicingView/AttentionStrip.tsx`. It then renders automatically in the cockpit (`ServicingView.tsx`).

### B5. Files (Part B)

**Python (event-processor):** `handlers/fraud_risk.py` (new), `handlers/__init__.py`, `main.py`, plus pytest under `event-processor/tests/`.
**Payload/Next (TypeScript):** `src/collections/Customers.ts`, a new migration in `src/migrations/`, `payload-types.ts` (generated), `src/hooks/queries/useCustomer.ts`, `src/app/api/customer/[customerId]/route.ts`, `src/lib/accountTriage.ts`, `src/components/ServicingView/AttentionStrip.tsx`, `src/components/ConversationDetailView/AssessmentPanel/index.tsx`, plus Vitest tests under `tests/`.

### B6. Tests (Part B)

- **Python (pytest, MockPool):** `handle_fraud_risk_assessment` writes the rolling summary into `assessments_fraud_check` for MEDIUM+, skips LOW, is update-only. `handle_fraud_risk_halt` sets `customers.fraud_risk_*` active with the right severity. Handler registration wired in `main.py`.
- **TypeScript (Vitest):** `getAttentionItems` emits the fraud chip when `fraudRisk.active` HIGH/CRITICAL and not otherwise; `AssessmentPanel` renders the fraud section from `fraudCheck` data.

---

## 3. Rollout & sequencing

- **Part A** ships in the billieChat `feat/fraud-alerting` branch. The alert fires wherever the FraudRiskAgent runs (shadow on demo; off/disabled in prod until the agent is enabled). `SLACK_SUPPORT_WEBHOOK_URL` and `CRM_BASE_URL` must be set for the alert/link to be live; both no-op gracefully when unset.
- **Part B** ships in a billie-crm branch after Part A. It is independent — it consumes events that already flow to the CRM, so it can be enabled without any billieChat redeploy.

## 4. Out of scope (v1)

- An actionable fraud-review **queue** with maker-checker (the "Approvals" pattern) — the chosen surface is the passive banner/chip. Can be layered later.
- A `DecisionBanner` fraud branch on the application view (optional polish).
- A typed `fraud_risk.` parser branch in the CRM `_parse_event` (envelope path suffices).
- Postgres projection / analytics for `fraud_risk.*` (already noted as a fast-follow in the agent spec).

## 5. Key edge cases

- **Pre-application / anonymous sessions:** `application_number` is often `""` early in a conversation. The **customer-level chip (keyed by `customer_id`) is the reliable primary surface**; the application-detail panel attaches only when a conversation/application row exists. Handlers are **update-only** — they never create junk customer/conversation rows for anonymous sessions.
- **Volume:** `fraud_risk.assessment.v1` fires for every message; the CRM assessment handler skips LOW and only rolls up MEDIUM+, and the Slack alert is fire-once per conversation — both bound write/alert volume.
