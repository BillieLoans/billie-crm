# Penetration Test Report -- Billie CRM

**Target:** https://crm.billie.loans
**Date:** 2026-03-30
**Methodology:** White-box (source code review + live testing against production)
**Tester:** Red team assessment (authorized by application owner)
**Application:** Payload CMS v3.45.0 on Next.js 15.3.2, deployed on Fly.io behind Cloudflare

---

## Executive Summary

The application demonstrates solid security fundamentals: consistent authentication on API routes, Zod validation on financial mutations, Cloudflare origin verification, CSRF protection, and security headers. However, testing revealed **3 critical, 4 high, 7 medium, and 14 low** severity findings. The two most urgent issues are an **unauthenticated user data leak via `/api/users`** and a **known Next.js RCE vulnerability in the pinned dependency**.

---

## Infrastructure Overview

| Property | Value |
|---|---|
| Application | Payload CMS v3.45.0 on Next.js 15.3.2 |
| Hosting | Fly.io (Sydney region, `syd`) |
| CDN/Proxy | Cloudflare (MEL PoP) |
| Protocol | HTTP/2 over TLS |
| Backend Services | MongoDB, Redis, gRPC (AccountingLedgerService), S3 |

---

## CRITICAL Findings

### C1. Unauthenticated User Enumeration via `/api/users`

**Severity:** CRITICAL
**Confirmed:** Live (production)
**Endpoint:** `GET https://crm.billie.loans/api/users`

The entire user list (names, emails, roles, MongoDB IDs) is readable without authentication:

```
GET /api/users → 200 OK

Response:
{
  "docs": [
    {
      "role": "admin",
      "firstName": "Marcus",
      "lastName": "Korff",
      "email": "marcus@billie.loans",
      "id": "69bbe47cc030e34d34075a70",
      "loginAttempts": 0,
      "sessions": []
    },
    {
      "role": "admin",
      "firstName": "Rohan",
      "lastName": "Sharp",
      "email": "rohan@billie.loans",
      "id": "69bbe41ee8cff6c5af245d3c",
      "loginAttempts": 0,
      "sessions": []
    }
  ]
}
```

Query filtering also works unauthenticated (`?where[role][equals]=admin`, `?limit=10000`), enabling targeted enumeration and bulk extraction.

**Root cause:** `src/collections/Users.ts` -- the `canReadUsers` access function:

```typescript
const canReadUsers: Access = ({ req, id }) => {
  if (isAdmin(req.user)) return true
  return (req.user as { id?: string })?.id === id
}
```

On list queries (no specific `id`), the comparison becomes `undefined === undefined → true`, granting full read access to unauthenticated requests.

**Recommended fix:**

```typescript
const canReadUsers: Access = ({ req, id }) => {
  if (!req.user) return false          // ← deny unauthenticated
  if (isAdmin(req.user)) return true
  return (req.user as { id?: string })?.id === id
}
```

Apply the same fix to `canUpdateUsers` which has the identical bug.

---

### C2. Next.js 15.3.2 RCE Vulnerability (GHSA-9qr9-h5gf-34mp)

**Severity:** CRITICAL
**Confirmed:** Dependency audit (`pnpm audit`)
**Affected package:** `next@15.3.2`

The pinned `next@15.3.2` has a remote code execution vulnerability in the React Flight (Server Components) protocol. Patched in 15.3.6+.

Additionally, `pnpm audit` reports **68 total vulnerabilities** including:

| Severity | Package | Advisory | Impact |
|----------|---------|----------|--------|
| CRITICAL | `next` 15.3.2 | GHSA-9qr9-h5gf-34mp | RCE in React Flight protocol |
| CRITICAL | `fast-xml-parser` 4.4.1, 5.3.4 | GHSA-m7jm-9gc2-mpf2 | Entity encoding bypass via regex injection (transitive via @aws-sdk, mongoose) |
| HIGH | `playwright` 1.50.0 | SSL cert verification bypass during browser download (dev dependency) |
| LOW | `nodemailer` 6.9.16 | SMTP command injection (transitive via @payloadcms/payload-cloud) |

**Note:** Upgrading `next` may require a Payload CMS upgrade since `@payloadcms/next@3.45.0` pins this version.

**Recommended fix:** Upgrade `next` to >=15.3.6. Use `pnpm.overrides` to force `fast-xml-parser` to a patched version.

---

### C3. GraphQL Mutations Accessible Without Authentication

**Severity:** CRITICAL
**Confirmed:** Live (production)
**Endpoint:** `POST https://crm.billie.loans/api/graphql`

While GraphQL introspection is correctly disabled, mutations are processed without requiring authentication. Attempting `createUser` returns validation errors that leak the full schema:

```
POST /api/graphql
Body: mutation { createUser(data: { email: "test@test.com", password: "test" }) { id } }

Response (200 OK):
{
  "errors": [
    {"message": "Field \"mutationUserInput.role\" of required type \"User_role_MutationInput!\" was not provided."},
    {"message": "Field \"mutationUserInput.firstName\" of required type \"String!\" was not provided."},
    {"message": "Field \"mutationUserInput.lastName\" of required type \"String!\" was not provided."}
  ]
}
```

This reveals:
- The `createUser` mutation exists and is reachable without auth
- Required field names and types (`role`, `firstName`, `lastName`)
- Internal type names (`User_role_MutationInput`)

A crafted request supplying all required fields may succeed in creating an admin user.

**Recommended fix:** Either require authentication on the entire `/api/graphql` endpoint, or add mutation-level access control that runs before GraphQL validation.

---

## HIGH Findings

### H1. `/api/access` Exposes Full Permission Schema

**Severity:** HIGH
**Confirmed:** Live (production)
**Endpoint:** `GET https://crm.billie.loans/api/access`

Returns all collection names, field names (including `hash`, `salt`, `resetPasswordToken`, `resetPasswordExpiration`), and read/write permissions to unauthenticated callers. This partially negates the benefit of disabling GraphQL introspection.

```json
{
  "collections": {
    "users": {
      "fields": {
        "hash": {"read": true, "update": true},
        "salt": {"read": true, "update": true},
        "resetPasswordToken": {"read": true, "update": true},
        ...
      }
    }
  }
}
```

**Recommended fix:** Override or restrict the `/api/access` endpoint in Payload config to require authentication.

---

### H2. IDOR on Export Jobs (List / Status / Result / Retry)

**Severity:** HIGH
**Confirmed:** Source code review
**Files:**
- `src/app/api/export/jobs/route.ts:136`
- `src/app/api/export/jobs/[jobId]/route.ts`
- `src/app/api/export/jobs/[jobId]/result/route.ts`
- `src/app/api/export/jobs/[jobId]/retry/route.ts`

The `GET /api/export/jobs` endpoint accepts `userId` as a query parameter and passes it to the gRPC service without verifying it matches the authenticated user. Any authenticated user can list, view, download results from, or retry any other user's export jobs (journal entries, audit trails, methodology reports).

```typescript
const userId = searchParams.get('userId')
// ... no check that userId === auth.user.id
const response = await client.listExportJobs({ userId, limit, includeCompleted })
```

**Recommended fix:** Enforce `userId === String(user.id)` or remove the parameter and always use the authenticated user's ID.

---

### H3. Missing Authorization on Write-Off Cancel

**Severity:** HIGH
**Confirmed:** Source code review
**File:** `src/app/api/commands/writeoff/cancel/route.ts:47-48`

The code comment explicitly acknowledges a missing authorization check:

```typescript
// Note: Authorization check (original requester or supervisor) would require
// looking up the original request. For now, any authenticated user can cancel.
```

Any `operations`-level user can cancel any other user's write-off request, disrupting the approval workflow.

**Recommended fix:** Look up the original write-off request and verify the cancelling user is either the original requester or a supervisor.

---

### H4. Unauthenticated Ledger Health Endpoint Leaks Infrastructure Details

**Severity:** HIGH
**Confirmed:** Live (production)
**Endpoint:** `GET https://crm.billie.loans/api/ledger/health`

Returns gRPC ledger service status, latency measurements, and operational state without authentication:

```json
{"status":"connected","latencyMs":34,"message":"Ledger Connected","checkedAt":"2026-03-29T23:24:46.480Z"}
```

An attacker can poll this to determine when the ledger service is degraded or offline, timing attacks to coincide with service disruption.

**Recommended fix:** Add `requireAuth(hasAnyRole)` to the ledger health endpoint.

---

## MEDIUM Findings

### M1. CSP Allows `unsafe-inline` and `unsafe-eval`

**Severity:** MEDIUM
**File:** `src/middleware.ts:135-138`

```
script-src 'self' 'unsafe-inline' 'unsafe-eval'
```

This significantly weakens XSS protection. If an attacker finds any injection point, the CSP will not block inline script execution or `eval()`.

**Recommended fix:** Use nonce-based CSP (`script-src 'self' 'nonce-{random}'`). Remove `unsafe-eval` in production if Payload CMS allows.

---

### M2. CSRF Bypass When Neither Origin Nor Referer Header Present

**Severity:** MEDIUM
**File:** `src/middleware.ts:96-98`

```typescript
if (!origin && !referer) return null  // allows the request
```

When neither header is present, CSRF protection is completely bypassed. While modern browsers typically send `Origin`, some configurations (extensions, proxies, older browsers) can suppress both headers.

**Recommended fix:** Deny mutation requests lacking both headers unless they contain a custom CSRF token (e.g., `X-CSRF-Token`).

---

### M3. CSRF Bypass When `NEXT_PUBLIC_APP_URL` Is Unset

**Severity:** MEDIUM
**File:** `src/middleware.ts:91`

```typescript
const appUrl = process.env.NEXT_PUBLIC_APP_URL
if (!appUrl) return null  // silently disables all CSRF validation
```

If `NEXT_PUBLIC_APP_URL` is accidentally unset during deployment, all CSRF protection is silently disabled.

**Recommended fix:** Fail closed -- block mutation requests if `NEXT_PUBLIC_APP_URL` is not set.

---

### M4. No Rate Limiting on Any Endpoint

**Severity:** MEDIUM
**Confirmed:** Source code review (global)

No rate limiting exists anywhere in the codebase -- no middleware, no per-IP throttles, no per-user limits.

**Highest-risk unthrottled endpoints:**
- `POST /api/ledger/repayment` -- could flood the ledger with transactions
- `POST /api/ledger/disburse` -- could attempt rapid disbursements
- `POST /api/commands/writeoff/request` -- could spam write-off requests
- `GET /api/customer/search` -- could enumerate all customer records
- `POST /api/users/login` -- no brute-force protection (mitigated by Payload lockout after N attempts)

**Recommended fix:** Add rate limiting middleware, at minimum on financial and search endpoints.

---

### M5. PAYLOAD_SECRET Build Placeholder Fallback

**Severity:** MEDIUM
**File:** `src/payload.config.ts:112`

```typescript
secret: process.env.PAYLOAD_SECRET || 'build-placeholder-not-for-production',
```

Falls back to a known string when `PAYLOAD_SECRET` is not set. This secret signs JWTs for authentication. The middleware does block requests when the placeholder is detected (lines 142-150), but if the middleware is ever bypassed, JWTs could be forged.

**Recommended fix:** Throw an error at startup if `PAYLOAD_SECRET` is not set in production, rather than using a fallback.

---

### M6. Missing Zod Validation on 6 Routes

**Severity:** MEDIUM
**Files:**
- `src/app/api/ecl-config/schedule/route.ts`
- `src/app/api/investigation/batch-query/route.ts`
- `src/app/api/investigation/sample/route.ts`
- `src/app/api/ledger/ecl/recalc/bulk/route.ts`
- `src/app/api/ledger/ecl/recalc/portfolio/route.ts`
- `src/app/api/ecl-config/pending/[changeId]/route.ts`

These routes cast `request.json()` directly to TypeScript interfaces (`as T`) without runtime validation. Malformed payloads pass through to gRPC calls. The `ecl-config/schedule` route reflects `body.parameter` in error messages.

**Recommended fix:** Replace TypeScript interface casts with Zod schemas consistent with the rest of the codebase.

---

### M7. Cloudflare Secret Check Disabled in Non-Production

**Severity:** MEDIUM
**File:** `src/middleware.ts:14-36`

When `CF_SECRET` is not set and `NODE_ENV !== 'production'`, the Cloudflare origin check is bypassed. If a staging/demo environment is publicly accessible but `NODE_ENV` is not `production`, all routes are accessible without going through Cloudflare.

**Note:** Demo environment explicitly sets `DISABLE_CF_SECRET_CHECK=true` in `infra/fly/fly.demo.toml:34` (acknowledged risk).

---

## LOW Findings

| # | Finding | Location | Notes |
|---|---------|----------|-------|
| L1 | `X-Powered-By: Next.js, Payload` -- technology fingerprinting | Response headers | Remove with `poweredByHeader: false` in `next.config.mjs` |
| L2 | `Via: 1.1 fly.io` -- origin infrastructure disclosure | Response headers | Added by Cloudflare; harder to suppress |
| L3 | HSTS missing `preload` directive | Response headers | Consider adding for HSTS preload list |
| L4 | Default Payload template metadata ("Payload Blank Template") | HTML `<title>` | Update to "Billie CRM" |
| L5 | PII (customer full names) logged in Python event processor | `event-processor/.../customer.py:91` | Remove `full_name` from log fields |
| L6 | DLQ entries contain full event payloads (including PII), no size limit or TTL | `event-processor/.../processor.py:612` | Add `maxlen` to DLQ `xadd()`, scrub PII |
| L7 | `strip_dollar_keys()` only strips top-level -- nested `$`-operators pass through | `event-processor/.../sanitize.py:34` | Implement recursive stripping |
| L8 | Chat/conversation events have no Pydantic schema validation (raw dict path) | `event-processor/.../processor.py:601` | Add Pydantic models for chat events |
| L9 | gRPC insecure credentials match is loose -- `url.includes('.internal')` matches `evil.internal.attacker.com` | `src/server/grpc-client.ts:990` | Use stricter regex: `/\.internal(:\d+)?$/` |
| L10 | Redis connection doesn't enforce TLS in production | `src/server/redis-client.ts:18` | Add startup check for `rediss://` scheme |
| L11 | S3 `getObjectByUri` uses bucket from URI, not configured bucket | `src/server/s3-client.ts:97` | Validate bucket matches `S3_BUCKET_NAME` |
| L12 | `getUserRole` doesn't validate role enum value | `src/lib/access.ts:19` | Add `validRoles.includes(role)` check |
| L13 | Staging `NODE_ENV=staging` bypasses production security checks | `infra/fly/fly.staging.toml:26` | Set to `production` or add staging to middleware checks |
| L14 | JWT expiry check in middleware without signature verification (Edge runtime limitation) | `src/middleware.ts:65-76` | Document as accepted risk; ensure no sensitive data rendered without server-side auth |

---

## Positive Security Observations

The following security controls were verified and found to be correctly implemented:

- **57 of 59 API routes require authentication** -- consistent `requireAuth()` pattern
- **Zod validation on all financial mutations** (repayment, write-off, adjustment, disburse, fees)
- **Cloudflare origin verification** with fail-closed behavior in production
- **GraphQL introspection disabled** in production
- **No `eval`, `exec`, `child_process`, or `dangerouslySetInnerHTML`** anywhere in source code
- **Docker images run as non-root** (user `nextjs`, UID 1001)
- **Tiptap rich text renders as React elements** (JSX), not raw HTML -- XSS-safe
- **Link sanitization in Tiptap** -- only `https?://` hrefs rendered, `javascript:` URIs rejected
- **S3 presigned URLs validate content type** against an allowlist
- **S3 path traversal prevention** -- filenames and account numbers sanitized
- **Server-derived user identity** for financial attribution (not from client input)
- **Idempotency keys** on financial operations (server-generated)
- **Redis credentials redacted** in logs
- **MongoDB NoSQL injection prevention** via `safe_str()` in Python processor
- **Event deduplication** via atomic `SET NX` with 24-hour TTL
- **First-register and forgot-password endpoints locked down** (403)
- **No hardcoded secrets** in source code -- all credentials from environment variables
- **`.env*.local` in `.gitignore`** -- secrets not committed
- **CORS restricted** to single origin (application URL only)
- **Generic login error messages** -- does not distinguish invalid email vs invalid password
- **Payload cookie config** -- `httpOnly`, `sameSite: Lax`, `secure` when HTTPS (via Payload defaults)
- **Bounded array growth** in MongoDB -- `$push` with `$slice` on utterances (2000), noticeboard (500)
- **Payload size limiting** -- 256KB max on event processor before handler execution
- **Docker BuildKit secrets** for GitHub token (not baked into image layers)
- **UserSessionGuard** clears client-side stores on user session change (prevents cross-user data leakage)

---

## Recommended Remediation Priority

| Priority | Action | Effort |
|----------|--------|--------|
| **P0 -- Today** | Fix `canReadUsers` / `canUpdateUsers` in `src/collections/Users.ts` -- add `if (!req.user) return false`. Deploy immediately. | 10 min |
| **P0 -- Today** | Restrict GraphQL endpoint -- require auth on `/api/graphql` or add mutation-level access control. | 30 min |
| **P1 -- This week** | Upgrade `next` to >=15.3.6 to patch RCE (coordinate with Payload CMS compatibility). | 2-4 hrs |
| **P1 -- This week** | Fix IDOR on export jobs -- enforce `userId === auth.user.id`. | 30 min |
| **P1 -- This week** | Restrict `/api/access` endpoint to authenticated users. | 30 min |
| **P2 -- Next sprint** | Add rate limiting (at minimum on login, search, and financial mutation endpoints). | 4-8 hrs |
| **P2 -- Next sprint** | Add Zod validation to the 6 unvalidated routes. | 2 hrs |
| **P2 -- Next sprint** | Fix write-off cancel authorization (verify original requester or supervisor). | 1 hr |
| **P2 -- Next sprint** | CSRF hardening -- fail closed when `NEXT_PUBLIC_APP_URL` unset; deny mutations without Origin/Referer. | 1 hr |
| **P3 -- Backlog** | Tighten CSP (nonce-based, remove `unsafe-eval`). | 2-4 hrs |
| **P3 -- Backlog** | Add explicit cookie security settings in Payload config. | 15 min |
| **P3 -- Backlog** | Fix gRPC `.internal` matching regex. | 15 min |
| **P3 -- Backlog** | Enforce Redis TLS in production. | 15 min |
| **P3 -- Backlog** | Python event processor -- add Pydantic models for chat events, recursive `$`-key stripping, PII scrubbing in logs/DLQ. | 4 hrs |
| **P3 -- Backlog** | Remove `X-Powered-By` header, update page title from default. | 10 min |

---

## Comparison with Prior Audits

This is the third security audit for Billie CRM:

| Date | Findings | Notes |
|------|----------|-------|
| 2026-03-27 | 36 findings | Initial security audit; remediation completed 2026-03-28/29 |
| 2026-03-29 | Follow-up | Verified remediation of initial findings |
| **2026-03-30** | **28 findings (3C, 4H, 7M, 14L)** | Penetration test with live testing; discovered C1 (users endpoint) was missed by prior audits |

The `canReadUsers` vulnerability (C1) was **not caught** in the March 27 audit despite that audit fixing similar access control issues on other collections. The Users collection was presumably considered safe because it had explicit access functions rather than `() => true`, but the `undefined === undefined` edge case on list queries was missed.
