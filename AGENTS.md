# Agent context — CRM

Read `CLAUDE.md`. This is a production staff servicing application.

Verified 2026-09-07 at 57b0d16:
- Current storage is Postgres, not MongoDB as described by the older README.
  Next/Payload uses its Postgres adapter; Python projection handlers use asyncpg.
- Domain collections are projections; financial commands go through gRPC and
  CRM-originated events. Preserve collection access rules and approval separation.
- API routes should use `requireAuth` with the relevant role predicate from
  `src/lib/access.ts`; `marketing` and `service` are excluded from lending access.
- `src/proxy.ts` provides origin and CSRF checks. They do not replace route auth.
- `Users.ts` includes custom JWT auth; consider session revocation as well as
  signature/expiry when changing authentication.
- Production config runs at least two machines, each with event processing enabled.
  Message ordering/idempotency must work across processes.
- Tests' global setup starts isolated Postgres via Testcontainers. Inspect setup
  before tests; do not substitute a production DATABASE_URI.

Cross-repository audit/architecture: `../billie-platform-services/docs/audit-2026-09-07/`. Changes to Payload
schema require migrations compatible with Python SQL and regenerated types.
