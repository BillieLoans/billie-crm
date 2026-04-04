# Billie CRM -- Project Overview

## Executive Summary

Billie CRM is an internal staff servicing application for managing customer loan accounts at Billie, an Australian small amount lender. The system is built as an **event-driven hybrid monolith** with a CQRS-like read/write split, comprising two main parts:

1. **Billie CRM Web** -- a Next.js 15 application built on Payload CMS 3.45.0 that provides the staff UI, API layer, and gRPC integration with the accounting ledger.
2. **Event Processor** -- a Python daemon that consumes domain events from Redis Streams and writes projections to MongoDB.

The application provides a single customer view, loan account management, transaction history, approval workflows (write-offs, fee waivers, adjustments), period-close operations, ECL (Expected Credit Loss) configuration, and customer communications visibility. It is deployed on Fly.io across four environments (dev, demo, staging, prod) in the Sydney region.

---

## Architecture

### System Design

The architecture follows a **CQRS-like read/write split** pattern:

- The **Next.js/Payload CMS** application handles all reads (from MongoDB and gRPC) and serves the staff-facing UI. It publishes CRM-originated events to Redis but does **not** directly mutate domain data in MongoDB.
- The **Python Event Processor** is the sole writer to domain collections in MongoDB. It consumes events from both external systems (via `inbox:billie-servicing`) and internal CRM commands (via `inbox:billie-servicing:internal`).
- Financial operations (repayments, fees, write-offs, disbursements, adjustments) are executed via **gRPC** calls to the external AccountingLedgerService.

### Two-Process System

```
                        +-------------------+
                        |   Staff Browser   |
                        +--------+----------+
                                 |
                        +--------v----------+
                        | Next.js 15 +      |
                        | Payload CMS 3.45  |
                        | (App Router)      |
                        +--+------+------+--+
                           |      |      |
              +------------+  +---+---+  +------------+
              |               |       |               |
     +--------v--------+  +--v---+ +-v---------+  +--v-----------+
     | MongoDB          |  | gRPC | | Redis     |  | AWS S3       |
     | (read-only       |  | ---> | | Streams   |  | (documents)  |
     |  projections)    |  | Ledger | (events)  |  +--------------+
     +--------+---------+  +------+ +-----+-----+
              ^                           |
              |                    +------v--------+
              +--------------------+ Python Event  |
                   writes          | Processor     |
                                   +---------------+
```

### Key Architectural Patterns

- **Custom admin views**: Dashboard, servicing, approvals, collections, period-close, ECL config, exports, and investigation views registered inside the Payload admin template.
- **Providers wrapper**: `src/providers/index.tsx` wraps all admin pages with React Query, toast notifications (sonner), command palette (Cmd+K), read-only mode sync, ledger status indicator, failed actions badge, and session guard.
- **React Query hooks**: All data fetching uses TanStack React Query -- 29 query hooks in `src/hooks/queries/` and 21 mutation hooks in `src/hooks/mutations/`.
- **Zustand stores**: 6 client-side stores in `src/stores/` managing UI state, failed actions queue, optimistic updates, version conflicts, and recent customers.
- **Event sourcing**: Write-off workflow uses a command/event pattern via Redis, with at-least-once delivery, deduplication, and a dead-letter queue.

---

## Technology Stack

### Billie CRM Web (TypeScript)

| Category | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 15.3.9 |
| CMS | Payload CMS | 3.45.0 |
| UI Library | React | 19.1.0 |
| Language | TypeScript | 5.7.3 |
| Database Driver | @payloadcms/db-mongodb | 3.45.0 |
| State Management | Zustand | 5.0.9 |
| Data Fetching | TanStack React Query | 5.90.12 |
| Forms | react-hook-form | 7.68.0 |
| Validation | Zod | 4.1.13 |
| Rich Text Editor | Tiptap | 3.20.0 |
| Auth | jose (JWT), Google OAuth, API keys | 5.x |
| gRPC Client | @grpc/grpc-js | 1.14.1 |
| Redis Client | ioredis | 5.6.1 |
| Cloud Storage | AWS S3 SDK | 3.989.0 |
| Command Palette | cmdk | 1.1.1 |
| Image Processing | sharp | 0.32.6 |
| Toast Notifications | sonner | 2.0.7 |
| Unit/Integration Tests | Vitest | 3.2.3 |
| E2E Tests | Playwright | 1.50.0 |
| Linter | ESLint | 9.16.0 |
| Formatter | Prettier | 3.4.2 |
| Package Manager | pnpm | 9.x / 10.x |
| Node.js | Node.js | >= 20.9.0 |

### Event Processor (Python)

| Category | Technology | Version |
|---|---|---|
| Language | Python | 3.11+ |
| Async MongoDB Driver | Motor | 3.7.1 |
| Redis Client | redis-py | 5.2.1 |
| Validation | Pydantic | 2.10.0 |
| Settings | pydantic-settings | 2.11.0 |
| Structured Logging | structlog | 25.5.0 |
| Event SDKs | billie-event-sdks (accounts v2.7.0, customers v2.0.0, ledger v1.1.0) | Private |
| Testing | pytest | - |
| Linting | ruff | - |
| Type Checking | mypy | - |

---

## Data Flow

### Read Path (Payload CMS -> Staff UI)

1. Staff user requests data via the Payload admin UI or custom views.
2. Payload CMS queries MongoDB for domain data (customers, loan accounts, conversations, applications, write-off requests).
3. For financial data (transactions, balances, accruals), Payload API routes call the **AccountingLedgerService** via gRPC.
4. Results are served to the browser, cached and managed by TanStack React Query.

### Write Path -- Domain Data (Events -> MongoDB)

1. External systems publish domain events to Redis Stream `inbox:billie-servicing`.
2. CRM-originated commands are published by Payload to Redis Stream `inbox:billie-servicing:internal` via `src/server/event-publisher.ts` (with retry and exponential backoff).
3. The Python Event Processor consumes events from both streams.
4. Event handlers (account, customer, conversation, write-off, sanitize) project events into MongoDB collections.
5. Delivery is at-least-once with deduplication and dead-letter queue support.

### Write Path -- Financial Operations (Payload -> gRPC -> Ledger)

1. Staff user initiates a financial action (repayment, fee waiver, write-off, late fee, dishonour fee, adjustment, disbursement).
2. Payload API route (under `src/app/api/ledger/`) calls the AccountingLedgerService via gRPC.
3. The ledger service processes the transaction and returns confirmation.
4. UI updates optimistically via Zustand stores and React Query cache invalidation.

### MongoDB Collections

| Collection | Owner | Access Pattern |
|---|---|---|
| customers | Event Processor (write) | Read-only projection from events |
| loan-accounts | Event Processor (write) | Read-only projection from events |
| conversations | Event Processor (write) | Read-only projection from events |
| write-off-requests | Event Processor (write) | Read-only projection from events |
| applications | Event Processor (write) | Read-only projection from events |
| users | Payload CMS (read/write) | RBAC user management |
| media | Payload CMS (read/write) | File uploads |
| contact-notes | Payload CMS (read/write) | Staff-authored notes |

---

## External Services

| Service | Protocol | Purpose |
|---|---|---|
| AccountingLedgerService | gRPC (proto: `proto/accounting_ledger.proto`) | All financial operations -- repayments, fee waivers, write-offs, late fees, dishonour fees, adjustments, disbursements, balance/transaction queries, accruals |
| Redis Streams | TCP (ioredis / redis-py) | Event sourcing infrastructure -- inbound domain events and CRM-originated commands |
| MongoDB | TCP (Payload adapter / Motor) | Primary data persistence for all collections |
| AWS S3 | HTTPS (AWS SDK) | Document storage (loan agreements, uploaded media) |
| Google OAuth | HTTPS | Staff authentication (SSO) |

### API Surface

The web application exposes **59 route handlers** across 17 domain areas:

- `api/ledger/` -- Financial operations (repayment, waive-fee, write-off, late-fee, dishonour-fee, adjustment, disburse, etc.)
- `api/commands/writeoff/` -- Event-sourced write-off workflow
- `api/customers/`, `api/customer/` -- Customer search and detail
- `api/loan-accounts/` -- Loan account search
- `api/contact-notes/` -- Staff contact notes (CRUD)
- `api/conversations/` -- Customer conversation history
- `api/dashboard/` -- Dashboard aggregations
- `api/period-close/` -- Period close operations
- `api/ecl-config/` -- Expected Credit Loss configuration
- `api/export/` -- Data export jobs
- `api/investigation/` -- Account investigation tools
- `api/pending-disbursements/` -- Disbursement queue
- `api/loan-agreement/` -- Loan agreement documents
- `api/uploads/` -- File upload handling
- `api/health/`, `api/system/` -- Health checks and system status
- `api/realtime/` -- Server-sent events for real-time updates

---

## Security and Access Control

### Authentication

- **JWT tokens** (via `jose` library) for session management.
- **Google OAuth** for staff single sign-on.
- **API keys** for inter-service authentication (e.g., the `service` role for billie-realtime role lookups).
- Middleware (`src/middleware.ts`) intercepts `/admin` and `/admin/login` to handle a Payload 3.45.0 redirect loop bug, routing authenticated users to `/admin/dashboard`.

### Role-Based Access Control

Five roles with hierarchical permissions, defined in `src/lib/access.ts`:

| Role | Permissions | Raw Collection Access |
|---|---|---|
| `admin` | Full system access, approval authority | Yes |
| `supervisor` | Operations + approval authority (write-offs, fee waivers, adjustments) | No |
| `operations` | Day-to-day servicing (repayments, notes, disbursements) | No |
| `readonly` | View-only access | No |
| `service` | API-only, inter-service authentication | N/A |

**Key access helpers:**
- `isAdmin(user)` -- full access check
- `hasApprovalAuthority(user)` -- admin or supervisor (required for write-offs, fee waivers, adjustments)
- `canService(user)` -- admin, supervisor, or operations (required for repayments, notes, disbursements)
- `hasAnyRole(user)` -- any authenticated user with a valid role

Non-admin users cannot see raw Payload collections in the sidebar (`hideFromNonAdmins` pattern).

---

## Deployment

### Infrastructure

- **Platform**: Fly.io
- **Primary region**: Sydney (`syd`)
- **Environments**: dev, demo, staging, prod (separate Fly config files: `fly.dev.toml`, `fly.demo.toml`, `fly.staging.toml`, `fly.prod.toml`)
- **Production**: 2 machines for high availability
- **Container**: Docker with standalone Next.js output (`output: 'standalone'` in `next.config.mjs`)

### Build and Deploy

```bash
# Standard deploy (uses cached SDKs)
make -C infra/fly deploy ENV=demo GITHUB_TOKEN="..."

# Force SDK re-download
make -C infra/fly deploy ENV=demo GITHUB_TOKEN="..." NO_CACHE=1
```

- Private Billie Event SDKs are installed from `github.com/BillieLoans/billie-event-sdks` using a `GITHUB_TOKEN` build secret.
- Build uses `--max-old-space-size=8000` for the Next.js production build.
- The `NEXT_PUBLIC_APP_URL` environment variable must match the server URL for Payload cookie/auth to function correctly.

### Docker

Multiple Dockerfiles are provided for different contexts:
- `Dockerfile` -- Production build
- `Dockerfile.demo` -- Demo environment
- `Dockerfile.dev` -- Local development
- `Dockerfile.test` -- Test runner

---

## Testing

### Strategy

| Layer | Framework | Location | Runner |
|---|---|---|---|
| Unit tests | Vitest + Testing Library | `tests/unit/**/*.test.ts(x)` | `pnpm test:int` |
| Integration tests | Vitest + mongodb-memory-server | `tests/int/**/*.int.spec.ts` | `pnpm test:int` |
| End-to-end tests | Playwright (Chromium) | `tests/e2e/` | `pnpm test:e2e` |
| Test helpers | -- | `tests/utils/` | -- |
| Python tests | pytest | `event-processor/tests/` | `pytest` |
| Python linting | ruff | `event-processor/` | `ruff check .` |

### Configuration

- **Vitest**: Configured in `vitest.config.mts` with jsdom environment. Tests run **sequentially** (no file parallelism) to avoid MongoDB race conditions.
- **Playwright**: Configured in `playwright.config.ts`, targeting Chromium.

### Running Tests

```bash
# All tests (unit + integration + e2e)
pnpm test

# Unit and integration only
pnpm test:int

# E2E only
pnpm test:e2e

# Single test file
pnpm exec vitest run tests/unit/hooks/useWaiveFee.test.ts --config ./vitest.config.mts

# Pattern matching
pnpm exec vitest run -t "pattern" --config ./vitest.config.mts

# Python tests
cd event-processor && pytest
```

---

## Locale

The application is configured for **Australian locale** throughout:

- **Currency**: AUD (Australian Dollar) formatting
- **Date formats**: en-AU conventions
- **Shared formatters**: `src/lib/formatters.ts` provides consistent locale-aware formatting utilities for currency, dates, and numbers across the entire application

---

## Documentation Links

- [Source Tree Analysis](./source-tree-analysis.md)
- [Integration Architecture](./integration-architecture.md)
- [Architecture -- Web](./architecture-billie-crm-web.md)
- [Architecture -- Event Processor](./architecture-event-processor.md)
- [API Contracts](./api-contracts-billie-crm-web.md)
- [Data Models](./data-models-billie-crm-web.md)
- [Development Guide -- Web](./development-guide-billie-crm-web.md)
- [Development Guide -- Event Processor](./development-guide-event-processor.md)
- [Component Inventory](./component-inventory-billie-crm-web.md)
- [PRD](./prd.md)
- [Epics](./epics.md)
