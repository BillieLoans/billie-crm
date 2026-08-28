---
name: assessing-issue-reports
description: Use when asked to assess, investigate, triage, or resolve an in-app problem report filed via the CRM's "Report Issue" button — triggered by a crm.billie.loans/admin/issue-reports/<uuid> or demo.crm.billie.loans URL, an issue UUID, mention of the issues collection, or "look at the latest issue reports" in prod or demo.
---

# Assessing CRM Issue Reports

## Overview

Staff file problem reports from inside the CRM (global "Report Issue" button, or an auto-offer on 5xx/network failures). Each report is one row in the Payload `issues` collection (Neon Postgres) — description, `triggerReason`, a zod-validated `diagnostics` JSON (page context, device, last-10 interaction/route buffers, last-15 API calls, last-30 errors, failed-actions queue), and optionally `screenshotUri` pointing at an S3 object (`issues/{yyyy-mm}/{uuid}.{jpg|png}`).

**Fetch everything through the CRM's own admin REST API — never raw Neon/S3 credentials.** `GET /api/issues/:id` returns the full row; `GET /api/issues/:id/screenshot` streams the S3 object server-side. Both are admin-gated and identical across environments.

The user hands over: an issue URL (preferred — encodes env + id), a UUID + env, or "the latest reports".

## Environments

| Env | Base URL | Fly app | Edge auth |
|---|---|---|---|
| prod | https://crm.billie.loans | billie-crm-prod | Cloudflare Access (`cloudflared access login` once) |
| demo | https://demo.crm.billie.loans | billie-crm-demo | none |

S3 buckets (context only — do not access directly): prod `billie-files-prod-734836384687`, demo `billie-applications-nonprod`.

## Fetching

```bash
.claude/skills/assessing-issue-reports/fetch-issue.sh <issue-url> [outdir]
.claude/skills/assessing-issue-reports/fetch-issue.sh <uuid> <prod|demo> [outdir]
.claude/skills/assessing-issue-reports/fetch-issue.sh list <prod|demo>
.claude/skills/assessing-issue-reports/fetch-issue.sh api <prod|demo> </api/...>   # ad-hoc read-only GET for chasing the data behind an issue
```

The `api` mode is how you pull the account/customer/ledger state a report points at (e.g. `/api/customer/<id>`, `/api/ledger/transactions?loanAccountId=<uuid>&limit=100`) — evaluate UI gating conditions against real data instead of guessing. Never fetch `/api/users/*` or any issue with `depth>0`: Payload returns admin users' live `apiKey` values to admin readers, which must not enter the transcript.

Known gap: reports filed from builds before the server-proxied upload fix (working tree on 9d8c2d1, 18 Aug 2026) silently lack screenshots — the browser→S3 presign PUT was CSP-blocked. `screenshotUri: null` on those builds does not mean the reporter skipped the screenshot.

Pass the session scratchpad as `outdir`. Prints the issue JSON, saves it plus the screenshot; view the screenshot with the Read tool. Auth comes from a Keychain-held Payload API key plus (prod) a cloudflared Access token — secrets never enter the transcript. On auth failure the script prints exact setup instructions (exit 2 = Keychain item missing, 3 = needs `cloudflared access login`, 4 = HTTP error, explained on stderr); relay them to the user verbatim and wait — the API key must be created in the CRM UI and stored by the user in their own terminal, never pasted into chat.

## Assessing

Work through the diagnostics in this order — it is a flight recorder, read it backwards from the moment of capture:

1. **`context`** — `route`/`url` locate the screen (map to the view component under `src/components/*View`/`payload.config.ts` `admin.views`); `buildSha` is the short git SHA of the deployed commit: run `git log --oneline -5 <buildSha>` and assess against THAT code, not HEAD; `timeOnPageSec`, `capturedAt` (UTC) anchor the timeline.
2. **`errors[]`** — window errors, unhandled rejections, react-boundary and fetch failures, with stacks.
3. **`apiCalls[]`** — last 15 with status/duration; failed or slow calls near `capturedAt` usually name the broken endpoint.
4. **`interactions[]` + `routes[]`** — what the reporter actually did (element identity only, no input values).
5. **`failedActions[]`** — the mutation queue's failures, richest signal for "button didn't work" reports.
6. **Screenshot** — Read the saved image; check what state the UI actually showed.
7. **Server side** — `fly logs -a billie-crm-<env>` correlated to `capturedAt` (recent reports only — Fly log retention is short). For domain-data oddities (e.g. an account in a wrong state), continue investigation in the projection tables and event stream per existing debug recipes.
8. **Code** — locate the responsible component/route/hook; explain the mechanism, not just the symptom.

Deliverable: a written assessment — symptom, evidence trail (quote the specific diagnostics entries), root cause or ranked hypotheses, repro steps if derivable, proposed fix, and a draft resolution note. Assessment is the default scope: do not change code or issue status unless asked.

## Resolving (only on explicit request)

```bash
curl -sS -X PATCH -H @<headerfile> -H 'Content-Type: application/json' \
  "$BASE/api/issues/<id>" -d '{"status":"resolved","resolutionNote":"..."}'
```

Only `status` and `resolutionNote` are mutable (collection hook restores everything else). Reopening (`"status":"open"`) clears the resolved stamps but keeps the note. Normally the admin resolves in the UI at `/admin/issue-reports/<id>` — offer the drafted note instead of patching.

## Fallbacks (app API unavailable or insufficient)

- **Browser**: with Claude-in-Chrome connected, the user's own session can open `/admin/issue-reports/<id>` or the `/api/issues/:id` JSON directly.
- **Direct Neon** (app down): DATABASE_URI lives in `infra/fly/env/.env.<env>` which Claude is deny-listed from reading — ask the user to run via `!`: `psql "$DATABASE_URI" -c "select ... from issues where id='<uuid>'"`. Columns: `id, title, description, trigger_reason, screenshot_uri, diagnostics, status, resolution_note, resolved_at, resolved_by_id, reported_by_id, created_at, updated_at`.
- **Direct S3**: read-only AWS profiles exist locally (`billie-prod-ro`, `billie-nonprod-ro`); `aws s3 cp "<screenshot_uri>" . --profile billie-prod-ro` may need the user to run it (`!`) or an `aws sso login` first.
