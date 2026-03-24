# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Billie CRM is an internal staff servicing application for managing customer loan accounts at Billie (Australian small amount lender). Built on **Payload CMS v3.45.0** (Next.js 15) with a **Python event processor** that consumes domain events via Redis.

## Commands

### Development
```bash
pnpm install              # Install dependencies
pnpm dev                  # Start dev server (http://localhost:3000)
pnpm build                # Production build (uses --max-old-space-size=8000)
pnpm generate:types       # Regenerate Payload types (src/payload-types.ts)
pnpm generate:importmap   # Regenerate Payload import map
pnpm lint                 # ESLint
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
1. **Payload CMS (Next.js)** — Staff UI + API routes + gRPC client for the accounting ledger
2. **Python Event Processor** — Consumes events from Redis (`inbox:billie-srv`), writes to MongoDB using Billie Event SDKs

### Data flow
- **Reads**: Payload reads from MongoDB (collections) and gRPC (ledger service for transactions/balances)
- **Writes to MongoDB**: Only the Python event processor writes domain data (accounts, customers, conversations) — Payload treats these collections as read-only projections
- **Writes to Ledger**: Payload API routes call gRPC to post transactions (repayments, fees, write-offs, adjustments)

### Key architectural patterns

**Custom views inside Payload admin**: The app extends Payload's admin UI with custom views (dashboard, servicing, approvals, collections, period-close, etc.) registered in `payload.config.ts` under `admin.views`. These render inside the Payload admin template (with sidebar nav).

**Providers wrapper**: `src/providers/index.tsx` wraps all admin pages with React Query, toast notifications, global command palette (Cmd+K), read-only mode sync, and session guard.

**React Query hooks**: All data fetching uses TanStack React Query. Hooks are organized in `src/hooks/queries/` (reads) and `src/hooks/mutations/` (writes). Barrel-exported from `src/hooks/index.ts`.

**Zustand stores**: Client state managed via Zustand stores in `src/stores/` (UI state, failed actions queue, optimistic updates, version conflicts, recent customers).

**Role-based access**: Four roles — `admin`, `supervisor`, `operations`, `readonly`. Access helpers in `src/lib/access.ts`. Non-admin users cannot see raw Payload collections in the sidebar.

**Middleware workaround**: `src/middleware.ts` intercepts `/admin` and `/admin/login` to fix a Payload 3.45.0 redirect loop bug. Routes authenticated users to `/admin/dashboard`.

### Server-side clients (`src/server/`)
- `grpc-client.ts` — gRPC client for the external AccountingLedgerService (transactions, balances, statements, posting operations)
- `redis-client.ts` — Redis connection for event publishing
- `event-publisher.ts` — Publishes commands/events to Redis
- `s3-client.ts` — AWS S3 client for document storage

## Code Conventions

- **Package manager**: pnpm
- **Path aliases**: `@/*` maps to `./src/*`, `@payload-config` maps to `./src/payload.config.ts`
- **Formatting**: Prettier — single quotes, no semicolons, trailing commas, 100 char width
- **Test files**: Unit tests in `tests/unit/**/*.test.ts(x)`, integration tests in `tests/int/**/*.int.spec.ts`, e2e in `tests/e2e/`
- **Vitest config**: Tests run sequentially (no file parallelism) to avoid MongoDB race conditions
- **Generated files**: `src/payload-types.ts` and `src/app/(payload)/admin/importMap.js` are auto-generated — run `pnpm generate:types` and `pnpm generate:importmap` after changing collections

## Environment

Requires MongoDB, Redis, and optionally the gRPC ledger service running locally. See `.env` for connection strings. When running in Docker, use `host.docker.internal` instead of `localhost`.
