# Billie CRM -- Penetration Test Report (Post-Hardening)

**Target:** crm.billie.loans (source code audit)
**Date:** 2026-03-29
**Scope:** Full application -- Payload CMS (Next.js), Python event processor, infrastructure
**Context:** Re-audit after comprehensive security hardening of all 36 findings from the 2026-03-27 audit

---

## Executive Summary

The application has been **significantly hardened** since the initial audit. All 5 Critical and 9 of 10 High findings have been fully resolved. All 14 Medium and 7 Low findings have been addressed. The re-audit found **no Critical or High vulnerabilities**. The remaining findings are 3 Medium, 7 Low, and 3 Informational issues -- representing residual hardening opportunities rather than exploitable attack vectors.


| Severity | Found | Remediated | Remaining                                |
| -------- | ----- | ---------- | ---------------------------------------- |
| Critical | 0     | --         | 0                                        |
| High     | 0     | --         | 0                                        |
| Medium   | 3     | 3          | 0                                        |
| Low      | 7     | 7          | 0                                        |
| Info     | 3     | 1 (I1)     | 2 (framework trade-offs, not actionable) |


---

## Medium Findings

### M1: `cancelledBy` in ECL Config Cancellation Not Session-Derived -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Action taken:** Replaced `body.cancelledBy` with `String(user.id)` from the authenticated session. Removed the `cancelledBy` body validation check since it's no longer client-supplied.

---

### M2: `triggeredBy` in ECL Recalc Routes Not Session-Derived -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Action taken:** Both routes now derive `triggeredBy` from `String(user.id)` via the authenticated session. The user name lookup now uses the session user ID instead of a client-supplied value. Removed unused `getPayload`/`configPromise` imports (payload now comes from `requireAuth`).

---

### M3: Write-Off Request Submission Has No Role Check -- REMEDIATED 2026-03-29

**Severity:** MEDIUM
**Status:** RESOLVED

**Action taken:** Refactored to use `requireAuth(canService)`. Also refactored writeoff cancel route (`L1`) to use `requireAuth(canService)`. Both routes previously used inline `payload.auth()` without role checks -- now use the standard `requireAuth` pattern with `canService` access level. Readonly users can no longer submit or cancel write-off requests.

---

## Low Findings

### L1: Write-Off Cancel Has No Role Check -- REMEDIATED 2026-03-29

**Severity:** LOW
**Status:** RESOLVED (fixed as part of M3 remediation)

**Action taken:** Refactored to use `requireAuth(canService)`. Readonly users can no longer cancel write-off requests.

---

### L2: Raw `error.message` Leaked in Contact Notes Amend -- REMEDIATED 2026-03-30

**Severity:** LOW
**Status:** RESOLVED

**Action taken:** Changed to return `'An unexpected error occurred.'` unconditionally.

---

### L3: Raw gRPC Details Leaked in Disburse Route -- REMEDIATED 2026-03-30

**Severity:** LOW
**Status:** RESOLVED

**Action taken:** Replaced `grpcDetails` with hardcoded user-friendly message.

---

### L4: Zod Schemas Exist But Not Applied to Some Routes -- REMEDIATED 2026-03-30

**Severity:** LOW
**Status:** RESOLVED

**Action taken:** Applied existing Zod schemas to all 3 routes (late-fee, dishonour-fee, disburse). Ad-hoc validation replaced with `.safeParse()`. Financial amounts now validated by `positiveDecimalString` regex.

---

### L5: Assessment Data Stored Without `strip_dollar_keys()` -- REMEDIATED 2026-03-30

**Severity:** LOW
**Status:** RESOLVED

**Action taken:** Wrapped `event.get("payload") or event` with `strip_dollar_keys()` before storing.

---

### L6: `$push` Without `$slice` on Schedule Payments -- REMEDIATED 2026-03-30

**Severity:** LOW
**Status:** RESOLVED

**Action taken:** Added `$slice: 100` to the `$push` operation for placeholder payments (loans never exceed ~52 weekly payments).

---

### L7: Event Processor Dockerfile Runs as Root -- REMEDIATED 2026-03-30

**Severity:** LOW
**Status:** RESOLVED

**Action taken:** Added `appgroup`/`appuser` (GID/UID 1001) with `chown` and `USER appuser` before CMD.

---

## Informational

### I1: Dockerfile.test Placeholder String Mismatch -- REMEDIATED 2026-03-30

**Status:** RESOLVED

**Action taken:** Aligned `Dockerfile.test` placeholder to `build-placeholder-not-for-production` (matching `payload.config.ts` and `middleware.ts`).

---

### I2: CSP Uses `unsafe-inline` and `unsafe-eval`

**File:** `src/middleware.ts` (line 137)

Required by Payload CMS and Next.js. Acceptable trade-off for an internal staff application behind authentication and Cloudflare.

---

### I3: Export Jobs Listing Accepts `userId` from Query String

**File:** `src/app/api/export/jobs/route.ts` (GET handler)

An authenticated user could pass another user's ID to view their export jobs. Low risk in an internal staff tool.

**Remediation:** Consider using `String(auth.user.id)` or adding admin-only override.

---

## Positive Findings (Verified Secure)

**Authentication:** All 49 API routes (excluding 2 health checks) call `requireAuth()` with appropriate role-based access checks. The utility correctly uses Payload's cookie-based auth.

**Role-Based Access Control:** Three-tier access model consistently applied -- `hasAnyRole` for reads, `canService` for operations, `hasApprovalAuthority` for sensitive mutations.

**Privilege Escalation Prevention:** `role` field has field-level access control restricting updates to admins only. Default role is `readonly`.

**CSRF Protection:** Origin header validation on all mutation requests. Payload config has explicit `csrf` origins.

**Content Security Policy:** `frame-ancestors 'none'`, strict `default-src 'self'`, with only the minimum framework-required exceptions.

**JWT Validation:** Middleware checks `exp` claim before redirect decisions. Full signature verification happens at the route level via `payload.auth()`.

**Cloudflare Origin Check:** Fails closed in production when `CF_SECRET` is unset.

**Identity Fields:** All identity fields (approvedBy, createdBy, finalizedBy, etc.) derived from authenticated session in 13 of 15 write routes. Two exceptions noted above (M1, M2).

**Financial Amount Validation:** Zod schemas enforce `positiveDecimalString` regex for amounts. Adjustment deltas correctly allow negatives.

**Error Response Hygiene:** 44 routes return generic error messages. Two exceptions noted above (L2, L3).

**XSS Prevention:** Tiptap link renderer validates `https?://` protocol. `javascript:`, `data:`, `vbscript:` URIs are silently dropped.

**S3 Path Traversal Prevention:** Both `accountNumber` and `fileName` sanitised. Account existence verified before presigned URL generation.

**NoSQL Injection Prevention:** `safe_str()` applied to all conversation/writeoff handler query filter values. `strip_dollar_keys()` applied to `applicationData`.

**Credential Redaction:** Redis URL and MongoDB URI redacted in both Node.js and Python log output.

**Docker Security:** All Dockerfiles (except `event-processor/Dockerfile`) use non-root users and `--mount=type=secret` for GitHub tokens.

**Dependency Pinning:** Python dependencies pinned to exact versions. Test deps separated from production.

**Dedup Atomicity:** Uses Redis `SET NX EX` (atomic). No TOCTOU race.

**Bounded Arrays:** `$push` with `$slice` on utterances (2000) and noticeboard (500). Payload size limit (256KB) enforced before processing.

---

## Remediation Priority


| Priority | Items      | Action                                              |
| -------- | ---------- | --------------------------------------------------- |
| ~~1~~    | ~~M1, M2~~ | ~~Replace client-supplied identity fields~~ DONE    |
| ~~2~~    | ~~M3, L1~~ | ~~Add role checks to writeoff request/cancel~~ DONE |
| ~~3~~    | ~~L2, L3~~ | ~~Fix two remaining error message leaks~~ DONE      |
| ~~4~~    | ~~L4~~     | ~~Apply existing Zod schemas to 3 routes~~ DONE     |
| ~~5~~    | ~~L5, L6~~ | ~~Python handler hardening~~ DONE                   |
| ~~6~~    | ~~L7, I1~~ | ~~Dockerfile fixes~~ DONE                           |


