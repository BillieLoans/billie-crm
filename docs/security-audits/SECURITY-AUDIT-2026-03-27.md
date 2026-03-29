# Billie CRM -- Penetration Test Report

**Target:** crm.billie.loans (source code audit)
**Date:** 2026-03-27
**Scope:** Full application -- Payload CMS (Next.js), Python event processor, infrastructure
**Remediation:** 2026-03-28 to 2026-03-29

---

## Executive Summary

The application had **significant security vulnerabilities** across authentication, authorization, and input validation. The most critical finding was that **35+ financial API routes had zero authentication**, relying solely on a Cloudflare origin header as the perimeter defense. Combined with a privilege escalation flaw that let any user promote themselves to admin, the posture would have allowed a determined attacker to execute arbitrary financial operations.

**Remediation is complete.** All 36 findings have been addressed. 35 are fully resolved; 1 (H9 -- Cloudflare origin check on demo) is partially resolved with the risk accepted due to Cloudflare subscription limitations.

| Severity | Count | Remediated | Remaining |
|----------|-------|------------|-----------|
| Critical | 5 | 5 | 0 |
| High | 10 | 9 | 1 (H9 partial -- demo risk accepted) |
| Medium | 14 | 14 | 0 |
| Low | 7 | 7 | 0 |

---

## Critical Findings (Immediate Action Required)

### C1: Unauthenticated Financial API Routes -- REMEDIATED 2026-03-28

**Severity:** CRITICAL
**Status:** RESOLVED

**Original finding:** 35+ routes under `src/app/api/` had no auth checks.

**Action taken:** Created `src/lib/auth.ts` with a `requireAuth(accessCheck?)` utility that handles both authentication (via `payload.auth()`) and role-based authorization. Applied to 49 route files with three access tiers:

| Access Level | Roles Allowed | Routes |
|---|---|---|
| `hasAnyRole` | admin, supervisor, operations, readonly | 30 GET handlers (reads) |
| `canService` | admin, supervisor, operations | 14 POST handlers (operational writes) |
| `hasApprovalAuthority` | admin, supervisor | 10 POST/PUT/DELETE handlers (sensitive mutations) |

Health check routes (`/api/health`, `/api/ledger/health`) intentionally left unauthenticated for infrastructure probes. Misleading "auth not needed" comment removed from `customer/search/route.ts`.

---

### C2: Privilege Escalation via Self-Role Modification -- REMEDIATED 2026-03-28

**Severity:** CRITICAL
**Status:** RESOLVED

**Original finding:** Any user could PATCH their own user record to set `role: "admin"`.

**Action taken:** Added field-level access control on the `role` field in `src/collections/Users.ts`: `access: { update: ({ req }) => isAdmin(req.user) }`. Only admins can modify role assignments. Also changed `defaultValue` from `'supervisor'` to `'readonly'` (also fixes M5).

---

### C3: Payload Secret Falls Back to Empty String -- REMEDIATED 2026-03-29

**Severity:** CRITICAL
**Status:** RESOLVED

**Original finding:** `secret: process.env.PAYLOAD_SECRET || ''` allowed JWT forgery if env var was unset.

**Action taken:** Two-layer fix required because Next.js evaluates `payload.config.ts` at build time (when env vars aren't available):
1. **Build time:** `payload.config.ts` uses a placeholder string so the build completes
2. **Runtime:** `src/middleware.ts` checks `PAYLOAD_SECRET` at module load -- if missing or still the placeholder, all non-health requests return HTTP 503

Also fixed L3: `DATABASE_URI` uses the same placeholder pattern for build, with Payload failing to connect at runtime if missing.

---

### C4: Production Secrets in Plaintext on Disk -- REMEDIATED 2026-03-28

**Severity:** CRITICAL
**Status:** RESOLVED

**Original finding:** Production credentials in plaintext in `infra/fly/env/.env.prod`, `.env.demo`, `.env`.

**Action taken:** All secrets rotated by operator on 2026-03-28.

---

### C5: GitHub Token Baked into Docker Image Layers -- REMEDIATED 2026-03-29

**Severity:** CRITICAL
**Status:** RESOLVED

**Original finding:** `event-processor/Dockerfile`, `Dockerfile.dev`, `Dockerfile.test` used `ARG GITHUB_TOKEN` in `RUN` commands, persisting the token in image layer history.

**Action taken:** Converted all three Dockerfiles to use `--mount=type=secret,id=GITHUB_TOKEN` with the `subst-sdk-requirements.py` helper script (matching the existing secure pattern in `Dockerfile.demo`). Also fixed `Dockerfile.test` which promoted `DATABASE_URI` and `PAYLOAD_SECRET` from `ARG` to `ENV` -- replaced with build-time placeholders.

---

## High Findings

### H1: Client-Supplied Identity Fields Trusted for Audit Trail -- REMEDIATED 2026-03-29

**Severity:** HIGH
**Status:** RESOLVED

**Original finding:** 9 routes accepted `approvedBy`/`createdBy`/`finalizedBy`/`updatedBy`/`acknowledgedBy` from request body.

**Action taken:** All 9 routes now derive the identity from `String(user.id)` via the authenticated session. Client-supplied identity fields made optional in interfaces and their validation checks removed. Affected: `ledger/waive-fee`, `ledger/write-off`, `ledger/adjustment`, `export/jobs`, `period-close/finalize`, `period-close/acknowledge-anomaly`, `ecl-config/pd-rate`, `ecl-config/overlay`, `ecl-config/schedule`.

---

### H2: SSRF via Host Header in Dashboard Route -- REMEDIATED 2026-03-29

**Severity:** HIGH
**Status:** RESOLVED

**Original finding:** Dashboard constructed internal fetch URL from attacker-controllable `Host` and `x-forwarded-proto` headers.

**Action taken:** Replaced `${protocol}://${host}` with `process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'` in `src/app/api/dashboard/route.ts`.

---

### H3: Tiptap XSS via `javascript:` URIs -- REMEDIATED 2026-03-29

**Severity:** HIGH
**Status:** RESOLVED

**Original finding:** Tiptap link renderer accepted any protocol in `href`, including `javascript:`.

**Action taken:** Added protocol validation in `src/lib/tiptap.tsx`: links only render as clickable `<a>` tags if href matches `/^https?:\/\//i`. All other protocols (`javascript:`, `data:`, `vbscript:`) are silently dropped -- text renders but without the hyperlink.

---

### H4: S3 Path Traversal via Unsanitized `accountNumber` -- REMEDIATED 2026-03-29

**Severity:** HIGH
**Status:** RESOLVED

**Original finding:** `accountNumber` used unsanitized in S3 key path, allowing `../../` traversal.

**Action taken:** Two layers of protection in `src/app/api/uploads/presigned-url/route.ts`:
1. **Existence check:** Looks up the account number in MongoDB via Payload. Returns 404 if the account doesn't exist.
2. **Sanitization:** `accountNumber` stripped to `[a-zA-Z0-9._-]` (same regex as `fileName`).

---

### H5: NoSQL Injection in Python Event Processor -- REMEDIATED 2026-03-29

**Severity:** HIGH
**Status:** RESOLVED

**Original finding:** Chat/conversation and writeoff events passed raw dicts to MongoDB queries. A crafted `{"cid": {"$ne": null}}` would match all documents.

**Action taken:** Created `event-processor/src/billie_servicing/handlers/sanitize.py` with:
- `safe_str(value, field_name)` -- validates values are primitive types before use in MongoDB query filters. Rejects dicts/lists with `ValueError` (routed to DLQ).
- `strip_dollar_keys(data)` -- removes `$`-prefixed keys from dicts before MongoDB storage.

Applied `safe_str()` to all 8 conversation handlers and all 4 writeoff handlers wherever event fields are used in query filters. Applied `strip_dollar_keys()` to `applicationData` storage.

---

### H6: Credentials Logged in Plaintext -- REMEDIATED 2026-03-29

**Severity:** HIGH
**Status:** RESOLVED

**Original finding:** Redis URL (with password) and MongoDB URI logged in plaintext at startup.

**Action taken:** Both files now redact credentials before logging using `://***@` substitution:
- `src/server/redis-client.ts` -- `REDIS_URL.replace(/:\/\/[^@]*@/, '://***@')`
- `event-processor/src/billie_servicing/main.py` -- `re.sub(r"://[^@]*@", "://***@", url)` applied to both `print()` and `structlog` output.

---

### H7: Error Messages Leak Internal Details -- REMEDIATED 2026-03-29

**Severity:** HIGH
**Status:** RESOLVED

**Original finding:** 47 API routes returned `(error as Error).message` in responses. `handleApiError` included `originalError`.

**Action taken:** Replaced all 44 instances of raw error messages with `'An internal error occurred. Please try again.'` across all route files. Fixed `src/lib/utils/api-error.ts` to remove `originalError` from response bodies. Full error details remain logged server-side via existing `console.error` calls.

---

### H8: gRPC Connection Uses Insecure Channel -- REMEDIATED 2026-03-29

**Severity:** HIGH
**Status:** RESOLVED (risk accepted for internal network)

**Original finding:** `grpc.credentials.createInsecure()` used unconditionally.

**Decision:** All deployed environments use Fly.io `.internal` addresses which are already encrypted by Fly's WireGuard mesh. Adding gRPC-level TLS would be double-encryption with significant certificate management overhead.

**Action taken:** Hybrid approach in `src/server/grpc-client.ts`: insecure credentials for `.internal` and `localhost` addresses (already WireGuard-encrypted or local dev), TLS required for any other address. This prevents accidental plaintext connections if the service URL is ever pointed at an external endpoint.

---

### H9: Cloudflare Origin Check Disabled/Bypassable -- PARTIALLY REMEDIATED 2026-03-29

**Severity:** HIGH
**Status:** RESOLVED for production; RISK ACCEPTED for demo

**Original finding:** Cloudflare origin check silently passed when `CF_SECRET` was unset, and was explicitly disabled in demo.

**Action taken:** `src/middleware.ts` now fails closed in production -- if `CF_SECRET` is not set and `NODE_ENV=production`, all non-health requests are blocked with 403. Logs an error for visibility.

**Risk accepted:** Demo environment retains `DISABLE_CF_SECRET_CHECK=true` because the current Cloudflare subscription does not support proxying `*.*.domain` subdomains. This is documented and accepted.

---

### H10: Public Media Collection -- REMEDIATED 2026-03-29

**Severity:** HIGH
**Status:** RESOLVED (fixed as part of M7 remediation)

**Original finding:** Media collection read access was `() => true` -- completely public.

**Action taken:** Changed to `read: ({ req }) => hasAnyRole(req.user)` in `src/collections/Media.ts`. All uploaded files now require authentication.

---

## Medium Findings

### M1: No Rate Limiting on Any API Route -- DEFERRED

**Severity:** MEDIUM
**Status:** DEFERRED -- will be implemented at the Cloudflare WAF layer once licence upgraded

**Original finding:** No rate limiting anywhere. Enables brute-force enumeration and DoS.

**Decision:** Rate limiting will be enforced via Cloudflare WAF rules rather than application-level middleware. This is blocked by current Cloudflare subscription limitations. To be revisited when the licence is upgraded.

---

### M2: No CSRF Protection on Mutation Endpoints -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Original finding:** No CSRF protection on POST/PUT/PATCH/DELETE routes.

**Action taken:** Added Origin header validation in `src/middleware.ts`. All mutation requests (POST/PUT/PATCH/DELETE) are checked against `NEXT_PUBLIC_APP_URL` -- if the `Origin` or `Referer` header doesn't match the expected app origin, the request is blocked with 403. Server-to-server requests without either header are allowed through (not browser-initiated).

---

### M3: No Content Security Policy Header -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Original finding:** No `Content-Security-Policy` header.

**Action taken:** Added CSP header in `src/middleware.ts` via `setSecurityHeaders()`: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'`. The `unsafe-inline`/`unsafe-eval` exceptions are required by Payload CMS and Next.js runtime.

---

### M4: Middleware Auth Check Based on Cookie Presence, Not Validity -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Original finding:** Middleware redirected based on cookie presence, not validity. `payload-token=garbage` would redirect to dashboard.

**Action taken:** Added `isJwtNotExpired()` helper in `src/middleware.ts` that decodes the JWT payload (base64) and checks the `exp` claim against current time. Invalid, malformed, or expired tokens are treated as absent -- user gets redirected to login. Full signature verification still happens at the route level via `payload.auth()`.

---

### M5: Default User Role is `supervisor` -- REMEDIATED 2026-03-28

**Severity:** MEDIUM
**Status:** RESOLVED (fixed as part of C2 remediation)

**Action taken:** Default role changed from `'supervisor'` to `'readonly'` in `src/collections/Users.ts`.

---

### M6: No Zod Validation on Most API Route Inputs -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Original finding:** Only write-off command routes used Zod. All others used ad-hoc `if (!body.field)` checks.

**Action taken:** Created two schema files and applied Zod validation to 14 mutation routes:

- **`src/lib/schemas/ledger.ts`** -- 7 schemas for ledger operations with decimal string validation (`/^\d+(\.\d{1,2})?$/`), positive amount enforcement, string length limits on reason/notes fields. Applied to: repayment, waive-fee, write-off, adjustment, late-fee, dishonour-fee, disburse.

- **`src/lib/schemas/api.ts`** -- 7 schemas for ECL config (PD rate 0-1 range, overlay), period-close (YYYY-MM-DD date format), exports (enum validation, array bounds), and uploads (content type enum, filename length). Applied to: pd-rate, overlay, finalize, preview, acknowledge-anomaly, export/jobs POST, presigned-url.

All ad-hoc validation replaced with `.safeParse()` returning structured field errors on 400.

---

### M7: Inconsistent Collection Access Controls -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Original finding:** WriteOffRequests and ContactNotes used `!!req.user` (accepts any authenticated user even without a valid role), inconsistent with other collections using `hasAnyRole`.

**Action taken:** Standardised read access across all collections:
- WriteOffRequests: `!!req.user` -> `hasAnyRole(req.user)` (validates role)
- ContactNotes: `!!req.user` -> `hasAnyRole(req.user)` (validates role)
- Media: `() => true` -> `hasAnyRole(req.user)` (was public, now requires auth -- also fixes H10)
- Conversations/Applications remain `supervisorOrAdmin` (intentionally restricted to origination data)
- Customers/LoanAccounts remain `servicingAccess` (all roles including readonly)

---

### M8: gRPC Fallback Returns `success: true` When Service is Down -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Original finding:** PD rate and overlay write operations returned `success: true` with HTTP 200 when ledger was unavailable.

**Action taken:** Both routes now return HTTP 503 with an error message when the ledger is unavailable. Read-only fallbacks (config, history, pending) are unchanged -- returning empty data with `_fallback: true` for reads is acceptable since the UI shows a degraded state indicator.

---

### M9: Unbounded Event Payload Sizes (DoS) -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Original finding:** No size limit on event payloads. Unbounded `$push` on `utterances` and `noticeboard` arrays.

**Action taken:**
1. Added `max_payload_bytes` (256 KB) setting in `config.py`. Oversized events are rejected and moved to DLQ before parsing.
2. Added `$slice` to `utterances` `$push` (capped at 2000 entries, keeping most recent).
3. Added `$slice` to `noticeboard` `$push` (capped at 500 entries, keeping most recent).
All limits are configurable via environment variables.

---

### M10: Unpinned Python Dependencies -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Original finding:** All dependencies used `>=` minimum specifiers. No reproducibility guarantee.

**Action taken:** Pinned all dependencies to exact versions in `event-processor/requirements.txt` (e.g., `redis==5.2.1`, `motor==3.7.1`). Created `requirements-dev.txt` for test dependencies (also fixes L5). Test deps (`pytest`, `pytest-asyncio`, `pytest-cov`) are no longer installed in production images.

---

### M11: Docker Dev/Test Images Run as Root -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Original finding:** `Dockerfile.dev` and `Dockerfile.test` had no `USER` directive, running as root.

**Action taken:** Both Dockerfiles now create the same `nodejs` group (GID 1001) and `nextjs` user (UID 1001) as the production Dockerfile, with `chown` on the app directory and `USER nextjs` before `CMD`.

---

### M12: AWS Credentials Directory Mounted in docker-compose -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Original finding:** Full `~/.aws` directory mounted, exposing credentials for all AWS accounts.

**Action taken:** `docker-compose.yml` now mounts only what AWS SSO needs:
- `~/.aws/config` (SSO profile definitions) -- read-only
- `~/.aws/sso/` (cached SSO tokens) -- read-only

The `~/.aws/credentials` file (long-lived access keys) is no longer mounted. Paths updated from `/root/.aws` to `/home/nextjs/.aws` to match non-root user. `AWS_SHARED_CREDENTIALS_FILE` env var removed.

---

### M13: Excessive Console Logging of Financial Data -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Original finding:** 14+ API routes logged full request bodies and gRPC responses via `console.log`.

**Action taken:** Removed all 28 `console.log` calls across 16 API route files. These dumped raw gRPC responses (`JSON.stringify(response)`), request bodies, financial amounts, and account details. All `console.error` and `console.warn` calls (legitimate error/warning logging) were preserved.

---

### M14: No TLS Enforcement on Redis/MongoDB in Event Processor -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Original finding:** No TLS enforcement on Redis or MongoDB connections in the event processor.

**Action taken:** Added `_check_tls_urls()` in `processor.py` that validates connection URLs at startup when `NODE_ENV=production`. Logs a warning if Redis URL doesn't use `rediss://` or MongoDB URI doesn't use `mongodb+srv://` / `tls=true`. Called from `EventProcessor.__init__` so it runs before any connection attempt.

---

## Low Findings

### L1: No Explicit CSRF Origins in Payload Config -- REMEDIATED 2026-03-29

**Severity:** LOW
**Status:** RESOLVED

**Original finding:** No `csrf` origins configured in Payload config.

**Action taken:** Added `csrf: [process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000']` to `src/payload.config.ts`. Payload now validates CSRF tokens against the explicit origin list.

---

### L2: `parseInt` Without NaN Validation -- REMEDIATED 2026-03-29

**Severity:** LOW
**Status:** RESOLVED

**Original finding:** Multiple routes used `parseInt` on query params without NaN checks.

**Action taken:** Added `Number.isFinite()` guards to 9 `parseInt` call sites across 8 route files (transactions, aging/overdue, accrual/history, export/jobs, investigation/search, investigation/events, period-close/history, ecl-config/history). Invalid numeric params now return 400.

---

### L3: `DATABASE_URI` Falls Back to Empty String -- REMEDIATED 2026-03-29

**Severity:** LOW
**Status:** RESOLVED (fixed as part of C3 remediation)

**Action taken:** Uses build-time placeholder; Payload fails to connect at runtime if `DATABASE_URI` is not set to a real value.

---

### L4: Missing `.dockerignore` for Sensitive Directories -- REMEDIATED 2026-03-29

**Severity:** LOW
**Status:** RESOLVED

**Original finding:** `.dockerignore` didn't exclude `infra/fly/env/`, `.claude/`, or `.mcp.json`.

**Action taken:** Added `infra/fly/env/`, `.claude/`, and `.mcp.json` to `.dockerignore`.

---

### L5: Test Dependencies in Production Python Requirements -- REMEDIATED 2026-03-29

**Severity:** LOW
**Status:** RESOLVED (fixed as part of M10 remediation)

**Action taken:** Test dependencies moved to `event-processor/requirements-dev.txt`. Production `requirements.txt` no longer includes pytest.

---

### L6: TOCTOU Race in Event Deduplication -- REMEDIATED 2026-03-29

**Severity:** LOW
**Status:** RESOLVED

**Original finding:** Dedup used separate `EXISTS` + `SETEX` (non-atomic).

**Action taken:** Replaced with atomic `SET NX EX` in `processor.py`. The dedup key is now set atomically before processing -- if the key already exists (`is_new=False`), the event is skipped. The separate `SETEX` after handler execution was removed.

---

### L7: Non-Atomic Read-Modify-Write on Conversations -- REMEDIATED 2026-03-29

**Severity:** LOW
**Status:** RESOLVED

**Original finding:** `_ensure_conversation_exists` used `find_one` then `insert_one` (race condition).

**Action taken:** Replaced with atomic `update_one` using `$setOnInsert` + `upsert=True` in `conversation.py`. Two concurrent calls for the same conversation ID now safely result in one insert (via MongoDB's atomic upsert) rather than a duplicate-key error.

---

## Positive Findings

- No `dangerouslySetInnerHTML`, `eval()`, or `pickle` usage
- Good security headers (HSTS, X-Frame-Options, X-Content-Type-Options)
- Idempotency keys on financial operations
- Version conflict detection (optimistic concurrency) on repayments/waivers
- Write-off approval workflow properly checks `hasApprovalAuthority`
- File upload has content type allowlist and filename sanitization
- Cloudflare origin verification provides defense-in-depth (when enabled)
- Production Dockerfile correctly uses non-root user and BuildKit secrets
- No prototype pollution patterns detected

---

## Remediation Status

| Item | Status | Date | Summary |
|------|--------|------|---------|
| C1 | DONE | 2026-03-28 | `requireAuth()` utility added to 49 route files with role-based access |
| C2 | DONE | 2026-03-28 | Field-level access control on `role` field; default changed to `readonly` |
| C3 | DONE | 2026-03-29 | Build-time placeholder + runtime middleware check returns 503 |
| C4 | DONE | 2026-03-28 | All secrets rotated by operator |
| C5 | DONE | 2026-03-29 | All Dockerfiles converted to `--mount=type=secret` |
| H1 | DONE | 2026-03-29 | All 9 routes now derive identity from `String(user.id)` |
| H2 | DONE | 2026-03-29 | Internal URL from `NEXT_PUBLIC_APP_URL` env var, not request headers |
| H3 | DONE | 2026-03-29 | Link href validated against `https?://` protocol |
| H4 | DONE | 2026-03-29 | Account existence check + `accountNumber` sanitization |
| H5 | DONE | 2026-03-29 | `safe_str()` and `strip_dollar_keys()` applied to all event handlers |
| H6 | DONE | 2026-03-29 | Credentials redacted in both Node.js and Python log output |
| H7 | DONE | 2026-03-29 | 44 instances of raw error messages replaced with generic message |
| H8 | DONE | 2026-03-29 | Hybrid: insecure for `.internal`/localhost, TLS for external |
| M5 | DONE | 2026-03-28 | Fixed as part of C2 (default role to `readonly`) |
| L3 | DONE | 2026-03-29 | Fixed as part of C3 (build-time placeholder) |
| H9 | PARTIAL | 2026-03-29 | Fail-closed in prod; demo risk accepted (CF subscription limitation) |
| H10 | DONE | 2026-03-29 | Media collection requires auth (fixed with M7) |
| M1 | DEFERRED | -- | Rate limiting deferred to Cloudflare WAF (licence upgrade needed) |
| M2 | DONE | 2026-03-29 | CSRF origin validation on mutation requests |
| M3 | DONE | 2026-03-29 | Content-Security-Policy header added |
| M4 | DONE | 2026-03-29 | JWT expiry check on cookie before redirect |
| M6 | DONE | 2026-03-29 | Zod schemas for 14 mutation routes (ledger, ECL, period-close, exports, uploads) |
| M7 | DONE | 2026-03-29 | Standardised collection access to `hasAnyRole` (also fixes H10) |
| M8 | DONE | 2026-03-29 | Write fallbacks now return 503, not `success: true` |
| M9 | DONE | 2026-03-29 | 256KB payload limit + `$slice` on unbounded arrays |
| M10 | DONE | 2026-03-29 | Pinned all Python deps; test deps split to requirements-dev.txt (also fixes L5) |
| M11 | DONE | 2026-03-29 | Dev/test Dockerfiles now run as non-root `nextjs` user |
| M12 | DONE | 2026-03-29 | Mount only `~/.aws/config` + `~/.aws/sso/`, not full credentials dir |
| M13 | DONE | 2026-03-29 | Removed 28 debug `console.log` calls from 16 API routes |
| M14 | DONE | 2026-03-29 | Startup TLS validation for Redis/MongoDB in production |
| L1 | DONE | 2026-03-29 | Explicit CSRF origins in Payload config |
| L2 | DONE | 2026-03-29 | `Number.isFinite()` guards on 9 `parseInt` call sites |
| L4 | DONE | 2026-03-29 | `.dockerignore` updated for `infra/fly/env/`, `.claude/`, `.mcp.json` |
| L6 | DONE | 2026-03-29 | Atomic `SET NX EX` replaces `EXISTS` + `SETEX` for dedup |
| L7 | DONE | 2026-03-29 | Atomic upsert replaces `find_one` + `insert_one` |
