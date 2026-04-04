---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
status: complete
completedAt: '2026-04-03'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
workflowType: 'epics-and-stories'
project_name: 'billie-crm-applications'
user_name: 'Rohan'
date: '2026-04-03'
---

# billie-crm-applications - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for billie-crm-applications, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories. The feature replatforms the standalone billie-realtime supervisor dashboard into billie-crm, consolidating loan origination conversation monitoring into the existing staff servicing application.

## Requirements Inventory

### Functional Requirements

FR1: Supervisors can view all conversations in a card grid showing customer name, application number, status badge, loan amount/purpose, last message preview, message count, and time indicators
FR2: Supervisors can see conversation status badges reflecting current state (active, paused, soft end, hard end, approved, declined, ended)
FR3: Supervisors can see the conversation grid update automatically at regular intervals without manual refresh
FR4: Supervisors can paginate or infinite-scroll through conversations sorted by most recent activity
FR5: Users can search conversations by customer name or application number
FR6: Users can filter conversations by decision status (approved, declined, no decision)
FR7: Users can filter conversations by conversation status (active, paused, ended)
FR8: Users can filter conversations by date range
FR9: Users can combine multiple search and filter criteria simultaneously
FR10: Users can view the full message transcript with messages attributed to customer or AI assistant
FR11: Users can view the AI assistant's rationale for each response when available
FR12: Users can view assessment data organised by category (Application, Identity, Credit, Statements, Noticeboard)
FR13: Users can expand and collapse individual assessment sections
FR14: Users can view noticeboard posts with version history
FR15: Users can see conversation detail update automatically at regular intervals
FR16: Users can view application details (loan amount, purpose, term) within the conversation
FR17: Users can view full account conduct assessment: overall decision, individual rule results, pass/fail indicators, scoring details
FR18: Users can view full serviceability assessment: overall decision, monthly metrics, rule results, processed files
FR19: Users can navigate from a conversation's assessment panel to the detailed assessment view
FR20: Users can navigate from a conversation to the associated customer's ServicingView record
FR21: Users can navigate from a customer's record to their associated conversations
FR22: Users can see conversations alongside loan accounts, contact notes, and servicing history in the ServicingView
FR23: Conversations are linked to both customer and application records
FR24: Users can see conversation status and last message preview from within the ServicingView
FR25: The system consumes and processes all conversation event types from inbox:billie-servicing
FR26: The system stores full conversation state in MongoDB: utterances, all assessment types, noticeboard posts, application details, final decisions
FR27: The system handles statement capture flow events (consent initiated/complete/cancelled, basiq job, retrieval, affordability report, statement checks)
FR28: The system handles credit assessment result events (account conduct, serviceability) including S3 file location references
FR29: The system handles post-identity risk check events
FR30: The system sanitises all conversation message HTML before rendering
FR31: Users can view formatted message content (bold, italic, links, lists) within sanitised boundaries
FR32: Admin, supervisor, and operations roles can access conversation monitoring and details
FR33: Readonly users can view conversations but cannot perform write actions
FR34: The conversation monitoring nav link is visible to authorised roles in the Payload admin sidebar
FR35: Users can access the conversation monitoring view from the Payload admin sidebar
FR36: Users can navigate between monitoring view, conversation detail, customer record, and assessment detail seamlessly
FR37: The conversation monitoring view operates within the Payload admin template (with sidebar)

### NonFunctional Requirements

NFR1: All Conversations view initial load < 2 seconds
NFR2: Conversation detail load < 1 second
NFR3: Search and filter results < 1 second
NFR4: Polling cycles complete without visible UI jank
NFR5: Credit assessment detail pages (S3 fetch + render) < 3 seconds
NFR6: 15+ concurrent users on monitoring view without degradation
NFR7: All message HTML sanitised before rendering (DOMPurify, strict allowlist)
NFR8: S3 assessment URLs validated against bucket allowlist with path traversal prevention
NFR9: Assessment detail API routes rate-limited (30 requests/minute/user)
NFR10: Conversation data accessible only to authenticated users with valid roles
NFR11: No customer PII in application logs or error messages
NFR12: All data access follows Payload CMS RBAC — no custom auth bypass
NFR13: New event handlers do not break existing account, customer, or write-off handlers
NFR14: New handlers follow existing patterns: at-least-once delivery, deduplication, DLQ after 3 failures
NFR15: Conversations collection schema extensions backward-compatible with existing Payload collection
NFR16: S3 assessment fetching uses existing s3-client.ts
NFR17: Polling failure on one view does not affect other views
NFR18: Event processor unavailability does not prevent reading existing conversation data
NFR19: MongoDB queries use appropriate indexes to prevent collection scans

### Additional Requirements

**From Architecture:**
- No starter template needed (brownfield extension of existing Next.js 15 / Payload CMS 3.45.0 application)
- 1 new dependency required: dompurify + @types/dompurify
- Implementation sequence: Event handlers → MongoDB indexes → API routes → Hooks → Components → View registration
- MongoDB compound indexes: { status: 1, decisionStatus: 1, updatedAt: -1 }, { customerId: 1, updatedAt: -1 }, { applicationNumber: 1 }
- Conversations collection schema extensions must use optional fields for backward compatibility
- All new Python handlers must follow upsert pattern with safe_str() and 3-field conversation ID fallback (cid, conv, conversation_id)
- SanitizedHTML component is the single source of truth for DOMPurify usage
- S3 assessment data proxied server-side — pre-signed URLs never exposed to client
- API response format: { conversations[], cursor, hasMore, total } for lists, { conversation } for detail
- Rate limiting middleware on assessment routes (30 req/min/user)
- Status values use lowercase snake_case in MongoDB, mapped to display labels client-side via STATUS_CONFIG constant
- API routes grouped under /api/conversations/ with feature-grouped structure
- React Query hooks: useConversations (5s poll), useConversation (3s poll), useCustomerConversations (30s poll), useAccountConductAssessment (staleTime: Infinity), useServiceabilityAssessment (staleTime: Infinity)
- Component structure: views/ for new views, ServicingView/ConversationsPanel/ for extension
- Event handler pattern: one file per domain, ~11 new handlers in existing conversation.py
- All new event types follow external naming (not our choice): statement_consent_initiated, statement_consent_complete, etc.

**From UX Design:**
- Responsive: 3 breakpoints — desktop (>1200px, 3-col grid), tablet (768-1200px, 2-col), mobile (<768px, 1-col)
- Accessibility: WCAG 2.1 Level AA, colour independence on all badges, keyboard navigation, screen reader support
- Keyboard shortcuts: arrow keys for grid nav, Enter to open, Escape to go back, / for search focus, [ ] for assessment collapse/expand
- Polling update pattern: in-place updates (no card reorder during poll), subtle fade transitions (200ms), freshness indicator in header
- Navigation state preservation: scroll position + filter state saved to Zustand store, restored on return
- Loading states: skeleton loaders matching content layout (card-shaped for grid, bubble-shaped for transcript), never spinners
- Empty states with actionable messages ("Clear filters", "Check back later")
- Filter URL sync: filter state reflected in URL query params for shareable filtered views
- Context-dependent naming: "Applications" in ServicingView, "Conversations" in monitoring grid (same data, different framing)
- "Live" indicator: pulsing blue dot for active conversations in ServicingView applications panel
- prefers-reduced-motion support: disable pulse animations, card entrance animations, fade transitions
- Split panel: 60/40 desktop, stacked tablet, transcript-only with toggle on mobile
- Pre-fetch conversation detail on card hover for instant drill-down
- Contact notes as universal output — all journeys end with option to create a note linked to the conversation

### FR Coverage Map

| FR | Epic | Description |
|:---|:---|:---|
| FR1 | Epic 2 | Card grid with conversation data |
| FR2 | Epic 2 | Status badges (7 states) |
| FR3 | Epic 2 | Auto-updating grid (5s polling) |
| FR4 | Epic 2 | Pagination/infinite scroll |
| FR5 | Epic 2 | Search by customer name/app number |
| FR6 | Epic 2 | Filter by decision status |
| FR7 | Epic 2 | Filter by conversation status |
| FR8 | Epic 2 | Filter by date range |
| FR9 | Epic 2 | Combine multiple filters |
| FR10 | Epic 3 | Full message transcript |
| FR11 | Epic 3 | AI assistant rationale |
| FR12 | Epic 3 | Assessment data by category |
| FR13 | Epic 3 | Collapsible assessment sections |
| FR14 | Epic 3 | Noticeboard with version history |
| FR15 | Epic 3 | Auto-updating detail (3s polling) |
| FR16 | Epic 3 | Application details in conversation |
| FR17 | Epic 3 | Account conduct assessment detail |
| FR18 | Epic 3 | Serviceability assessment detail |
| FR19 | Epic 3 | Navigate to assessment detail |
| FR20 | Epic 4 | Navigate conversation → customer |
| FR21 | Epic 4 | Navigate customer → conversations |
| FR22 | Epic 4 | Conversations in ServicingView |
| FR23 | Epic 4 | Linked to customer + application |
| FR24 | Epic 4 | Status + preview in ServicingView |
| FR25 | Epic 1 | Consume all event types |
| FR26 | Epic 1 | Store full conversation state |
| FR27 | Epic 1 | Statement capture flow events |
| FR28 | Epic 1 | Credit assessment events + S3 refs |
| FR29 | Epic 1 | Post-identity risk events |
| FR30 | Epic 3 | HTML sanitisation |
| FR31 | Epic 3 | Formatted content display |
| FR32 | Epic 2 | Role-based access |
| FR33 | Epic 2 | Readonly can view |
| FR34 | Epic 2 | Nav link in sidebar |
| FR35 | Epic 2 | Access from sidebar |
| FR36 | Epic 4 | Seamless navigation between views |
| FR37 | Epic 2 | Operates within Payload admin template |

## Epic List

### Epic 1: Data Pipeline & API Foundation
The system captures all conversation events and provides API access to conversation data — enabling monitoring, detail, and customer context features.
**FRs covered:** FR25, FR26, FR27, FR28, FR29
**NFRs covered:** NFR7-NFR9, NFR13-NFR16, NFR19
**Dependencies:** None (foundational)

### Epic 2: Conversation Monitoring View
Supervisors can monitor all live conversations in a real-time card grid with search, filters, status badges, and automatic updates.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR9, FR32, FR33, FR34, FR35, FR37
**NFRs covered:** NFR1, NFR3, NFR4, NFR6, NFR10-NFR12
**Dependencies:** Epic 1

### Epic 3: Conversation Detail & Assessments
Users can view full conversation transcripts with chat bubbles, assessment data in collapsible sections, noticeboard history, and detailed credit assessment reports.
**FRs covered:** FR10, FR11, FR12, FR13, FR14, FR15, FR16, FR17, FR18, FR19, FR30, FR31
**NFRs covered:** NFR2, NFR5, NFR7, NFR8, NFR9, NFR17
**Dependencies:** Epic 1, Epic 2

### Epic 4: Customer & Application Context
Staff see applications alongside customer records in ServicingView and navigate seamlessly between conversations, customers, and applications.
**FRs covered:** FR20, FR21, FR22, FR23, FR24, FR36
**NFRs covered:** NFR17, NFR18
**Dependencies:** Epic 1, Epic 3

---

## Epic 1: Data Pipeline & API Foundation

The system captures all conversation events from the loan origination process and provides API access to conversation data — enabling monitoring, detail viewing, and customer context features in subsequent epics.

### Story 1.1: Statement Capture Flow Event Handlers

As the system,
I want to process statement capture flow events from the Redis stream,
So that conversation records include complete statement consent and retrieval data.

**Acceptance Criteria:**

**Given** a `statement_consent_initiated` event arrives on `inbox:billie-servicing`
**When** the event processor handles the event
**Then** the conversations document is upserted with `statementCapture.consentStatus` set to `initiated`
**And** the handler uses the 3-field conversation ID fallback (`cid`, `conv`, `conversation_id`)
**And** `safe_str()` is used for all string extraction

**Given** a `statement_consent_complete` event arrives
**When** the event processor handles the event
**Then** `statementCapture.consentStatus` is updated to `complete`

**Given** a `statement_consent_cancelled` event arrives
**When** the event processor handles the event
**Then** `statementCapture.consentStatus` is updated to `cancelled`

**Given** a `basiq_job_created` event arrives
**When** the event processor handles the event
**Then** `statementCapture.basiqJobId` is stored

**Given** a `statement_retrieval_complete` event arrives
**When** the event processor handles the event
**Then** `statementCapture.retrievalComplete` is set to `true`

**Given** an `affordability_report_complete` event arrives
**When** the event processor handles the event
**Then** `statementCapture.affordabilityReport` is stored as the event payload

**Given** a `statement_checks_complete` event arrives
**When** the event processor handles the event
**Then** `statementCapture.checksComplete` is set to `true`

**Given** any handler fails processing
**When** the failure count reaches 3
**Then** the event is moved to the DLQ following existing patterns (NFR14)

**Given** existing conversation event handlers
**When** the new handlers are deployed
**Then** existing handlers for accounts, customers, and write-offs continue to function (NFR13)

### Story 1.2: Credit Assessment & Post-Identity Event Handlers

As the system,
I want to process credit assessment results and post-identity risk check events,
So that conversation records include assessment outcomes and S3 file references.

**Acceptance Criteria:**

**Given** an `account_conduct_assessment_results` event arrives with an S3 key in the payload
**When** the event processor handles the event
**Then** the conversations document is upserted with `assessments.accountConduct.s3Key` and `assessments.accountConduct.decision`

**Given** a `serviceability_assessment_results` event arrives with an S3 key in the payload
**When** the event processor handles the event
**Then** the conversations document is upserted with `assessments.serviceability.s3Key` and `assessments.serviceability.decision`

**Given** a `post_identity_risk_check` event arrives
**When** the event processor handles the event
**Then** the conversations document is upserted with `assessments.postIdentityRisk` containing the risk assessment data

**Given** a `credit_assessment_complete` event arrives
**When** the event processor handles the event
**Then** the relevant assessment fields are updated on the conversation document

**Given** events arrive out of order (e.g., assessment before identity)
**When** the handler processes them
**Then** `upsert=True` ensures the document is created or updated without error

**Given** all new handlers are registered
**When** the event processor starts
**Then** the `__init__.py` handler map includes all new event type to handler function mappings

### Story 1.3: Conversations Collection Schema & Indexes

As a developer,
I want the Conversations Payload collection extended with new optional fields and MongoDB indexes created,
So that the API routes can query conversations efficiently and the schema matches the event processor output.

**Acceptance Criteria:**

**Given** the existing Conversations Payload collection
**When** the schema is extended
**Then** new fields are added as optional: `statementCapture` (object), `assessments.accountConduct.s3Key` (text), `assessments.serviceability.s3Key` (text), `assessments.postIdentityRisk` (object)
**And** existing fields are unchanged (NFR15 — backward compatible)

**Given** the MongoDB conversations collection
**When** indexes are created
**Then** a compound index exists on `{ status: 1, decisionStatus: 1, updatedAt: -1 }`
**And** an index exists on `{ customerId: 1, updatedAt: -1 }`
**And** an index exists on `{ applicationNumber: 1 }`
**And** queries for the monitoring grid use the compound index (NFR19)

**Given** the Payload collection definition is updated
**When** `pnpm generate:types` is run
**Then** `src/payload-types.ts` includes the new optional fields
**And** `pnpm generate:importmap` regenerates the import map

### Story 1.4: Conversations List & Search API Route

As a developer building the monitoring view,
I want a GET `/api/conversations` endpoint that returns paginated, filterable conversation data,
So that the frontend can display and search conversations.

**Acceptance Criteria:**

**Given** an authenticated user with a valid role (admin, supervisor, operations, readonly)
**When** they call `GET /api/conversations`
**Then** a paginated list of conversations is returned in the format `{ conversations: [], cursor: string | null, hasMore: boolean, total: number }`

**Given** query parameters `?status=active&decision=approved&from=2026-01-01&to=2026-04-01&q=john&limit=20`
**When** the API processes the request
**Then** filters are composed with AND logic against the conversations collection
**And** text search uses case-insensitive regex on `customer.fullName` and `applicationNumber`
**And** results are sorted by `updatedAt` descending

**Given** a `cursor` parameter from a previous response
**When** the next page is requested
**Then** results continue from the cursor position using `updatedAt` + `_id`

**Given** an unauthenticated request
**When** the API route is called
**Then** a 401 error is returned (NFR10)

**Given** the API response
**When** it contains conversation data
**Then** each conversation summary includes: `conversationId`, `customer.fullName`, `customer.customerId`, `applicationNumber`, `status`, `decisionStatus`, `application.loanAmount`, `application.purpose`, `messageCount`, `lastMessageAt`, `updatedAt`

**Given** the API route
**When** a Zod schema validates the response
**Then** the schema is defined in `src/lib/schemas/conversations.ts`

### Story 1.5: Conversation Detail API Route

As a developer building the detail view,
I want a GET `/api/conversations/:conversationId` endpoint that returns full conversation data,
So that the frontend can display transcripts, assessments, and noticeboard.

**Acceptance Criteria:**

**Given** an authenticated user with a valid role
**When** they call `GET /api/conversations/:conversationId` with a valid ID
**Then** the full conversation is returned in the format `{ conversation: ConversationDetail }`
**And** the response includes: `utterances[]`, `assessments` (all types), `statementCapture`, `noticeboard[]`, `customer`, `application`, `status`, `decisionStatus`, `summary`

**Given** a non-existent conversationId
**When** the API route is called
**Then** a 404 error is returned: `{ error: { code: "NOT_FOUND", message: "Conversation not found" } }`

**Given** no customer PII
**When** an error is logged server-side
**Then** the log does not include customer names, addresses, or other PII (NFR11)

### Story 1.6: Credit Assessment S3 Proxy API Routes

As a developer building the assessment detail pages,
I want API routes that fetch credit assessment JSON from S3 and return it to the client,
So that assessment data is accessible without exposing S3 credentials or URLs to the browser.

**Acceptance Criteria:**

**Given** an authenticated user with a valid role
**When** they call `GET /api/conversations/:conversationId/assessments/account-conduct`
**Then** the API fetches the assessment JSON from S3 using the `s3Key` stored on the conversation document
**And** returns the parsed JSON in the format `{ assessment: AccountConductAssessment }`
**And** S3 pre-signed URLs are never returned to the client (NFR8)

**Given** an authenticated user
**When** they call `GET /api/conversations/:conversationId/assessments/serviceability`
**Then** the serviceability assessment JSON is fetched from S3 and returned similarly

**Given** the S3 bucket name in the key
**When** the route validates the request
**Then** the bucket is checked against the allowlist in existing `s3-client.ts` (NFR8, NFR16)
**And** path traversal is prevented

**Given** a user making more than 30 requests per minute to assessment routes
**When** the rate limit is exceeded
**Then** a 429 status is returned with `{ error: { code: "RATE_LIMITED", message: "Too many requests" } }` (NFR9)

**Given** the conversation has no assessment data (S3 key is null)
**When** the API route is called
**Then** a 404 is returned: `{ error: { code: "NOT_FOUND", message: "Assessment not available" } }`

**Given** `dompurify` is not yet installed in the project
**When** this story is implemented
**Then** `pnpm add dompurify @types/dompurify` is run and the dependency is available for Epic 3

---

## Epic 2: Conversation Monitoring View

Supervisors can monitor all live conversations in a real-time card grid with search, filters, status badges, and automatic updates.

### Story 2.1: ApplicationsView Scaffold & Navigation

As a supervisor,
I want an "Applications" link in the Payload admin sidebar that opens a monitoring view,
So that I can access conversation monitoring from anywhere in the CRM.

**Acceptance Criteria:**

**Given** a user with role admin, supervisor, or operations
**When** they view the Payload admin sidebar
**Then** an "Applications" nav link is visible (FR34, FR35)

**Given** a user with role readonly
**When** they view the Payload admin sidebar
**Then** the "Applications" nav link is visible (FR33 — readonly can view)

**Given** a user clicks the "Applications" nav link
**When** the view loads
**Then** the ApplicationsView renders within the Payload admin template with sidebar (FR37)
**And** the view uses the `ApplicationsViewWithTemplate` wrapper pattern
**And** the route is `/admin/applications`

**Given** the ApplicationsView is registered
**When** `pnpm generate:importmap` is run
**Then** the import map is regenerated to include the new view

**Given** an unauthenticated user
**When** they navigate to `/admin/applications`
**Then** they are redirected to the login page (NFR10)

### Story 2.2: ConversationCard & StatusBadge Components

As a supervisor,
I want each conversation displayed as a card with status badge, customer name, application details, and message preview,
So that I can scan conversations and understand their state at a glance.

**Acceptance Criteria:**

**Given** a conversation with status `active`
**When** the ConversationCard renders
**Then** it displays: status badge (blue dot + "Active" label), customer name (bold, 14px), application number (mono, 12px), loan amount and purpose, last message preview (truncated to 2 lines, muted), message count, and relative time indicator (FR1)

**Given** each of the 7 conversation statuses (active, paused, soft_end, hard_end, approved, declined, ended)
**When** the StatusBadge renders
**Then** each status shows the correct colour dot + icon + text label as defined in the visual foundation (FR2)
**And** the badge is accessible with `aria-label="Status: {status name}"`

**Given** a conversation with status `paused` for more than 5 minutes
**When** the card renders
**Then** the card has an amber left border accent to draw attention

**Given** the monitoring grid is viewed on mobile (<768px)
**When** cards render
**Then** the message preview is hidden and the card shows a compact layout
**And** the card tap area is the full card surface (minimum 44px touch target)

**Given** a ConversationCard
**When** the user hovers with a mouse
**Then** the card shows a darker border and subtle shadow

### Story 2.3: Monitoring Grid with Real-Time Polling

As a supervisor,
I want the conversation grid to update automatically every 5 seconds without layout jank,
So that I can see conversation status changes in near-real-time without manual refresh.

**Acceptance Criteria:**

**Given** the ApplicationsView loads
**When** the `useConversations` hook fetches data
**Then** conversations are displayed in a responsive CSS Grid: 3 columns (>1200px), 2 columns (768-1200px), 1 column (<768px)
**And** conversations are sorted by most recent activity (FR4)

**Given** the grid is displayed
**When** the `useConversations` hook polls at 5-second intervals (FR3)
**Then** card content updates in-place with a subtle fade transition (200ms)
**And** card positions do NOT reorder during a poll cycle (NFR4)
**And** polling stops when the browser tab is not focused (`refetchIntervalInBackground: false`)

**Given** the grid is loading for the first time
**When** data has not yet arrived
**Then** 6 skeleton card placeholders are displayed matching the card layout (NFR1)

**Given** the grid has loaded
**When** the FreshnessIndicator component renders in the page header
**Then** it is hidden when data is fresh (< 10s), shows grey text at 10-30s, amber text at 30-60s, and an amber badge after 60s

**Given** more conversations exist than the page size
**When** the user scrolls to the bottom or clicks "Load more"
**Then** the next page is fetched using cursor-based pagination
**And** scroll position is preserved during pagination

**Given** 15+ concurrent users are viewing the monitoring grid
**When** all are polling at 5s intervals
**Then** the system handles the load without degradation (NFR6)

### Story 2.4: Conversation Search & Filtering

As a supervisor,
I want to search conversations by customer name or application number and filter by status, decision, and date range,
So that I can find specific conversations quickly for monitoring or investigation.

**Acceptance Criteria:**

**Given** the filter bar is displayed at the top of the monitoring grid
**When** the user types in the search input
**Then** results filter by customer name or application number with 300ms debounce (FR5)

**Given** the decision status dropdown
**When** the user selects "Declined"
**Then** only conversations with `decisionStatus: declined` are shown (FR6)

**Given** the conversation status dropdown
**When** the user selects "Active"
**Then** only conversations with `status: active` are shown (FR7)

**Given** the date range picker
**When** the user sets a from and to date
**Then** only conversations updated within that range are shown (FR8)

**Given** multiple filters are applied (e.g., status: active + decision: approved + date range)
**When** the results render
**Then** all filters combine with AND logic (FR9)
**And** results update immediately on each filter change — no "Apply" button needed (NFR3)

**Given** filters are applied
**When** the user clicks "Clear filters"
**Then** all filters reset to default and the full conversation list is shown

**Given** active filters
**When** the URL is inspected
**Then** filter state is reflected in URL query params (e.g., `?status=declined&from=2026-03-27`)
**And** sharing this URL reproduces the filtered view

**Given** the user navigates to conversation detail and returns
**When** the monitoring grid reloads
**Then** filter state is restored from the `useConversationFiltersStore` (Zustand)

**Given** no conversations match the active filters
**When** the grid renders
**Then** an empty state message is shown: "No conversations match your filters. [Clear filters]"

**Given** the monitoring grid is focused
**When** the user presses `/`
**Then** the search input is focused

**Given** the user presses arrow keys
**When** cards are focused
**Then** focus moves between cards, and Enter opens the selected conversation detail

---

## Epic 3: Conversation Detail & Assessments

Users can view full conversation transcripts with chat bubbles, assessment data in collapsible sections, noticeboard history, and detailed credit assessment reports.

### Story 3.1: ConversationDetailView with Split-Panel Layout

As a supervisor,
I want to click a conversation card and see a split-panel view with the transcript on the left and assessments on the right,
So that I can review the full conversation and assessment data side by side.

**Acceptance Criteria:**

**Given** the user clicks a ConversationCard in the monitoring grid
**When** the ConversationDetailView loads at `/admin/applications/:conversationId`
**Then** a split-panel layout renders: 60% left (transcript), 40% right (assessments)
**And** the view is wrapped in `ConversationDetailViewWithTemplate` within the Payload admin template

**Given** the ConversationDetailView
**When** it renders
**Then** a ConversationHeader displays: breadcrumb ("Applications > Customer Name > APP-XXXXX"), status badge, loan amount/purpose, and a "View profile →" link to the customer's ServicingView (FR16)

**Given** the `useConversation` hook
**When** data loads
**Then** the conversation detail is fetched from `GET /api/conversations/:conversationId`
**And** the hook polls at 3-second intervals (FR15)
**And** `refetchIntervalInBackground: false`

**Given** the detail view is loading
**When** data has not yet arrived
**Then** skeleton placeholders render: message bubble shapes on the left, section shapes on the right (NFR2 — load < 1 second)

**Given** the view on a tablet (768-1200px)
**When** the layout renders
**Then** the panels stack vertically: transcript on top, assessments below (collapsible)

**Given** the view on mobile (<768px)
**When** the layout renders
**Then** only the transcript is shown by default with an "Assessments" toggle button
**And** the customer link is a sticky button at bottom of screen

**Given** the user presses Escape
**When** in the conversation detail view
**Then** they navigate back to the monitoring grid

### Story 3.2: Chat Transcript & HTML Sanitisation

As a supervisor,
I want to read the conversation transcript as chat bubbles with customer messages on the left and AI assistant messages on the right,
So that I can follow the conversation flow naturally and safely view formatted content.

**Acceptance Criteria:**

**Given** a conversation with utterances
**When** the MessagePanel renders
**Then** customer messages are displayed as left-aligned bubbles on `--theme-elevation-100` background
**And** AI assistant messages are displayed as right-aligned bubbles on `--theme-primary-100` background (FR10)

**Given** an assistant message with rationale data
**When** the MessageBubble renders
**Then** the rationale is displayed as italic sub-text below the bubble in `--theme-text-secondary` colour (FR11)

**Given** messages within the same 1-minute window
**When** they render
**Then** they share a single timestamp header between message groups rather than individual timestamps

**Given** a message containing HTML content (bold, italic, links, lists)
**When** the SanitizedHTML component renders it
**Then** HTML is sanitised via DOMPurify with strict allowlist: `b`, `i`, `em`, `strong`, `a`, `p`, `br`, `ul`, `ol`, `li`, `span` (FR30, FR31, NFR7)
**And** `dangerouslySetInnerHTML` is ONLY used inside the SanitizedHTML component
**And** no other component in the codebase uses `dangerouslySetInnerHTML` directly

**Given** new messages arrive during 3s polling
**When** the user has not scrolled up
**Then** new messages append at the bottom and the view auto-scrolls

**Given** the user has scrolled up in the transcript
**When** new messages arrive via polling
**Then** messages append at the bottom but the scroll position is preserved (user is not auto-scrolled)

**Given** a message bubble
**When** a screen reader encounters it
**Then** `aria-label` announces the speaker: "Customer message" or "Assistant message"

### Story 3.3: Assessment Panel & Noticeboard

As a supervisor,
I want to view assessment data organised by category in collapsible sections alongside the conversation,
So that I can quickly triage which assessments need review without scrolling through all details.

**Acceptance Criteria:**

**Given** the AssessmentPanel renders in the right panel
**When** assessment data is available
**Then** sections are displayed for: Application Details, Identity, Credit (Account Conduct), Credit (Serviceability), Statements, Noticeboard (FR12)

**Given** all assessment sections
**When** the panel first loads
**Then** all sections are collapsed by default showing one-line summaries (FR13):
- Application: "$5,000 · 12mo · Debt Consolidation"
- Identity: "✓ Verified · Low risk" or "⚠ Refer · Medium risk"
- Credit (Account Conduct): "PASS" or "FAIL" with "View full details →" link
- Credit (Serviceability): "PASS" or "FAIL" with "View full details →" link
- Statements: "Consent: Complete · 3 files"
- Noticeboard: latest post preview

**Given** a collapsed section
**When** the user clicks the section header
**Then** the section expands to show full detail
**And** `aria-expanded` toggles appropriately

**Given** the Noticeboard section
**When** it expands
**Then** all noticeboard posts are displayed with version history (FR14)
**And** the latest version is prominent, prior versions are expandable

**Given** the user presses `[`
**When** in the conversation detail view
**Then** all assessment sections collapse

**Given** the user presses `]`
**When** in the conversation detail view
**Then** all assessment sections expand

### Story 3.4: Credit Assessment Detail Pages

As a supervisor,
I want to click through from an assessment summary to a full-page credit assessment detail view,
So that I can review individual rule results, scoring details, and processed files.

**Acceptance Criteria:**

**Given** the Account Conduct assessment section shows "PASS" or "FAIL"
**When** the user clicks "View full details →"
**Then** they navigate to `/admin/applications/:conversationId/assessment/account-conduct` (FR19)
**And** the breadcrumb shows "Applications > Customer Name > APP-XXXXX > Account Conduct"

**Given** the account conduct detail page
**When** it loads
**Then** it displays: overall decision, individual rule results with pass/fail indicators, scoring details (FR17)
**And** data is fetched via `useAccountConductAssessment` hook with `staleTime: Infinity` (immutable data)
**And** the page loads within 3 seconds including S3 fetch (NFR5)

**Given** the Serviceability assessment section
**When** the user clicks "View full details →"
**Then** they navigate to `/admin/applications/:conversationId/assessment/serviceability`
**And** the page displays: overall decision, monthly metrics, rule results, processed files (FR18)

**Given** a conversation with no assessment data (S3 key is null)
**When** the detail page loads
**Then** a message is shown: "No assessment data available for this conversation."

**Given** the user on the assessment detail page
**When** they click the breadcrumb or press Escape
**Then** they return to the conversation detail view with the split panel state preserved

---

## Epic 4: Customer & Application Context

Staff see applications alongside customer records in ServicingView and navigate seamlessly between conversations, customers, and applications.

### Story 4.1: ApplicationsPanel in ServicingView

As an operations staff member,
I want to see a customer's loan applications listed below contact notes in the ServicingView,
So that I know their application history and whether they have an active application right now.

**Acceptance Criteria:**

**Given** a customer's ServicingView is loaded
**When** the ApplicationsPanel renders below ContactNotesPanel
**Then** the panel header shows "Applications (N)" with the count of applications (FR22)

**Given** the `useCustomerConversations` hook
**When** it fetches data
**Then** it returns conversations for the current customer filtered by `customerId`
**And** polls at 30-second intervals (background context)

**Given** a customer with applications
**When** the panel renders
**Then** each application is displayed as a compact card showing: status badge, application number, loan amount, purpose, date (FR24)
**And** active applications are shown first with a pulsing blue dot "Live" indicator
**And** historical applications are sorted by date (newest first)

**Given** an application that was approved and a loan was disbursed
**When** the card renders
**Then** a link icon connects to the corresponding loan account in the AccountPanel above (FR23)

**Given** a customer with no applications
**When** the panel renders
**Then** an empty state shows: "No applications found for this customer."

**Given** the panel is loading
**When** data has not yet arrived
**Then** 2 skeleton compact card placeholders are displayed

**Given** the panel encounters a fetch error
**When** it renders
**Then** an inline "Unable to load" message is shown without blocking the rest of the ServicingView (NFR18)

**Given** the `prefers-reduced-motion` system setting is enabled
**When** an active application card renders
**Then** the "Live" indicator shows a static blue dot instead of pulsing animation

### Story 4.2: Bidirectional Navigation & State Preservation

As a supervisor or operations staff member,
I want to navigate between conversations, customers, and applications seamlessly with my position preserved,
So that I can investigate across views without losing context.

**Acceptance Criteria:**

**Given** the ConversationDetailView header shows "Customer: John Smith — View profile →"
**When** the user clicks the customer link
**Then** they navigate to `/admin/servicing/:customerId` (FR20)
**And** the conversation detail state is preserved in browser history

**Given** an application card in the ServicingView ApplicationsPanel
**When** the user clicks the card
**Then** they navigate to the ConversationDetailView at `/admin/applications/:conversationId` (FR21)
**And** the breadcrumb shows "Servicing > Customer Name > APP-XXXXX" (context-aware based on entry point)

**Given** the user navigated from the monitoring grid to conversation detail to customer ServicingView
**When** they press the browser back button
**Then** each step is reversed correctly: ServicingView → conversation detail → monitoring grid
**And** browser history is not manipulated (standard back/forward behaviour)

**Given** the user returns to the monitoring grid after viewing a conversation
**When** the grid renders
**Then** the scroll position is restored from the `useMonitoringGridStore` (Zustand)
**And** filter state is restored from `useConversationFiltersStore`

**Given** the user returns to ServicingView from a conversation detail
**When** the view renders
**Then** the scroll position is preserved via browser history

**Given** all views in the navigation graph (monitoring grid, conversation detail, assessment detail, ServicingView)
**When** the user navigates between them
**Then** every node is reachable from every other node in 1-2 clicks (FR36)
**And** all "View profile →" and application card links open in the same tab (not new tab)

**Given** an approved application card in the ApplicationsPanel
**When** the user clicks the loan account link icon
**Then** the AccountPanel scrolls to and selects the corresponding loan account
