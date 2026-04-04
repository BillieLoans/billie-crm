# Development Guide: Billie CRM Web

## Prerequisites

- **Node.js** 20+ (engines: `^18.20.2 || >=20.9.0`)
- **pnpm** 9+ or 10+ (engines: `^9 || ^10`)
- **MongoDB** (local instance or Docker)
- **Redis** (local instance or Docker)
- **Optional**: gRPC ledger service (`AccountingLedgerService` on port 50051) -- the app works in degraded mode without it; ledger-related features will be unavailable but everything else functions normally

## Installation

```bash
pnpm install
```

pnpm is the only supported package manager. The `pnpm.onlyBuiltDependencies` field restricts native builds to `sharp`, `esbuild`, and `unrs-resolver`.

## Environment Setup

There is no `.env.example` checked in. Create a `.env` file in the project root with at least the following:

```env
# Required
DATABASE_URI=mongodb://localhost:27017/billie-servicing
PAYLOAD_SECRET=any-long-random-string
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Optional -- needed for full functionality
REDIS_URL=redis://localhost:6383
GRPC_LEDGER_HOST=localhost:50051

# Optional -- S3 document storage
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-southeast-2
AWS_S3_BUCKET=...
```

`NEXT_PUBLIC_APP_URL` **must** match the actual server URL for Payload cookie/auth to work correctly. When running inside Docker, use `host.docker.internal` instead of `localhost` for service URLs that refer to the host machine.

## Development Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the dev server at http://localhost:3000 |
| `pnpm devsafe` | Delete `.next` cache then start the dev server (useful when the cache is corrupted) |
| `pnpm build` | Production build (uses `--max-old-space-size=8000` via cross-env) |
| `pnpm start` | Start the production server (run `pnpm build` first) |
| `pnpm generate:types` | Regenerate Payload TypeScript types (`src/payload-types.ts`) |
| `pnpm generate:importmap` | Regenerate the Payload import map (`src/app/(payload)/admin/importMap.js`) |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run TypeScript type checking (uses `tsconfig.check.json`) |

After changing collections or registering new admin components, always run both `pnpm generate:types` and `pnpm generate:importmap`. The generated files (`src/payload-types.ts` and `src/app/(payload)/admin/importMap.js`) should be committed.

## Testing

### Commands

| Command | Description |
|---------|-------------|
| `pnpm test:int` | Unit + integration tests (Vitest) |
| `pnpm test:e2e` | End-to-end tests (Playwright, Chromium) |
| `pnpm test` | Run both `test:int` then `test:e2e` sequentially |

### Running individual tests

```bash
# Single file
pnpm exec vitest run tests/unit/hooks/useWaiveFee.test.ts --config ./vitest.config.mts

# Tests matching a name pattern
pnpm exec vitest run -t "pattern" --config ./vitest.config.mts
```

### Vitest configuration details

The test configuration (`vitest.config.mts`) has several important settings:

- **Environment**: `jsdom` (browser-like DOM for component tests)
- **File parallelism**: Disabled (`fileParallelism: false`) -- tests run sequentially to avoid MongoDB race conditions
- **Sequence**: `concurrent: false` -- tests within files also run sequentially
- **Pool**: `forks` with `singleFork: true` -- ensures `globalSetup` environment variables are inherited by all test files
- **Hook timeout**: `30000` ms (30s) -- integration tests need extra time for Payload + MongoMemoryServer initialization
- **Global setup**: `tests/utils/globalSetup.ts` (starts MongoMemoryServer, sets `DATABASE_URI`)
- **Setup files**: `vitest.setup.ts` (per-file setup)
- **Include paths**: `tests/int/**/*.int.spec.ts`, `tests/unit/**/*.test.ts`, `tests/unit/**/*.test.tsx`

### Test file conventions

- Unit tests: `tests/unit/**/*.test.ts(x)`
- Integration tests: `tests/int/**/*.int.spec.ts`
- E2E tests: `tests/e2e/`
- Test helpers/utilities: `tests/utils/`

## Docker Development

```bash
docker-compose up
```

The `docker-compose.yml` defines a single `app` service that:

- Builds from `Dockerfile.dev`
- Mounts the source directory (`.:/app`) with a named volume for `node_modules`
- Reads environment from `.env`
- Maps port `3000:3000`
- Connects to the `billie-platform-network` bridge network
- Mounts read-only AWS SSO config from the host (`~/.aws/config`, `~/.aws/sso`)
- Sets `extra_hosts` so `host.docker.internal` resolves to the host gateway (use this instead of `localhost` for MongoDB, Redis, etc. running on the host)
- Requires a `GITHUB_TOKEN` secret (for private SDK access during build)

## Code Conventions

### Formatting and linting

- **Prettier** (`.prettierrc.json`): single quotes, no semicolons, trailing commas, 100 character line width
- **ESLint** (`eslint.config.mjs`): extends `next/core-web-vitals` and `next/typescript`
  - `@typescript-eslint/no-explicit-any` is turned off
  - `@typescript-eslint/no-unused-vars` is a warning with `_` prefix ignore patterns

### Path aliases

```
@/*           -> ./src/*
@payload-config -> ./src/payload.config.ts
```

Configured in `tsconfig.json` and resolved in tests via `vite-tsconfig-paths`.

### Validation and forms

- **Zod v4** for runtime validation schemas (`src/lib/schemas/`)
- **react-hook-form** with `@hookform/resolvers` for Zod-backed form validation
- **Tiptap** for rich text editing (contact notes, conversation display)

### Key dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| Payload CMS | 3.45.0 | CMS framework (admin UI, collections, API) |
| Next.js | 15.3.9 | React framework (App Router, standalone output) |
| React | 19.1.0 | UI library |
| TanStack React Query | 5.x | Server state management |
| Zustand | 5.x | Client state management |
| Zod | 4.x | Schema validation |
| ioredis | 5.x | Redis client (event publishing) |
| @grpc/grpc-js | 1.x | gRPC client (ledger service) |

## Architecture Patterns for Contributors

### Custom views in Payload admin

Custom views (dashboard, servicing, approvals, collections, period-close, ecl-config, exports, investigation, etc.) are registered in `payload.config.ts` under `admin.views`. Each view renders inside the Payload admin template with the sidebar navigation. Custom nav links are registered via `admin.components.beforeNavLinks`.

All custom views use a `*WithTemplate` wrapper component pattern to render within the Payload admin layout (with sidebar, header, etc.).

### Providers wrapper

`src/providers/index.tsx` (must be the default export) wraps all admin pages. It is registered in payload config as `admin.components.providers` and provides:

- React Query (`QueryClientProvider`)
- Toast notifications (sonner)
- Global command palette (Cmd+K via cmdk)
- Read-only mode synchronization
- Ledger status indicator
- Failed actions badge
- Session guard

### Data fetching with React Query

All data fetching uses TanStack React Query hooks:

- **Read hooks**: `src/hooks/queries/` (e.g., `useAccount`, `useCustomer`, `useLedgerTransactions`)
- **Write hooks**: `src/hooks/mutations/` (e.g., `useWaiveFee`, `useWriteOff`)
- **Barrel export**: `src/hooks/index.ts` -- add new hooks here

New hooks should follow the existing pattern (query key conventions, error handling, type safety).

### Client state with Zustand

Zustand stores live in `src/stores/` and manage UI state, the failed actions queue, optimistic updates, version conflicts, and recent customers.

### Role-based access control

Four roles: `admin`, `supervisor`, `operations`, `readonly`.

- Access helpers: `src/lib/access.ts`
- Non-admin users cannot see raw Payload collections in the sidebar (`hideFromNonAdmins`)
- Approval actions require `hasApprovalAuthority` (admin or supervisor only)

### API route authentication

API routes use `src/lib/auth.ts` and its `requireAuth()` function to validate the Payload session and enforce role requirements.

### Locale and formatting

Australian locale throughout: AUD currency, en-AU date formats. Use shared formatters from `src/lib/formatters.ts` rather than inline formatting.

### Server-side clients

| Client | Location | Purpose |
|--------|----------|---------|
| gRPC client | `src/server/grpc-client.ts` | Calls `AccountingLedgerService` (proto at `proto/accounting_ledger.proto`) |
| Redis client | `src/server/redis-client.ts` | Connection for event publishing |
| Event publisher | `src/server/event-publisher.ts` | Publishes commands/events to Redis with retry + exponential backoff |
| S3 client | `src/server/s3-client.ts` | AWS S3 for document storage |

### API routes

Ledger operations live under `src/app/api/ledger/` (repayment, waive-fee, write-off, late-fee, dishonour-fee, adjustment, disburse, etc.). Other routes handle customer search, conversations, contact notes, dashboard, exports, system health, and realtime events. Write-off commands use event sourcing via `src/app/api/commands/writeoff/`.

### Important: Read/write split

- **Reads**: Payload reads from MongoDB collections and gRPC (ledger service for transactions/balances)
- **Writes to MongoDB**: Only the Python event processor writes domain data (accounts, customers, conversations). Payload treats these collections as read-only projections. Do not add Payload hooks or API routes that mutate these collections directly.
- **Writes to ledger**: Payload API routes call gRPC to post transactions
- **CRM-originated events**: Payload publishes to Redis stream `inbox:billie-servicing:internal` via `src/server/event-publisher.ts`. The Python processor consumes these alongside external events.

### Middleware workaround

`src/middleware.ts` intercepts `/admin` and `/admin/login` to fix a Payload 3.45.0 redirect loop bug, routing authenticated users to `/admin/dashboard`. This is marked with a TODO to remove when Payload is upgraded.
