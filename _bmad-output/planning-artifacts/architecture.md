---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
lastStep: 8
status: 'complete'
completedAt: '2026-04-03'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/product-brief-billie-crm-2026-02-20.md
  - docs/project_context.md
  - docs/ux-design-specification.md
  - docs/ux-design/unified-account-panel.md
  - docs/ux-design/contact-notes-ux.md
  - docs/architecture.md
  - docs/EVENT_SOURCING_ARCHITECTURE.md
  - docs/integration-architecture.md
workflowType: 'architecture'
project_name: 'billie-crm'
user_name: 'Rohan'
date: '2026-04-03'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
37 functional requirements across 7 categories:
- **Conversation Monitoring (FR1-FR4):** Card grid with status badges, auto-updating at 5s intervals, pagination/infinite scroll
- **Search & Filtering (FR5-FR9):** Multi-criteria search by customer name, application number, decision status, conversation status, date range
- **Conversation Detail (FR10-FR16):** Split-panel with message transcript (60%) and assessment panels (40%), 3s polling, collapsible sections, noticeboard history
- **Credit Assessment Detail (FR17-FR19):** Account conduct and serviceability views with S3-backed data, drill-down from conversation
- **Customer & Application Context (FR20-FR24):** Bidirectional navigation between conversations, customers, and applications. ServicingView integration with conversation panel
- **Event Processing (FR25-FR29):** ~11 new Python handlers for statement flow, credit assessments, post-identity checks. Extends conversations MongoDB schema
- **Message Security & Access (FR30-FR37):** HTML sanitization (DOMPurify), role-based access (admin/supervisor/operations/readonly), Payload admin integration

**Non-Functional Requirements:**
19 NFRs driving architectural decisions:
- **Performance (NFR1-NFR6):** Page loads < 2s, detail loads < 1s, search < 1s, S3 assessment pages < 3s, 15+ concurrent users
- **Security (NFR7-NFR12):** DOMPurify HTML sanitization, S3 bucket allowlisting, rate limiting (30 req/min/user), no PII in logs, Payload RBAC only
- **Integration (NFR13-NFR16):** New handlers must not break existing ones, at-least-once delivery with dedup, backward-compatible schema, existing S3 client reuse
- **Reliability (NFR17-NFR19):** Polling isolation between views, graceful degradation when event processor is down, MongoDB index coverage

**Scale & Complexity:**
- Primary domain: Full-stack web application (brownfield extension)
- Complexity level: Medium-High
- Estimated architectural components: 4 (Event Processor extensions, Monitoring View, Conversation Detail View, ServicingView Integration)

### Technical Constraints & Dependencies

**Hard Constraints (Inherited):**
- **Payload CMS 3.45.0** — Custom views via `admin.views`, Payload auth/RBAC, admin template shell
- **CQRS read/write split** — Event Processor (Python) writes domain data to MongoDB; Payload reads. No direct MongoDB writes for conversation data
- **Event sourcing** — MongoDB is a projection. External events flow via `inbox:billie-servicing`. Internal events via `inbox:billie-servicing:internal`
- **gRPC boundary** — All ledger communication through `/api/ledger/*` routes. Conversations don't interact with the ledger
- **React Query + Zustand** — Established state management pattern. New views must follow existing hook/store conventions
- **Deployment** — Fly.io, Docker, standalone Next.js output. No new infrastructure

**External Dependencies:**
- **MongoDB** — Conversations collection (read), extended by event processor (write)
- **Redis Streams** — `inbox:billie-servicing` for external conversation events
- **AWS S3** — Credit assessment JSON files (account conduct, serviceability)
- **Billie Event SDKs** — Python SDK for event consumption (installed from GitHub)

### Cross-Cutting Concerns Identified

1. **Polling strategy management** — Three different refetch intervals (3s detail, 5s grid, 30s servicing panel) must coexist. React Query's `refetchInterval` per-hook handles this, but stale time configuration must match to prevent unnecessary refetches
2. **Event handler consistency** — New Python handlers must follow established patterns: consumer group, manual XACK, dedup keys with 24h TTL, DLQ after 3 failures. No deviation from existing handler structure
3. **S3 data access pattern** — New API routes needed for assessment JSON fetching. Different from standard MongoDB reads. Requires rate limiting middleware and bucket validation using existing `s3-client.ts`
4. **HTML sanitization** — Message content contains HTML. DOMPurify with strict allowlist (`b`, `i`, `em`, `strong`, `a`, `p`, `br`, `ul`, `ol`, `li`, `span`) must be applied at the component rendering layer, not at the API layer (preserve original data)
5. **Schema backward compatibility** — Conversations collection schema extensions must not break existing Payload collection definition or existing event handlers. New fields should be optional
6. **Entity relationship integrity** — Conversation ↔ Customer ↔ Application linking depends on reliable ID references in MongoDB. Event processor must populate these associations from incoming events
7. **View-level polling isolation** — NFR17 requires that polling failure on one view (e.g., monitoring grid) does not cascade to other views. Each React Query hook manages its own error state independently

## Starter Template Evaluation

### Primary Technology Domain

**Brownfield Project** — Extending an existing Next.js 15 / Payload CMS 3.45.0 application with established patterns and production deployment.

### Existing Foundation (Inherited Decisions)

No starter template is needed. All foundational decisions are inherited from the existing codebase:

| Category | Technology | Version | Status |
| :--- | :--- | :--- | :--- |
| Framework | Next.js (App Router) | 15.3.2 | In production |
| CMS | Payload CMS | 3.45.0 | In production |
| Language | TypeScript (strict) | 5.7.3 | Configured |
| Runtime | React | 19.1.0 | In production |
| Database | MongoDB (via @payloadcms/db-mongodb) | 6.17.0 | Connected |
| Server State | @tanstack/react-query | v5 | In production |
| Client State | Zustand | v4/v5 | In production |
| Forms | react-hook-form + @hookform/resolvers | Latest | In production |
| Validation | Zod | v4 | In production |
| Toast | Sonner | v1 | In production |
| Command Palette | cmdk | v1 | In production |
| gRPC | @grpc/grpc-js | 1.14.1 | In production |
| Styling | CSS Modules / SCSS | — | Configured |
| Unit Testing | Vitest | 3.2.3 | Configured |
| E2E Testing | Playwright | 1.50.0 | Configured |
| Linting | ESLint + Prettier | — | Configured |
| Event Processor | Python + Billie Event SDKs | — | In production |
| Deployment | Fly.io / Docker | — | In production |

### New Dependencies Required

The conversations/applications feature requires one new client-side dependency:

| Need | Candidate | Rationale |
| :--- | :--- | :--- |
| HTML Sanitization | `dompurify` + `@types/dompurify` | FR30/NFR7 — conversation messages contain HTML. Must sanitize before rendering. No existing sanitization library in the project. |

All other requirements are met by existing dependencies. No new frameworks, state management, or infrastructure needed.

### Architectural Decisions Already Established

The following decisions from the existing architecture carry forward unchanged:
- **State Management:** React Query (server state) + Zustand (optimistic UI state)
- **Custom Views:** Payload `admin.views` pattern for all new views
- **API Routes:** Individual routes with Zod-typed responses under `src/app/api/`
- **Error Handling:** Graceful degradation to read-only mode on service failure
- **Real-Time:** Polling via React Query `refetchInterval` (no WebSockets)
- **Component Patterns:** Named exports, CSS Modules, `'use client'` directive for interactive components

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
1. Conversations API route structure
2. S3 assessment data strategy
3. Conversation search implementation
4. HTML sanitization layer

**Important Decisions (Shape Architecture):**
5. Event processor handler organization

**Deferred Decisions (Post-MVP):**
- SSE/Change Streams upgrade from polling (Phase 2)
- Cross-conversation analytics API (Phase 3)
- Saved search filters persistence (Phase 2)

### Data Architecture

**Conversations Collection Schema Extension:**
- New fields added as optional to maintain backward compatibility (NFR15)
- Statement flow events stored in `statementCapture` subdocument
- Credit assessment S3 references stored in `assessments.accountConduct.s3Key` and `assessments.serviceability.s3Key`
- Post-identity risk results stored in `assessments.postIdentityRisk`
- All new fields populated by event processor; Payload collection definition extended with matching optional fields

**MongoDB Indexing Strategy:**
- Compound index: `{ status: 1, decisionStatus: 1, updatedAt: -1 }` — powers the monitoring grid filters and sort
- Index: `{ customerId: 1, updatedAt: -1 }` — powers ServicingView conversations panel
- Index: `{ applicationNumber: 1 }` — powers application number search
- Text index: `{ "customer.fullName": "text", applicationNumber: "text" }` — powers free-text search
- All indexes created in event processor's MongoDB setup, mirrored in Payload collection definition

**Search Implementation:**
- Server-side filtering via MongoDB queries with `$and` composition of filter criteria
- Monitoring grid: cursor-based pagination using `updatedAt` + `_id` for infinite scroll
- Search results: skip/limit pagination for page-numbered results
- API route accepts query params: `?status=active&decision=approved&from=2026-01-01&to=2026-04-01&q=searchterm&cursor=xxx&limit=20`

### Authentication & Security

**Inherited (no new decisions):**
- Payload RBAC with existing roles: admin, supervisor, operations, readonly
- All API routes wrapped with `withAuth(role)` — conversations accessible to all four roles (read-only feature, no write actions from web layer)

**New Security Rules:**
- **HTML Sanitization:** DOMPurify applied at the component rendering layer via a dedicated `<SanitizedHTML />` component. Strict allowlist: `b`, `i`, `em`, `strong`, `a`, `p`, `br`, `ul`, `ol`, `li`, `span`. Applied in `ConversationMessage.tsx`, not in API routes (preserve raw data in MongoDB)
- **S3 Access:** API routes proxy all S3 fetches server-side. S3 bucket names, keys, and signed URLs are never exposed to the client. Bucket allowlisting and path traversal prevention via existing `s3-client.ts`
- **Rate Limiting:** Assessment detail API routes rate-limited at 30 requests/minute/user via middleware. Applied at `/api/conversations/[id]/assessments/*` routes

### API & Communication Patterns

**Conversations API Route Structure:**
```
src/app/api/conversations/
├── route.ts                              # GET - List/search conversations (MongoDB)
├── [conversationId]/
│   ├── route.ts                          # GET - Single conversation detail (MongoDB)
│   └── assessments/
│       ├── account-conduct/route.ts      # GET - Account conduct detail (S3)
│       └── serviceability/route.ts       # GET - Serviceability detail (S3)
```

Feature-grouped under `/api/conversations/`. The S3 vs MongoDB data source distinction is an implementation detail abstracted by the API route layer. Frontend treats all data as coming from a single API.

**S3 Assessment Data Strategy:**
- API routes fetch from S3 server-side and return parsed JSON to client
- Client-side caching via React Query with `staleTime: Infinity` and `gcTime: 30 * 60 * 1000` (30 min)
- Assessment data is immutable (point-in-time snapshot) — no cache invalidation needed
- No server-side caching layer — unnecessary complexity for immutable data with low request volume
- S3 pre-signed URLs never returned to client — always server-proxied

**Response Format:**
Follows existing pattern — success returns data directly, errors return `{ error: { code, message } }`:
```typescript
// Success (list)
{ conversations: [...], cursor: "next_cursor", hasMore: true }

// Success (detail)
{ conversation: { ... } }

// Error
{ error: { code: "VALIDATION_ERROR", message: "Invalid date range" } }
```

### Frontend Architecture

**New Custom Views:**
Two new views registered in `payload.config.ts` under `admin.views`:
- `ApplicationsView` — All Conversations monitoring grid (`/admin/applications`)
- `ConversationDetailView` — Single conversation detail (`/admin/applications/:conversationId`)

ServicingView integration is an extension of the existing view (new `ConversationsPanel` component), not a new view registration.

**Polling Strategy:**

| View | Hook | Interval | staleTime | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| Monitoring grid | `useConversations` | 5s | 5s | Freshness vs query load for bulk data |
| Conversation detail | `useConversation` | 3s | 3s | Responsive for active monitoring |
| ServicingView panel | `useCustomerConversations` | 30s | 30s | Background context, not primary focus |
| Assessment detail | `useAssessment` | none | Infinity | Immutable data, fetch once |

All hooks use `refetchIntervalInBackground: false` to stop polling when tab is not focused.

**Component Structure:**
```
src/components/views/ApplicationsView/
├── ApplicationsView.tsx          # Main monitoring grid view
├── ConversationCard.tsx          # Card in the grid
├── ConversationFilters.tsx       # Search + filter bar
├── StatusBadge.tsx               # Status badge component
├── styles.module.css
└── index.ts

src/components/views/ConversationDetailView/
├── ConversationDetailView.tsx    # Main detail view (split panel)
├── MessagePanel.tsx              # Left panel — message transcript
├── ConversationMessage.tsx       # Individual message bubble
├── SanitizedHTML.tsx             # DOMPurify wrapper component
├── AssessmentPanel.tsx           # Right panel — collapsible sections
├── AssessmentSection.tsx         # Individual collapsible section
├── NoticeboardSection.tsx        # Noticeboard with version history
├── styles.module.css
└── index.ts

src/components/ServicingView/ConversationsPanel/
├── ConversationsPanel.tsx        # Conversations section in ServicingView
├── ConversationSummaryCard.tsx   # Compact conversation card
├── styles.module.css
└── index.ts
```

**Navigation Pattern:**
- Monitoring grid → Conversation detail: URL navigation (`/admin/applications/:conversationId`)
- Conversation detail → Customer record: Link to `/admin/servicing/:customerId`
- Customer record → Conversation detail: Click-through from ConversationsPanel
- All navigation uses Next.js `<Link>` within Payload admin shell

**React Query Hooks:**
```
src/hooks/queries/
├── useConversations.ts           # List/search with polling (5s)
├── useConversation.ts            # Single detail with polling (3s)
├── useCustomerConversations.ts   # Customer's conversations with polling (30s)
├── useAccountConductAssessment.ts # S3 fetch, staleTime: Infinity
└── useServiceabilityAssessment.ts # S3 fetch, staleTime: Infinity
```

All hooks barrel-exported from `src/hooks/index.ts` per existing convention.

### Infrastructure & Deployment

**No new infrastructure.** All changes deploy within the existing two-process system:
- Payload CMS (Next.js): New views, API routes, hooks, components
- Event Processor (Python): New handlers in existing `conversation.py`

**Event Processor Handler Organization:**
- Existing pattern: one file per domain (`conversation.py`, `account.py`, `customer.py`, `writeoff.py`)
- New handlers added to existing `conversation.py` — matches the established pattern
- ~11 new handler functions for statement flow, credit assessment results, and post-identity checks
- Handler registration updated in `__init__.py` to map new event types to new functions

### Decision Impact Analysis

**Implementation Sequence:**
1. Event Processor handlers first — extend `conversation.py` with new handlers, extend conversations schema
2. MongoDB indexes — create compound indexes for query performance
3. API routes — `/api/conversations/` with search, detail, and assessment endpoints
4. React Query hooks — data fetching layer with per-view polling configuration
5. Components — views, panels, and message rendering with DOMPurify
6. View registration — add to `payload.config.ts` and sidebar navigation

**Cross-Component Dependencies:**
- API routes depend on event processor populating extended schema fields
- React Query hooks depend on API routes being available
- Components depend on hooks for data
- `SanitizedHTML` component depends on `dompurify` package being installed
- Navigation links depend on both views being registered in Payload config

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 8 areas where AI agents could make different choices for the conversations/applications feature. Existing project conventions (from `docs/project_context.md`) remain in force — these patterns supplement, not replace.

### Naming Patterns

**Conversation Status Values:**
Status strings used in MongoDB, API responses, and UI must be consistent:

| Status | MongoDB Value | Display Label | Badge Colour |
| :--- | :--- | :--- | :--- |
| Active conversation | `active` | Active | Green (pulsing) |
| Paused (waiting for customer) | `paused` | Paused | Amber |
| Soft end (AI finished, decision pending) | `soft_end` | Soft End | Blue |
| Hard end (conversation terminated) | `hard_end` | Hard End | Grey |
| Decision: approved | `approved` | Approved | Green |
| Decision: declined | `declined` | Declined | Red |
| Conversation ended (generic) | `ended` | Ended | Grey |

- MongoDB stores lowercase snake_case values
- UI maps to display labels and colours via a single `STATUS_CONFIG` constant
- API responses pass through MongoDB values unchanged — mapping happens client-side only

**Event Type Naming (Python Handlers):**
New event types follow existing naming from the conversation engine (not our choice):
```python
# These names come from external systems — do NOT rename
'statement_consent_initiated'
'statement_consent_complete'
'statement_consent_cancelled'
'basiq_job_created'
'statement_retrieval_complete'
'affordability_report_complete'
'statement_checks_complete'
'account_conduct_assessment_results'
'serviceability_assessment_results'  # Already exists
'post_identity_risk_check'
'credit_assessment_complete'
```

Handler function naming follows existing pattern: `handle_{event_type}` → `handle_statement_consent_initiated`

**React Query Key Conventions:**
```typescript
// Conversations feature query keys — consistent array structure
['conversations', { status, decision, from, to, q, cursor }]  // List/search
['conversation', conversationId]                                 // Single detail
['conversations', 'customer', customerId]                       // Customer's conversations
['assessment', 'account-conduct', conversationId]               // S3 assessment
['assessment', 'serviceability', conversationId]                // S3 assessment
```

### Structure Patterns

**Feature Component Organization:**
Conversation components follow established patterns but live under `views/` not `LoanAccountServicing/`:

```
src/components/views/ApplicationsView/     # New view — NOT under LoanAccountServicing
src/components/views/ConversationDetailView/  # New view
src/components/ServicingView/ConversationsPanel/  # Extension of existing view
```

- New **views** go under `src/components/views/{ViewName}/`
- Extensions to **existing views** go under the existing view's directory
- Each directory has barrel export (`index.ts`), scoped styles (`styles.module.css`)

**Test File Location:**
```
tests/unit/hooks/useConversations.test.ts
tests/unit/hooks/useConversation.test.ts
tests/unit/ui/conversation-card.test.tsx
tests/unit/ui/sanitized-html.test.tsx
tests/unit/ui/conversation-message.test.tsx
tests/int/api/conversations.int.spec.ts
tests/int/api/assessments.int.spec.ts
```

Test naming follows existing convention: unit tests match component/hook names, integration tests match API route names.

### Format Patterns

**Conversation API Response Shapes:**

```typescript
// GET /api/conversations (list)
{
  conversations: ConversationSummary[],
  cursor: string | null,
  hasMore: boolean,
  total: number
}

// GET /api/conversations/:id (detail)
{
  conversation: ConversationDetail
}

// GET /api/conversations/:id/assessments/account-conduct
{
  assessment: AccountConductAssessment
}
```

- List endpoints return `{ items[], cursor, hasMore, total }`
- Detail endpoints return `{ singularName: object }`
- No wrapping `{ data: ... }` envelope — matches existing API routes
- Errors use existing `{ error: { code, message } }` format

**Conversation MongoDB Document Shape:**
```typescript
// Key fields — agents must use these exact field names
{
  conversationId: string,          // Primary identifier
  customerId: ObjectId | null,     // Ref to customers collection
  applicationNumber: string,       // e.g., "APP-2026-001234"
  status: string,                  // See status table above
  decisionStatus: string | null,   // 'approved' | 'declined' | null
  utterances: Utterance[],         // Chat messages array
  assessments: {                   // Nested subdocument
    identity: object | null,
    fraud: object | null,
    accountConduct: { s3Key: string, decision: string } | null,
    serviceability: { s3Key: string, decision: string } | null,
    postIdentityRisk: object | null,
  },
  statementCapture: {              // NEW — statement flow events
    consentStatus: string | null,
    basiqJobId: string | null,
    retrievalComplete: boolean,
    affordabilityReport: object | null,
    checksComplete: boolean,
  } | null,
  noticeboard: NoticeboardPost[],  // Version history array
  summary: string | null,
  customer: {                      // Denormalised for search
    fullName: string,
    customerId: string,
  },
  application: {                   // Denormalised for display
    loanAmount: number | null,
    purpose: string | null,
    term: number | null,
  },
  messageCount: number,
  lastMessageAt: Date,
  updatedAt: Date,
  createdAt: Date,
}
```

### Communication Patterns

**Event Handler Pattern (Python):**
All new handlers must follow this exact structure:
```python
async def handle_new_event_type(db: AsyncIOMotorDatabase, event: dict[str, Any]) -> None:
    """Handle event_type_name event."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id"
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing event_type_name")

    # Use upsert pattern — never assume document exists
    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {"$set": { ... }},  # Use $set for fields, $push for arrays
        upsert=True,
    )
    log.info("event_type_name processed")
```

- Always extract `conversation_id` using the 3-field fallback pattern (`cid`, `conv`, `conversation_id`)
- Always use `safe_str()` from `sanitize.py` for string extraction
- Always bind structured logger with `conversation_id`
- Always use `upsert=True` — events may arrive out of order
- Use `$set` for scalar fields, `$push` for array appends, `$addToSet` for dedup arrays

**Polling Error Isolation:**
Each React Query hook manages its own error state. Never share error state between hooks:
```typescript
// CORRECT — isolated error handling
const { data, error, isError } = useConversations(filters)
if (isError) return <ConversationsError error={error} />

// WRONG — don't use a global error store for polling failures
const { setGlobalError } = useUIStore()
```

### Process Patterns

**HTML Sanitization Pattern:**
```typescript
// SanitizedHTML.tsx — the ONLY place DOMPurify is used
'use client'

import DOMPurify from 'dompurify'

const ALLOWED_TAGS = ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'span']
const ALLOWED_ATTR = ['href', 'target', 'rel']

interface SanitizedHTMLProps {
  content: string
  className?: string
}

export const SanitizedHTML: React.FC<SanitizedHTMLProps> = ({ content, className }) => {
  const clean = DOMPurify.sanitize(content, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  })
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />
}
```

- All message HTML rendering goes through `<SanitizedHTML />`
- Never use `dangerouslySetInnerHTML` directly in any other component
- Never sanitize in API routes — preserve raw data

**Search Filter Composition:**
```typescript
// API route builds MongoDB query from params
const buildConversationQuery = (params: SearchParams) => {
  const query: FilterQuery = {}
  if (params.status) query.status = params.status
  if (params.decision) query.decisionStatus = params.decision
  if (params.from || params.to) {
    query.updatedAt = {}
    if (params.from) query.updatedAt.$gte = new Date(params.from)
    if (params.to) query.updatedAt.$lte = new Date(params.to)
  }
  if (params.q) {
    query.$or = [
      { 'customer.fullName': { $regex: params.q, $options: 'i' } },
      { applicationNumber: { $regex: params.q, $options: 'i' } },
    ]
  }
  return query
}
```

- Filters compose with `$and` (implicit in MongoDB when multiple fields specified)
- Text search uses `$regex` with case-insensitive flag (not MongoDB text index for MVP — simpler, sufficient for scale)
- Empty/missing filter params are omitted, not set to null

**Loading State Pattern:**
```typescript
// Skeleton loaders for each view — never spinners
// Monitoring grid: show skeleton cards
// Conversation detail: show skeleton panels
// Assessment detail: show skeleton sections

// CORRECT
if (isLoading) return <ConversationCardSkeleton count={6} />

// WRONG — no full-page spinners
if (isLoading) return <Spinner />
```

## Project Structure & Boundaries

### New Files — Conversations/Applications Feature

This feature adds files to an existing codebase. Only new additions are shown. Existing files that need modification are marked with `(modify)`.

```
billie-crm/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── conversations/
│   │   │       ├── route.ts                              # GET - List/search
│   │   │       └── [conversationId]/
│   │   │           ├── route.ts                          # GET - Detail
│   │   │           └── assessments/
│   │   │               ├── account-conduct/route.ts      # GET - S3 fetch
│   │   │               └── serviceability/route.ts       # GET - S3 fetch
│   │   └── (payload)/admin/importMap.js                  (modify - regenerate)
│   │
│   ├── collections/
│   │   └── Conversations.ts                              (modify - extend schema)
│   │
│   ├── components/
│   │   ├── views/
│   │   │   ├── ApplicationsView/
│   │   │   │   ├── ApplicationsView.tsx                  # Monitoring grid view
│   │   │   │   ├── ConversationCard.tsx                  # Grid card component
│   │   │   │   ├── ConversationCardSkeleton.tsx          # Loading skeleton
│   │   │   │   ├── ConversationFilters.tsx               # Search + filter bar
│   │   │   │   ├── StatusBadge.tsx                       # Status badge component
│   │   │   │   ├── styles.module.css
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   └── ConversationDetailView/
│   │   │       ├── ConversationDetailView.tsx            # Split-panel detail view
│   │   │       ├── MessagePanel.tsx                      # Left panel (60%)
│   │   │       ├── ConversationMessage.tsx               # Message bubble
│   │   │       ├── SanitizedHTML.tsx                     # DOMPurify wrapper
│   │   │       ├── AssessmentPanel.tsx                   # Right panel (40%)
│   │   │       ├── AssessmentSection.tsx                 # Collapsible section
│   │   │       ├── NoticeboardSection.tsx                # Noticeboard + history
│   │   │       ├── ConversationHeader.tsx                # Top bar with nav links
│   │   │       ├── ConversationDetailSkeleton.tsx        # Loading skeleton
│   │   │       ├── styles.module.css
│   │   │       └── index.ts
│   │   │
│   │   ├── ServicingView/
│   │   │   ├── ConversationsPanel/
│   │   │   │   ├── ConversationsPanel.tsx                # Customer conversations section
│   │   │   │   ├── ConversationSummaryCard.tsx           # Compact card
│   │   │   │   ├── styles.module.css
│   │   │   │   └── index.ts
│   │   │   └── ServicingView.tsx                         (modify - add ConversationsPanel)
│   │   │
│   │   └── nav/
│   │       └── ApplicationsNavLink.tsx                   # Sidebar nav link
│   │
│   ├── hooks/
│   │   ├── queries/
│   │   │   ├── useConversations.ts                       # List/search (5s poll)
│   │   │   ├── useConversation.ts                        # Detail (3s poll)
│   │   │   ├── useCustomerConversations.ts               # Customer panel (30s poll)
│   │   │   ├── useAccountConductAssessment.ts            # S3 (staleTime: Infinity)
│   │   │   └── useServiceabilityAssessment.ts            # S3 (staleTime: Infinity)
│   │   └── index.ts                                      (modify - add exports)
│   │
│   ├── lib/
│   │   └── schemas/
│   │       └── conversations.ts                          # Zod schemas for API responses
│   │
│   └── payload.config.ts                                 (modify - register views + nav)
│
├── event-processor/
│   └── src/billie_servicing/
│       └── handlers/
│           ├── conversation.py                           (modify - add ~11 handlers)
│           └── __init__.py                               (modify - register new handlers)
│
└── tests/
    ├── unit/
    │   ├── hooks/
    │   │   ├── useConversations.test.ts
    │   │   ├── useConversation.test.ts
    │   │   └── useCustomerConversations.test.ts
    │   └── ui/
    │       ├── conversation-card.test.tsx
    │       ├── sanitized-html.test.tsx
    │       ├── conversation-message.test.tsx
    │       ├── status-badge.test.tsx
    │       └── conversation-filters.test.tsx
    ├── int/
    │   └── api/
    │       ├── conversations.int.spec.ts
    │       └── assessments.int.spec.ts
    └── e2e/
        ├── applications-view.e2e.spec.ts
        └── conversation-detail.e2e.spec.ts
```

### Architectural Boundaries

**API Boundaries:**
```
Client (Browser)
    │
    ├──▶ /api/conversations/           → MongoDB (conversations collection)
    ├──▶ /api/conversations/:id        → MongoDB (conversations collection)
    ├──▶ /api/conversations/:id/assessments/*  → S3 (assessment JSON files)
    │
    │    All routes: withAuth() → Payload RBAC check
    │    Assessment routes: + rate limiting middleware (30 req/min/user)
    │    Assessment routes: + S3 bucket allowlist validation
    │
    └──▶ Existing routes (/api/ledger/*, /api/customers/*, etc.) unchanged
```

**Component Boundaries:**
```
payload.config.ts
    │
    ├── admin.views.ApplicationsView      → ApplicationsView.tsx
    │   └── uses: useConversations, ConversationCard, ConversationFilters, StatusBadge
    │
    ├── admin.views.ConversationDetailView → ConversationDetailView.tsx
    │   ├── MessagePanel → ConversationMessage → SanitizedHTML
    │   └── AssessmentPanel → AssessmentSection, NoticeboardSection
    │       └── Assessment detail uses: useAccountConductAssessment, useServiceabilityAssessment
    │
    └── admin.components.beforeNavLinks   → ApplicationsNavLink.tsx
```

**Data Boundaries (CQRS):**
```
WRITE PATH (Event Processor only):
    Redis Streams → Python Handler → MongoDB conversations collection
    - External events: inbox:billie-servicing
    - ~11 new event types handled in conversation.py
    - Uses upsert pattern for out-of-order tolerance

READ PATH (Payload/Next.js only):
    MongoDB conversations collection → API Route → React Query Hook → Component
    - API routes read from MongoDB using Payload's local API or direct MongoDB queries
    - S3 assessment JSON fetched server-side, returned to client as parsed JSON
    - No write operations from web layer to conversations collection
```

### Requirements to Structure Mapping

**FR Category Mapping:**

| FR Category | Primary Files | API Routes |
| :--- | :--- | :--- |
| Monitoring (FR1-FR4) | `ApplicationsView/`, `ConversationCard.tsx`, `StatusBadge.tsx` | `GET /api/conversations` |
| Search (FR5-FR9) | `ConversationFilters.tsx`, `useConversations.ts` | `GET /api/conversations?...` |
| Detail (FR10-FR16) | `ConversationDetailView/`, `MessagePanel.tsx`, `AssessmentPanel.tsx` | `GET /api/conversations/:id` |
| Assessments (FR17-FR19) | `AssessmentSection.tsx` | `GET /api/conversations/:id/assessments/*` |
| Context (FR20-FR24) | `ConversationsPanel/`, `ConversationHeader.tsx` | `GET /api/conversations?customerId=...` |
| Events (FR25-FR29) | `event-processor/handlers/conversation.py` | N/A (background process) |
| Security (FR30-FR31) | `SanitizedHTML.tsx` | N/A (client-side) |
| Access (FR32-FR37) | `payload.config.ts`, `ApplicationsNavLink.tsx` | `withAuth()` on all routes |

**Cross-Cutting Concerns Mapping:**

| Concern | Files |
| :--- | :--- |
| HTML Sanitization | `SanitizedHTML.tsx` (single source of truth) |
| Polling Configuration | Individual hook files (`useConversations.ts`, etc.) |
| Status Badge Logic | `StatusBadge.tsx` + `STATUS_CONFIG` constant |
| Error Handling | Per-hook error state, per-view error UI components |
| Rate Limiting | Assessment API route middleware |
| S3 Access | Assessment API routes → existing `s3-client.ts` |

### Existing Files Modified

| File | Change | Reason |
| :--- | :--- | :--- |
| `src/payload.config.ts` | Add 2 view registrations + 1 nav link | New custom views |
| `src/collections/Conversations.ts` | Add optional fields for statement capture, assessment S3 keys, post-identity risk | Schema extension |
| `src/components/ServicingView/ServicingView.tsx` | Add `<ConversationsPanel>` below AccountPanel | Customer context integration |
| `src/hooks/index.ts` | Add barrel exports for 5 new query hooks | Hook discoverability |
| `event-processor/handlers/conversation.py` | Add ~11 new handler functions | New event types |
| `event-processor/handlers/__init__.py` | Register new event type → handler mappings | Event routing |
| `src/app/(payload)/admin/importMap.js` | Regenerate via `pnpm generate:importmap` | View registration |

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:** PASS
- All technologies are already running together in production (Next.js 15.3.2 + Payload 3.45.0 + React 19 + React Query v5 + Zustand)
- Only new dependency (`dompurify`) is a browser-only library with no compatibility concerns
- S3 assessment fetching reuses existing `s3-client.ts` — no new server-side dependencies
- Event processor extensions use existing Python SDK and handler patterns — no new Python dependencies
- No version conflicts between any components

**Pattern Consistency:** PASS
- All naming patterns (components, hooks, routes, collections) align with existing `project_context.md` rules
- API response format (`{ error: { code, message } }`) matches established pattern from `docs/architecture.md`
- Component structure (named exports, CSS Modules, barrel exports, `'use client'`) matches existing codebase
- Query key conventions follow React Query v5 array format already in use
- Event handler structure (upsert, safe_str, structured logging) matches existing `conversation.py`

**Structure Alignment:** PASS
- New views placed under `src/components/views/` — matches existing ServicingView, ApprovalsView pattern
- New hooks under `src/hooks/queries/` — matches existing hook organization
- New API routes under `src/app/api/conversations/` — follows `/api/ledger/` structure
- Tests follow existing `tests/unit/`, `tests/int/`, `tests/e2e/` split
- Event handlers extend existing file — no new module structure

### Requirements Coverage Validation

**Functional Requirements Coverage:** 37/37 COVERED

| FR Range | Category | Architectural Support |
| :--- | :--- | :--- |
| FR1-FR4 | Monitoring | ApplicationsView + ConversationCard + StatusBadge + useConversations (5s poll) |
| FR5-FR9 | Search | ConversationFilters + server-side MongoDB query + compound indexes |
| FR10-FR16 | Detail | ConversationDetailView split-panel + useConversation (3s poll) + collapsible sections |
| FR17-FR19 | Assessments | AssessmentSection + S3 API routes + staleTime: Infinity |
| FR20-FR24 | Context | ConversationsPanel in ServicingView + bidirectional nav links |
| FR25-FR29 | Events | ~11 new Python handlers in conversation.py + schema extensions |
| FR30-FR31 | Security | SanitizedHTML component with DOMPurify strict allowlist |
| FR32-FR37 | Access | withAuth() on all routes + Payload admin view registration + nav link |

**Non-Functional Requirements Coverage:** 19/19 COVERED

| NFR Range | Category | Architectural Support |
| :--- | :--- | :--- |
| NFR1-NFR6 | Performance | Polling intervals (3s/5s/30s), skeleton loaders, MongoDB compound indexes, 15+ concurrent users via stateless polling |
| NFR7-NFR12 | Security | DOMPurify (NFR7), S3 bucket allowlist (NFR8), rate limiting 30 req/min (NFR9), withAuth RBAC (NFR10-12) |
| NFR13-NFR16 | Integration | Existing handler patterns (NFR13-14), optional schema fields (NFR15), s3-client.ts reuse (NFR16) |
| NFR17-NFR19 | Reliability | Per-hook error isolation (NFR17), read-only degradation (NFR18), MongoDB indexes (NFR19) |

### Implementation Readiness Validation

**Decision Completeness:** PASS
- 5 critical decisions documented with rationale and code examples
- Technology versions locked to existing production values
- Only 1 new dependency identified (dompurify)
- Deferred decisions explicitly listed with rationale

**Structure Completeness:** PASS
- ~30 new files specified with directory structure
- 7 existing files identified for modification
- Component boundary diagrams (API, component, data)
- FR-to-file mapping table covers all 37 requirements

**Pattern Completeness:** PASS
- 8 conflict points addressed with specific rules
- Code examples for: event handlers, sanitization, search filters, polling, loading states
- MongoDB document shape fully specified
- Status value mapping table (MongoDB → Display → Colour)

### Gap Analysis Results

**Critical Gaps:** None

**Important Gaps (non-blocking):**
1. **Rate limiting middleware** — Architecture specifies 30 req/min/user on assessment routes but doesn't define the middleware implementation. Mitigation: existing rate limiting patterns may exist in the codebase; if not, a simple in-memory counter per user session is sufficient for 5-15 users.
2. **Conversations Payload collection definition** — The MongoDB document shape is specified, but the exact Payload collection field definitions (field types, relationships, access control per field) will need to be worked out during implementation. Mitigation: schema shape is documented; Payload field mapping is straightforward.

**Nice-to-Have Gaps (deferred):**
- Zod schema examples for conversation API responses (pattern is established, agents can follow)
- Event processor test strategy for new handlers (pytest infrastructure exists)
- Monitoring/alerting for new polling queries (operational concern, not architectural)

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed (Medium-High)
- [x] Technical constraints identified (CQRS, Payload, event sourcing)
- [x] Cross-cutting concerns mapped (7 concerns)

**Architectural Decisions**
- [x] Critical decisions documented with rationale (5 decisions)
- [x] Technology stack fully specified (all versions locked)
- [x] Integration patterns defined (CQRS boundaries, S3 proxying)
- [x] Performance considerations addressed (polling intervals, indexes, caching)

**Implementation Patterns**
- [x] Naming conventions established (status values, query keys, handler names)
- [x] Structure patterns defined (component organization, test locations)
- [x] Communication patterns specified (event handlers, polling isolation)
- [x] Process patterns documented (sanitization, search composition, loading states)

**Project Structure**
- [x] Complete directory structure defined (~30 new files)
- [x] Component boundaries established (API, component, data)
- [x] Integration points mapped (MongoDB, S3, Redis Streams)
- [x] Requirements to structure mapping complete (all 37 FRs)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Brownfield extension — inherits battle-tested patterns from production codebase
- No new infrastructure — zero deployment risk from architectural changes
- CQRS boundaries clearly defined — event processor writes, Payload reads
- Every FR has a specific file/component mapping — no ambiguity for implementation agents
- Security decisions are explicit (DOMPurify allowlist, S3 proxying, rate limiting)

**Areas for Future Enhancement:**
- Upgrade from polling to SSE/Change Streams if latency requirements tighten (Phase 2)
- Cross-conversation search and analytics API (Phase 3)
- Saved search filter persistence (Phase 2)
- Connection status indicator for real-time monitoring (Phase 2)

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and CQRS boundaries
- Refer to this document for all architectural questions
- Follow existing `docs/project_context.md` for general coding rules

**Implementation Sequence:**
1. Event Processor handlers — extend `conversation.py` with ~11 new handlers
2. MongoDB indexes — create compound indexes
3. Conversations collection — extend Payload schema with optional fields
4. API routes — `/api/conversations/` endpoints
5. React Query hooks — data fetching with per-view polling
6. Components — views, panels, message rendering
7. View registration — `payload.config.ts` + sidebar nav
8. Install `dompurify` — `pnpm add dompurify @types/dompurify`

## Architecture Completion Summary

### Workflow Completion

**Architecture Decision Workflow:** COMPLETED
**Total Steps Completed:** 8
**Date Completed:** 2026-04-03
**Document Location:** `_bmad-output/planning-artifacts/architecture.md`

### Final Architecture Deliverables

**Complete Architecture Document**
- 5 core architectural decisions with rationale and code examples
- 8 implementation patterns ensuring AI agent consistency
- ~30 new files specified with complete directory structure
- 37 functional requirements mapped to specific files
- 19 non-functional requirements with architectural support
- Validation confirming coherence and completeness

**Implementation Ready Foundation**
- 1 new dependency required (`dompurify`)
- 7 existing files to modify
- 4 architectural components (Event Processor, Monitoring View, Detail View, ServicingView Integration)
- 8-step implementation sequence defined

---

**Architecture Status:** READY FOR IMPLEMENTATION

**Next Phase:** Begin implementation using the architectural decisions and patterns documented herein.

**Document Maintenance:** Update this architecture when major technical decisions are made during implementation.
