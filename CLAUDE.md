# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Billie CRM is an internal staff servicing application for managing customer loan accounts at Billie (Australian small amount lender). Built on **Payload CMS v3.45.0** (Next.js 15) with a **Python event processor** that consumes domain events via Redis. The data layer is **Postgres** (`@payloadcms/db-postgres` adapter on the Node side, `asyncpg` on the Python side). Deployed on Fly.io.

## Commands

### Development
```bash
pnpm install              # Install dependencies
pnpm dev                  # Start dev server (http://localhost:3000)
pnpm build                # Production build (uses --max-old-space-size=8000)
pnpm generate:types       # Regenerate Payload types (src/payload-types.ts)
pnpm generate:importmap   # Regenerate Payload import map
pnpm lint                 # ESLint
pnpm devsafe              # Nuke .next cache then start dev server
```

### Testing
```bash
pnpm test:int                                    # Run unit + integration tests (vitest)
pnpm test:e2e                                    # Run e2e tests (Playwright, Chromium)
pnpm test                                        # Run both int + e2e

# Run a single test file
pnpm exec vitest run tests/unit/hooks/useWaiveFee.test.ts --config ./vitest.config.mts

# Run tests matching a pattern
pnpm exec vitest run -t "pattern" --config ./vitest.config.mts
```

### Deployment (Fly.io)
```bash
make -C infra/fly deploy ENV=demo GITHUB_TOKEN="..."              # Deploy with cached SDKs
make -C infra/fly deploy ENV=demo GITHUB_TOKEN="..." NO_CACHE=1   # Force SDK re-download
```

`deploy` first applies pending Payload migrations to the target env's Neon DB (idempotent —
recorded in `payload_migrations`), then rolls the image. `SKIP_MIGRATE=1` bypasses the
migration step. Schema changes need a committed migration (`make -C infra/fly pg-migrate-create
ENV=dev NAME=...` against a local Postgres) — dev/test environments use `push: true` instead.

### Event Processor (Python)
```bash
cd event-processor
pip install -r requirements.txt
python -m billie_servicing.main    # Run standalone
pytest                              # Run Python tests
ruff check .                        # Lint Python
```

## Architecture

### Two-process system
1. **Payload CMS (Next.js)** — Staff UI + API routes + gRPC client for the accounting ledger. Talks to Postgres via the `@payloadcms/db-postgres` adapter (`pg.Pool` under the hood).
2. **Python Event Processor** — Consumes events from Redis (`inbox:billie-servicing`), writes to Postgres via `asyncpg` using the Billie Event SDKs (installed from `github.com/BillieLoans/billie-event-sdks`) as Pydantic parsers.

### Data flow — read/write split
- **Reads**: Payload reads from Postgres (collections) and gRPC (ledger service for transactions/balances).
- **Writes to Postgres**: Only the Python event processor writes domain data (accounts, customers, conversations) — Payload treats these collections as **read-only projections** via `create/update/delete: () => false` access. Do not add Payload hooks or API routes that mutate these collections directly.
- **Writes to Ledger**: Payload API routes (`src/app/api/ledger/`) call gRPC to post transactions (repayments, fees, write-offs, adjustments).
- **CRM-originated events**: Payload publishes events to Redis stream `inbox:billie-servicing:internal` via `src/server/event-publisher.ts`. The Python processor consumes these alongside external events.

### Schema and the `afterSchemaInit` hook
Payload's pg adapter generates child tables for `type: 'array'` fields and flattens `type: 'group'` into columns. A few constraints can't be expressed in the collection config and live in `payload.config.ts`'s `afterSchemaInit` hook:
- Composite unique on `loan_accounts_repayment_schedule_payments (_parent_id, payment_number)` — natural key for the Python upserts.
- Compound btree indexes on `conversations(status, decision_status, updated_at DESC)` and `(customer_id_string, updated_at DESC)` for the monitoring grid.

### Key architectural patterns

**Custom views inside Payload admin**: The app extends Payload's admin UI with custom views (dashboard, servicing, approvals, collections, period-close, ecl-config, exports, investigation, etc.) registered in `payload.config.ts` under `admin.views`. These render inside the Payload admin template (with sidebar nav). Custom nav links are registered via `admin.components.beforeNavLinks`.

**Providers wrapper**: `src/providers/index.tsx` (must be the default export) wraps all admin pages with React Query, toast notifications (sonner), global command palette (Cmd+K), read-only mode sync, ledger status indicator, failed actions badge, and session guard. Registered in payload config as `admin.components.providers`.

**React Query hooks**: All data fetching uses TanStack React Query. Hooks are organized in `src/hooks/queries/` (reads) and `src/hooks/mutations/` (writes). Barrel-exported from `src/hooks/index.ts`. New hooks should follow the existing pattern and be added to the barrel export.

**Zustand stores**: Client state managed via Zustand stores in `src/stores/` (UI state, failed actions queue, optimistic updates, version conflicts, recent customers).

**Role-based access**: Four roles — `admin`, `supervisor`, `operations`, `readonly`. Access helpers in `src/lib/access.ts`. Non-admin users cannot see raw Payload collections in the sidebar (`hideFromNonAdmins`). Approval actions require `hasApprovalAuthority` (admin or supervisor).

**Middleware workaround**: `src/middleware.ts` intercepts `/admin` and `/admin/login` to fix a Payload 3.45.0 redirect loop bug. Routes authenticated users to `/admin/dashboard`. TODO in code to remove when Payload is upgraded.

**Locale**: Australian locale throughout — AUD currency, en-AU date formats. Use shared formatters from `src/lib/formatters.ts`.

### Server-side clients (`src/server/`)
- `grpc-client.ts` — gRPC client for the external AccountingLedgerService. Proto definition at `proto/accounting_ledger.proto`.
- `redis-client.ts` — Redis connection for event publishing
- `event-publisher.ts` — Publishes commands/events to Redis with retry + exponential backoff
- `s3-client.ts` — AWS S3 client for document storage

### API routes (`src/app/api/`)
Ledger operations live under `api/ledger/` (repayment, waive-fee, write-off, late-fee, dishonour-fee, adjustment, disburse, etc.). Other routes handle customer search, conversations, contact notes, dashboard, exports, system health, and realtime events. Write-off commands use event sourcing via `api/commands/writeoff/`.

## Code Conventions

- **Package manager**: pnpm
- **Path aliases**: `@/*` maps to `./src/*`, `@payload-config` maps to `./src/payload.config.ts`
- **Formatting**: Prettier — single quotes, no semicolons, trailing commas, 100 char width (`.prettierrc.json`)
- **Validation**: Zod v4 for runtime schemas (`src/lib/schemas/`)
- **Forms**: react-hook-form with `@hookform/resolvers` (Zod)
- **Rich text**: Tiptap editor for contact notes / conversation display
- **Next.js config**: Uses `withPayload()` wrapper in `next.config.mjs`, standalone output for Docker
- **Test files**: Unit tests in `tests/unit/**/*.test.ts(x)`, integration tests in `tests/int/**/*.int.spec.ts`, e2e in `tests/e2e/`. Test helpers in `tests/utils/`.
- **Vitest config**: `tests/utils/globalSetup.ts` spins up a real Postgres container via `@testcontainers/postgresql` and runs Payload's `push:true` schema sync before any test executes. Tests run sequentially (no file parallelism) since the pg pool is shared. Uses jsdom environment.
- **Generated files**: `src/payload-types.ts` and `src/app/(payload)/admin/importMap.js` are auto-generated — run `pnpm generate:types` and `pnpm generate:importmap` after changing collections or registered components

## Environment

Requires Postgres (Neon in prod, local Docker container in dev), Redis, and optionally the gRPC ledger service running locally. `DATABASE_URI` uses the standard libpq URL format (`postgresql://user:pass@host:port/db?sslmode=verify-full`) — same string works for both the Payload pg adapter and the Python `asyncpg.create_pool`. Prefer `verify-full` over `require`: it validates the cert chain and hostname (works out of the box against Neon's public cert) and avoids the `pg` v9 change where bare `require` will silently stop verifying. For a non-TLS local Postgres, drop the param (or use `sslmode=disable`). When running in Docker, use `host.docker.internal` instead of `localhost`. The `NEXT_PUBLIC_APP_URL` env var must match the server URL for Payload cookie/auth to work correctly.

The event-processor's `db.py` exposes shared helpers (`upsert`, `update_by_key`, `upsert_conversation`, `merge_jsonb`, `coerce_date`) used by every handler — when writing new handlers, prefer these over raw SQL to keep upsert semantics, version-increment, and date coercion consistent.
