# Source Tree Analysis

This document provides an annotated view of the Billie CRM project structure, highlighting the purpose of each directory, critical subsystems, entry points, and integration boundaries.

## Annotated Source Tree

```
billie-crm/
├── src/                              # Next.js + Payload CMS application source
│   ├── admin/                        # Payload admin customizations
│   │   └── components/               # Admin component overrides
│   ├── app/                          # Next.js App Router
│   │   ├── (frontend)/               # Frontend route group
│   │   │   ├── customer/             # Customer-facing routes
│   │   │   └── dashboard/            # Dashboard route
│   │   ├── (payload)/                # Payload CMS admin routes
│   │   │   ├── admin/                # Admin UI (auto-generated importMap.js)
│   │   │   └── api/                  # Payload REST API
│   │   ├── api/                      # Custom Next.js API routes (~60 routes)
│   │   │   ├── commands/             # Event-sourced commands (write-off)
│   │   │   ├── contact-notes/        # Contact note operations
│   │   │   ├── conversations/        # Conversation API
│   │   │   ├── customer/             # Single customer lookup
│   │   │   ├── customers/            # Customer list/search
│   │   │   ├── dashboard/            # Dashboard data aggregation
│   │   │   ├── ecl-config/           # ECL configuration CRUD
│   │   │   ├── export/               # Data export jobs
│   │   │   ├── health/               # Health check
│   │   │   ├── investigation/        # Audit/investigation tools
│   │   │   ├── ledger/               # Ledger operations (gRPC proxy)
│   │   │   ├── loan-accounts/        # Loan account queries
│   │   │   ├── loan-agreement/       # S3 loan agreement retrieval
│   │   │   ├── pending-disbursements/# Pending disbursement list
│   │   │   ├── period-close/         # Period close operations
│   │   │   ├── realtime/             # Realtime event endpoints
│   │   │   ├── system/               # System status
│   │   │   └── uploads/              # S3 presigned URL generation
│   │   └── my-route/                 # Custom route
│   ├── collections/                  # Payload CMS collection definitions (8 total)
│   │   ├── Applications.ts           # Loan application records
│   │   ├── ContactNotes.ts           # Staff contact notes on customers
│   │   ├── Conversations.ts          # Customer conversation threads
│   │   ├── Customers.ts              # Customer profiles
│   │   ├── LoanAccounts.ts           # Loan account projections (read-only from Payload)
│   │   ├── Media.ts                  # Uploaded media/documents
│   │   ├── Users.ts                  # Staff user accounts and roles
│   │   └── WriteOffRequests.ts       # Write-off approval workflow records
│   ├── components/                   # React components (~25 directories)
│   │   ├── AdminRootRedirect/        # /admin -> /admin/dashboard redirect
│   │   ├── ApprovalsView/            # Write-off approval queue
│   │   ├── Auth/                     # Authentication (Google login)
│   │   ├── Breadcrumb/               # Navigation breadcrumbs
│   │   ├── CollectionsView/          # Overdue accounts queue
│   │   ├── DashboardView/            # Dashboard widgets
│   │   ├── ECLConfigView/            # ECL configuration UI
│   │   ├── ExportCenterView/         # Export management
│   │   ├── FailedActions/            # Failed action retry UI
│   │   ├── InvestigationView/        # Audit investigation tools
│   │   ├── LedgerStatus/             # Ledger health indicator
│   │   ├── LoanAccounts/             # Loan account panel
│   │   ├── LoanAccountServicing/     # In-collection servicing
│   │   ├── MyActivityView/           # User's write-off activity
│   │   ├── navigation/               # 10 Payload sidebar nav items
│   │   ├── Notifications/            # Notification system
│   │   ├── PendingDisbursementsView/ # Pending disbursements
│   │   ├── PeriodCloseView/          # Month-end close wizard
│   │   ├── ReadOnlyBanner/           # Read-only mode banner
│   │   ├── ServicingView/            # CORE: Customer servicing (28+ sub-components)
│   │   │   ├── AccountPanel/         # Account detail tabs
│   │   │   └── ContactNotes/         # Contact notes timeline
│   │   ├── SortableTable/            # Reusable sortable table
│   │   ├── SystemStatusView/         # System health dashboard
│   │   ├── ui/                       # Shared UI primitives
│   │   │   ├── CommandPalette/       # Cmd+K search
│   │   │   ├── ContextDrawer/        # Slide-out drawer
│   │   │   └── Skeleton/             # Loading skeletons
│   │   ├── UserSessionGuard/         # Session isolation security
│   │   └── VersionConflictModal/     # Optimistic lock conflict
│   ├── hooks/                        # React Query hooks (50+)
│   │   ├── mutations/                # 21 mutation hooks (write operations)
│   │   ├── queries/                  # 29 query hooks (read operations)
│   │   ├── index.ts                  # Barrel export
│   │   ├── useGlobalHotkeys.ts       # Global keyboard shortcuts
│   │   ├── useReadOnlyMode.ts        # Read-only mode state
│   │   ├── useTrackCustomerView.ts   # Customer view tracking
│   │   └── useVersionConflictModal.ts# Optimistic lock conflict detection
│   ├── lib/                          # Shared utilities
│   │   ├── access.ts                 # Role-based access helpers (admin, supervisor, operations, readonly)
│   │   ├── auth.ts                   # API route auth wrapper
│   │   ├── constants.ts              # App constants
│   │   ├── errors/                   # Error codes and messages
│   │   ├── events/                   # Event type definitions
│   │   ├── formatters.ts             # AUD/en-AU formatters
│   │   ├── schemas/                  # Zod validation schemas
│   │   ├── tiptap.tsx                # Rich text editor config
│   │   └── utils/                    # General utilities
│   ├── middleware.ts                  # Next.js middleware (auth, CSRF, security headers)
│   ├── payload-types.ts              # Auto-generated Payload types (do not edit)
│   ├── payload.config.ts             # Payload CMS configuration (views, collections, admin)
│   ├── providers/                    # React context providers
│   │   └── index.tsx                 # Root providers wrapper (React Query, toast, Cmd+K, etc.)
│   ├── server/                       # Server-side service clients
│   │   ├── event-publisher.ts        # Redis event publishing with retry + backoff
│   │   ├── grpc-client.ts            # gRPC client for AccountingLedgerService
│   │   ├── redis-client.ts           # Redis connection management
│   │   └── s3-client.ts              # AWS S3 client for document storage
│   ├── stores/                       # Zustand state stores (6 total)
│   │   ├── failed-actions.ts         # Failed action retry queue
│   │   ├── index.ts                  # Barrel export
│   │   ├── optimistic.ts             # Optimistic update tracking
│   │   ├── recentCustomers.ts        # Recently viewed customers
│   │   ├── ui.ts                     # UI state (panels, drawers, modes)
│   │   └── version.ts               # Version conflict tracking
│   └── types/                        # TypeScript type definitions
├── event-processor/                  # Python event consumer
│   ├── src/billie_servicing/
│   │   ├── main.py                   # Entry point, handler registration
│   │   ├── processor.py              # Redis stream consumer, dedup, DLQ
│   │   ├── config.py                 # Pydantic settings
│   │   └── handlers/                 # Event handlers (19 total)
│   │       ├── account.py            # Account events (5 handlers)
│   │       ├── customer.py           # Customer events (4 handlers)
│   │       ├── conversation.py       # Conversation events (7 handlers)
│   │       ├── writeoff.py           # Write-off events (4 handlers)
│   │       └── sanitize.py           # NoSQL injection prevention
│   ├── tests/                        # Python tests
│   ├── requirements.txt              # Python dependencies
│   ├── pyproject.toml                # Build/lint configuration
│   └── Dockerfile                    # Event processor container
├── proto/                            # gRPC protocol definitions
│   └── accounting_ledger.proto       # AccountingLedgerService definition
├── infra/fly/                        # Fly.io deployment infrastructure
│   ├── fly.dev.toml                  # Dev environment config
│   ├── fly.demo.toml                 # Demo environment config
│   ├── fly.staging.toml              # Staging environment config
│   ├── fly.prod.toml                 # Production environment config
│   ├── Makefile                      # Deployment automation
│   └── env/                          # Environment-specific secrets
├── tests/                            # Web app tests
│   ├── e2e/                          # Playwright end-to-end tests
│   │   ├── .auth/                    # Auth state storage
│   │   └── helpers/                  # E2E test helpers
│   ├── int/                          # Integration tests (Payload + MongoDB)
│   │   └── fixtures/                 # Test data fixtures
│   ├── unit/                         # Unit tests
│   │   ├── api/                      # API route tests
│   │   ├── hooks/                    # React Query hook tests
│   │   ├── lib/                      # Utility tests
│   │   ├── security/                 # Security-related tests
│   │   ├── server/                   # Server client tests
│   │   ├── stores/                   # Zustand store tests
│   │   └── ui/                       # Component tests
│   └── utils/                        # Test helpers
│       └── mocks/                    # Shared mock objects
├── docs/                             # Project documentation (generated + manual)
│   ├── analysis/                     # Architecture analysis documents
│   ├── bugs/                         # Bug reports and investigations
│   ├── security-audits/              # Security audit results
│   ├── sprint-artifacts/             # Sprint planning and retrospectives
│   └── ux-design/                    # UX design specifications
├── documents/                        # Reference documents
├── Requirements/v2-servicing-app/    # Original requirements (v2)
├── scripts/                          # Utility scripts
├── Dockerfile                        # Production Docker (standalone Next.js)
├── Dockerfile.dev                    # Development Docker
├── Dockerfile.demo                   # Demo environment Docker
├── Dockerfile.test                   # Test runner Docker
├── docker-compose.yml                # Local development compose (MongoDB, Redis, etc.)
├── package.json                      # pnpm, Node.js 20+
├── pnpm-lock.yaml                    # Dependency lockfile
├── next.config.mjs                   # Next.js config (withPayload wrapper, standalone output)
├── payload.config.ts                 # Symlink -> src/payload.config.ts
├── tsconfig.json                     # TypeScript config (@/* -> ./src/*)
├── eslint.config.mjs                 # ESLint flat config
├── vitest.config.mts                 # Vitest test config (sequential, jsdom)
├── playwright.config.ts              # Playwright E2E config
├── server.js                         # Custom server entry
├── start.sh / start-fly.sh / start-http.sh  # Startup scripts
├── CLAUDE.md                         # AI assistant context
├── DEPLOYMENT.md                     # Deployment guide
├── DOCKER.md                         # Docker guide
└── README.md                         # Project readme
```

## Critical Directories

### `src/components/ServicingView/`
The core UI for customer servicing, containing 28+ sub-components. This is where staff interact with individual loan accounts -- viewing balances, posting transactions, managing contact notes, and performing servicing actions. The `AccountPanel/` subdirectory holds account detail tabs; `ContactNotes/` holds the contact notes timeline.

### `src/app/api/ledger/`
All financial operations that proxy through to the external accounting ledger via gRPC. Includes repayment, waive-fee, write-off, late-fee, dishonour-fee, adjustment, and disburse endpoints. These are the only routes that write financial data (via gRPC), as opposed to MongoDB (which is written exclusively by the event processor).

### `src/server/`
Server-side service clients shared across API routes:
- **grpc-client.ts** -- gRPC client factory for the AccountingLedgerService
- **redis-client.ts** -- Redis connection for event publishing
- **event-publisher.ts** -- Publishes commands/events to Redis with retry and exponential backoff
- **s3-client.ts** -- AWS S3 client for loan agreements and disbursement attachments

### `src/hooks/`
All data fetching and mutation logic, organized as TanStack React Query hooks. The `queries/` directory (29 hooks) handles reads; `mutations/` (21 hooks) handles writes. All hooks are barrel-exported from `index.ts`. This is the single source of truth for how the frontend communicates with the API layer.

### `event-processor/src/billie_servicing/`
Python event consumer that reads domain events from Redis streams and builds MongoDB projections. Contains 19 event handlers across account, customer, conversation, and write-off domains. The processor handles deduplication and dead-letter queue management. This is the only process that writes domain data to MongoDB.

## Entry Points

| Entry Point | Location | Purpose |
|---|---|---|
| Web App | `src/app/` | Next.js App Router -- all pages and API routes |
| Payload Admin | `src/payload.config.ts` | CMS configuration with custom views (dashboard, servicing, approvals, collections, period-close, ecl-config, exports, investigation, etc.) |
| Event Processor | `event-processor/src/billie_servicing/main.py` | Python process entry -- registers handlers and starts Redis stream consumer |
| API Routes | `src/app/api/` | ~60 custom API routes for ledger operations, customer data, exports, system health |
| Middleware | `src/middleware.ts` | Request interception for auth, CSRF protection, security headers, and Payload redirect-loop workaround |

## Integration Points

### Web App to Accounting Ledger (gRPC)
- **Client**: `src/server/grpc-client.ts`
- **Proto**: `proto/accounting_ledger.proto`
- **Direction**: Payload API routes call gRPC to post financial transactions (repayments, fees, write-offs, adjustments, disbursements)
- **Routes**: `src/app/api/ledger/*`

### Web App to Redis (Event Publishing)
- **Client**: `src/server/event-publisher.ts` via `src/server/redis-client.ts`
- **Stream**: `inbox:billie-servicing:internal`
- **Direction**: Payload publishes CRM-originated events/commands for the event processor to consume

### Event Processor to Redis (Event Consumption)
- **Consumer**: `event-processor/src/billie_servicing/processor.py`
- **Streams**: `inbox:billie-servicing` (external domain events) + `inbox:billie-servicing:internal` (CRM-originated events)
- **Direction**: Reads events, deduplicates, processes through registered handlers, manages DLQ

### Event Processor to MongoDB (Projection Writes)
- **Handlers**: `event-processor/src/billie_servicing/handlers/` (19 handlers)
- **Collections written**: loan-accounts, customers, conversations, write-off-requests
- **Key constraint**: Only the event processor writes domain data to MongoDB. Payload treats these collections as read-only projections.

### Web App to S3 (Document Storage)
- **Client**: `src/server/s3-client.ts`
- **Purpose**: Loan agreement retrieval, disbursement attachments, presigned URL generation for uploads
- **Routes**: `src/app/api/loan-agreement/`, `src/app/api/uploads/`

### Shared Database (MongoDB)
- Both the web app (via Payload CMS) and the event processor connect to the same MongoDB instance
- **Reads**: Payload reads all collections
- **Domain writes**: Event processor only (account, customer, conversation, write-off projections)
- **CRM writes**: Payload writes to Users, ContactNotes, Media, and other CRM-owned collections
