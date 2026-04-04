---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation-skipped
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
status: complete
completedAt: '2026-04-03'
classification:
  projectType: web_app
  domain: fintech
  complexity: high
  projectContext: brownfield
inputDocuments:
  - billie-realtime/docs/functional-specification.md
  - billie-realtime/docs/technical-solution.md
  - billie-realtime/docs/target-state-architecture.md
  - _bmad-output/planning-artifacts/product-brief-billie-crm-2026-02-20.md
  - docs/project_context.md
  - docs/project-overview.md
  - docs/integration-architecture.md
documentCounts:
  briefs: 1
  research: 0
  brainstorming: 0
  projectDocs: 4
workflowType: 'prd'
---

# Product Requirements Document — billie-crm-applications

**Author:** Rohan
**Date:** 2026-04-03

## Executive Summary

**billie-crm-applications** replatforms the standalone billie-realtime supervisor dashboard into billie-crm, consolidating loan origination conversation monitoring into the existing staff servicing application.

**Vision:** A single CRM where staff can monitor live loan origination conversations, investigate fraud signals, and service customer accounts — all in one place, with full context linking between conversations, customers, and applications.

**What it replaces:** billie-realtime — a standalone Next.js app with its own auth (NextAuth), state layer (Redis KV), worker process, and Fly.io deployment. After this replatform, billie-realtime is retired.

**What it adds beyond parity:**
- Conversations linked to customer records and applications (billie-realtime has no customer context)
- Rich search by decision status, date range, application number, customer name
- Operations staff access to conversation data while servicing customers
- All within the existing Payload CMS admin with established auth, roles, and UI patterns

**Target users:** Supervisors (5-15 concurrent, primary monitoring), Operations staff (customer context while servicing), Admins (full access and verification).

**Technical approach:** Payload CMS custom views, React Query polling (3-5 second intervals), MongoDB reads from the existing `conversations` collection. Event processor extended with ~11 new handlers for complete conversation data coverage. No new infrastructure — leverages existing auth, S3 client, and deployment pipeline.

## Success Criteria

### User Success

- **Unified monitoring**: Supervisors monitor live conversations within billie-crm — no context switching to a separate app
- **Customer-linked conversations**: ServicingView shows conversations alongside loan accounts, balances, contact notes, and servicing history
- **Dedicated monitoring view**: All Conversations card grid with status badges, message previews, and near-real-time updates
- **Application context**: Conversations linked to both Applications and Customers
- **Rich search**: Filter by decision status, conversation status, date range, application number, customer name
- **Performance parity or better**: Updates within 5 seconds; experience at least as responsive as billie-realtime

### Business Success

- **Eliminate billie-realtime**: Retire standalone app, reducing operational complexity and infrastructure cost
- **Single customer view**: Conversation + servicing data together — complete picture of every customer interaction
- **Fraud and issue investigation**: Explore conversations for issues or fraud without leaving the CRM
- **Engineering focus**: Free capacity from maintaining a separate app to invest in target state

### Technical Success

- **Architectural alignment**: Payload CMS custom views, React Query hooks, Zustand stores — same patterns as existing features
- **Existing auth**: Payload RBAC (no separate auth system)
- **MongoDB as source**: Read from `conversations` collection populated by event processor — eliminate Redis KV layer
- **Simplicity**: No separate worker, no Redis Pub/Sub, no standalone deployment

### Measurable Outcomes

| Metric | Target |
|--------|--------|
| Conversation update latency | < 5 seconds from event to UI |
| Search response time | < 1 second |
| Feature parity | 100% of billie-realtime capabilities |
| Apps eliminated | 1 (billie-realtime retired) |
| Infrastructure removed | Redis KV state, dedicated worker, standalone Fly.io app |

## Project Scoping & Phased Development

### MVP Strategy

**Approach:** Feature-parity replatform — the minimum that makes billie-realtime fully replaceable. MVP is done when billie-realtime can be turned off.

**Resource Requirements:** Single developer with knowledge of billie-crm patterns (Payload, React Query, Zustand) and the event processor (Python, Redis Streams, MongoDB).

### MVP Feature Set (Phase 1)

**All four user journeys supported in full.**

1. **Event Processor Extensions**
   - Add handlers for ~11 missing event types (statement flow, credit assessments, post-identity checks)
   - Extend conversations MongoDB schema to store statement capture events, credit assessment results, and post-identity data
   - All events routed via existing `inbox:billie-servicing` stream

2. **All Conversations Monitoring View**
   - Card grid: customer name, application number, status badge, loan amount/purpose, last message preview, message count, time indicators
   - Status badges: active, paused, soft end, hard end, approved, declined, ended
   - Infinite scroll or pagination, sorted by most recent activity
   - Rich search: decision status, conversation status, date range, application number, customer name
   - Polling updates (5-second interval)

3. **Conversation Detail View**
   - Split-panel: messages (left, 60%) + assessments/noticeboard (right, 40%)
   - Chat bubbles: customer left-aligned, assistant right-aligned, with timestamps and optional rationale
   - Assessment panels: collapsible sections grouped by category (Application, Identity, Credit, Statements, Noticeboard)
   - Noticeboard with version history
   - Polling updates (3-second interval)
   - HTML message sanitisation (DOMPurify)

4. **Credit Assessment Detail Pages**
   - Account conduct: decision, individual rule results, pass/fail indicators, scoring details (S3-backed)
   - Serviceability: decision, monthly metrics, rule results, processed files (S3-backed)

5. **ServicingView Integration**
   - Conversations panel within existing customer view
   - Linked to customer and application records
   - Conversation status and last message preview
   - Click-through to full conversation detail
   - Polling updates (30-second interval)

6. **Navigation & Access**
   - Nav link in Payload admin sidebar
   - Role-based access: admin, supervisor, operations can view; readonly can view
   - Bidirectional navigation: conversation ↔ customer record

### Post-MVP Features (Phase 2)

- Conversation-linked contact notes
- Notification alerts for specific events (declined decisions, fraud flags)
- Saved search filters and supervisor preferences
- Connection status indicator
- Upgrade from polling to SSE/change streams if needed

### Future Vision (Phase 3)

- AI-assisted conversation summarisation
- Automated fraud pattern detection
- Cross-conversation analytics and trend reporting
- Customer-facing interaction history

### Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Event processor schema changes break existing handlers | Low | High | New handlers alongside existing ones; assessments stored in existing dict |
| Polling load on MongoDB | Low | Medium | 5-15 users × 5s = 3-9 queries/sec; index on status + date |
| S3 assessment fetch performance | Low | Medium | Existing S3 client proven; rate limit 30 req/min/user |
| Message HTML XSS | Medium | High | DOMPurify with strict allowlist matching billie-realtime |
| Missing conversation data in MongoDB | Medium | High | Extend event processor with ~11 new handlers before UI work |

## User Journeys

### Journey 1: Supervisor Live Monitoring (Primary — Success Path)

**Alex Nguyen — Supervisor, 8 years at Billie**

Alex manages a team of five support agents and oversees the AI-powered loan origination process. Every morning, she opens billie-crm and navigates to the Applications view — a dedicated monitoring screen showing all active and recent conversations as a card grid.

**Opening Scene:** It's 9:15am. Alex sees 12 active conversations (green pulsing badges), 3 paused (amber), and several completed from overnight. She scans the cards — customer names, application numbers, loan amounts, last message previews, and time-since-last-activity all visible at a glance.

**Rising Action:** One card catches her eye — a $5,000 loan request paused for 6 minutes. She clicks in: split-panel with chat transcript on the left, assessments on the right. The customer was asked for bank statement consent and hasn't responded. Identity risk shows "medium risk." The noticeboard shows a fraud check agent flagging an address discrepancy.

**Climax:** She clicks through to the customer's ServicingView record. This customer has an existing loan 15 days past due. Contact notes show a complaint logged last week. The combination — address flag, arrears, new application — paints a picture. She flags it for follow-up.

**Resolution:** Over the day, Alex monitors conversations. Declines get an assessment review. Approvals get a serviceability check. End of day: origination process running cleanly, one case flagged — all without leaving billie-crm.

> **Capabilities:** Monitoring view, real-time updates, conversation detail, navigation to customer context, credit assessment pages, status badges.

### Journey 2: Operations Staff — Customer Context (Primary — Alternative Path)

**Sarah Chen — Senior Support Specialist**

A customer calls asking about their loan application status. Previously, Sarah had no visibility into origination conversations.

**Opening Scene:** Sarah opens the customer's ServicingView. Under loan accounts and contact notes, she sees a Conversations section: one completed (approved, 3 months ago) and one active from this morning.

**Rising Action:** She clicks the active conversation. The AI assistant is collecting bank statement consent. Application details show $3,000, 12-month term, debt consolidation.

**Climax:** The customer asks "will I be approved?" Sarah can see identity check passed and conversation progressing normally. She advises the customer their application is in progress.

**Resolution:** Sarah creates a contact note linked to the customer and conversation. Next agent sees the full picture.

> **Capabilities:** ServicingView conversations panel, customer/application linking, operations read access, contact notes integration.

### Journey 3: Supervisor — Fraud Investigation (Edge Case)

**Alex Nguyen — same supervisor, different day**

**Opening Scene:** Alex filters the All Conversations view by "declined" decisions from the past week. Eight results.

**Rising Action:** A suspicious conversation: inconsistent employer answers, eKYC "refer" result, fraud check agent flagging a device fingerprint match with a previously declined application.

**Climax:** She clicks through to the customer record. No existing loans — first-time applicant. But the address matches a customer who defaulted last year. She creates a contact note documenting the pattern.

**Resolution:** Conversation data, assessment results, and customer records in one place. Full application journey traceable without a separate tool.

> **Capabilities:** Rich search, assessment detail, cross-reference with customer records, fraud signal visibility, noticeboard.

### Journey 4: Admin — System Verification

**David Park — System Admin**

David verifies the new feature: event processor consuming events, conversations appearing in the monitoring view, role-based access working correctly. No new infrastructure to manage — billie-realtime can be decommissioned.

> **Capabilities:** Role verification, system status, no new infrastructure.

### Journey Requirements Summary

| Capability | J1 (Monitoring) | J2 (Context) | J3 (Investigation) | J4 (Admin) |
|------------|:---:|:---:|:---:|:---:|
| All Conversations monitoring view | x | | x | x |
| Conversation detail (messages + assessments) | x | x | x | |
| Credit assessment detail pages | x | | x | |
| Real-time status updates | x | | | x |
| ServicingView conversations panel | x | x | | |
| Customer/Conversation/Application linking | x | x | x | |
| Rich search and filtering | | | x | |
| Status badge logic | x | | x | |
| Noticeboard display | x | | x | |
| Role-based access | | x | | x |
| Contact notes integration | | x | x | |

## Domain-Specific Requirements

### Compliance & Regulatory

- **PII visibility**: Conversations contain customer PII (name, address, DOB, employment). Existing Payload RBAC applies — admin, supervisor, operations, readonly can view.
- **Australian Privacy Principles (APPs)**: No new data collection. Event processor already stores conversation data; new views surface existing data only.
- **Credit reporting**: Assessment data fetched from S3 using existing `s3-client.ts` with bucket validation and path traversal prevention.

### Technical Constraints

- **XSS prevention**: Messages contain HTML. Sanitise with DOMPurify using strict allowlist: `b`, `i`, `em`, `strong`, `a`, `p`, `br`, `ul`, `ol`, `li`, `span`.
- **S3 access control**: Assessment pages fetch JSON from S3. Existing bucket allowlisting and URL validation applies.
- **Rate limiting**: Assessment detail API routes rate-limited at 30 requests/minute/user.

## Web App Specific Requirements

### Technical Architecture

**Browser Support:** Chrome, Edge, Safari (latest 2 major versions). Internal tool — no Firefox or mobile required.

**Responsive Design:** Desktop-first. No mobile or tablet optimisation.

**Accessibility:** Basic WCAG 2.1 Level A — semantic HTML, keyboard navigation, sufficient colour contrast for status badges.

### Real-Time Strategy

**Approach: Polling via React Query `refetchInterval`**

| View | Interval | Rationale |
|------|----------|-----------|
| All Conversations grid | 5 seconds | Freshness vs server load for bulk data |
| Conversation detail | 3 seconds | Responsive when actively watching |
| ServicingView conversations panel | 30 seconds | Background context |

**Why polling:** Aligns with existing React Query patterns. No new infrastructure. 5-15 users × 5s = negligible MongoDB load. Within < 5s latency target. Upgradeable to SSE/change streams without changing component layer.

**Implementation:** `useQuery` with `refetchInterval`, `refetchIntervalInBackground: false`, stale time matching refetch interval.

### Performance Targets

| Metric | Target |
|--------|--------|
| All Conversations page load | < 2 seconds |
| Conversation detail load | < 1 second |
| Search/filter response | < 1 second |
| Polling update cycle | 3-5 seconds (view-dependent) |
| Concurrent users | 15+ |

### Implementation Approach

- **Custom views**: Register in `payload.config.ts` under `admin.views`
- **Navigation**: Add nav link via `admin.components.beforeNavLinks`
- **Data source**: MongoDB `conversations` collection via Payload CMS
- **Existing infrastructure**: Event processor (writes), Payload auth (roles), S3 client (assessments), React Query (data fetching), Zustand (UI state)

## Functional Requirements

### Conversation Monitoring

- **FR1:** Supervisors can view all conversations in a card grid showing customer name, application number, status badge, loan amount/purpose, last message preview, message count, and time indicators
- **FR2:** Supervisors can see conversation status badges reflecting current state (active, paused, soft end, hard end, approved, declined, ended)
- **FR3:** Supervisors can see the conversation grid update automatically at regular intervals without manual refresh
- **FR4:** Supervisors can paginate or infinite-scroll through conversations sorted by most recent activity

### Conversation Search & Filtering

- **FR5:** Users can search conversations by customer name or application number
- **FR6:** Users can filter conversations by decision status (approved, declined, no decision)
- **FR7:** Users can filter conversations by conversation status (active, paused, ended)
- **FR8:** Users can filter conversations by date range
- **FR9:** Users can combine multiple search and filter criteria simultaneously

### Conversation Detail

- **FR10:** Users can view the full message transcript with messages attributed to customer or AI assistant
- **FR11:** Users can view the AI assistant's rationale for each response when available
- **FR12:** Users can view assessment data organised by category (Application, Identity, Credit, Statements, Noticeboard)
- **FR13:** Users can expand and collapse individual assessment sections
- **FR14:** Users can view noticeboard posts with version history
- **FR15:** Users can see conversation detail update automatically at regular intervals
- **FR16:** Users can view application details (loan amount, purpose, term) within the conversation

### Credit Assessment Detail

- **FR17:** Users can view full account conduct assessment: overall decision, individual rule results, pass/fail indicators, scoring details
- **FR18:** Users can view full serviceability assessment: overall decision, monthly metrics, rule results, processed files
- **FR19:** Users can navigate from a conversation's assessment panel to the detailed assessment view

### Customer & Application Context

- **FR20:** Users can navigate from a conversation to the associated customer's ServicingView record
- **FR21:** Users can navigate from a customer's record to their associated conversations
- **FR22:** Users can see conversations alongside loan accounts, contact notes, and servicing history in the ServicingView
- **FR23:** Conversations are linked to both customer and application records
- **FR24:** Users can see conversation status and last message preview from within the ServicingView

### Event Processing

- **FR25:** The system consumes and processes all conversation event types from `inbox:billie-servicing` (messages, assessments, statement flow, credit assessments, noticeboard, decisions, summaries)
- **FR26:** The system stores full conversation state in MongoDB: utterances, all assessment types, noticeboard posts, application details, final decisions
- **FR27:** The system handles statement capture flow events (consent initiated/complete/cancelled, basiq job, retrieval, affordability report, statement checks)
- **FR28:** The system handles credit assessment result events (account conduct, serviceability) including S3 file location references
- **FR29:** The system handles post-identity risk check events

### Message Display & Security

- **FR30:** The system sanitises all conversation message HTML before rendering
- **FR31:** Users can view formatted message content (bold, italic, links, lists) within sanitised boundaries

### Access Control

- **FR32:** Admin, supervisor, and operations roles can access conversation monitoring and details
- **FR33:** Readonly users can view conversations but cannot perform write actions
- **FR34:** The conversation monitoring nav link is visible to authorised roles in the Payload admin sidebar

### Navigation & Integration

- **FR35:** Users can access the conversation monitoring view from the Payload admin sidebar
- **FR36:** Users can navigate between monitoring view, conversation detail, customer record, and assessment detail seamlessly
- **FR37:** The conversation monitoring view operates within the Payload admin template (with sidebar)

## Non-Functional Requirements

### Performance

- **NFR1:** All Conversations view initial load < 2 seconds
- **NFR2:** Conversation detail load < 1 second
- **NFR3:** Search and filter results < 1 second
- **NFR4:** Polling cycles complete without visible UI jank
- **NFR5:** Credit assessment detail pages (S3 fetch + render) < 3 seconds
- **NFR6:** 15+ concurrent users on monitoring view without degradation

### Security

- **NFR7:** All message HTML sanitised before rendering (DOMPurify, strict allowlist)
- **NFR8:** S3 assessment URLs validated against bucket allowlist with path traversal prevention
- **NFR9:** Assessment detail API routes rate-limited (30 requests/minute/user)
- **NFR10:** Conversation data accessible only to authenticated users with valid roles
- **NFR11:** No customer PII in application logs or error messages
- **NFR12:** All data access follows Payload CMS RBAC — no custom auth bypass

### Integration

- **NFR13:** New event handlers do not break existing account, customer, or write-off handlers
- **NFR14:** New handlers follow existing patterns: at-least-once delivery, deduplication, DLQ after 3 failures
- **NFR15:** Conversations collection schema extensions backward-compatible with existing Payload collection
- **NFR16:** S3 assessment fetching uses existing `s3-client.ts`

### Reliability

- **NFR17:** Polling failure on one view does not affect other views
- **NFR18:** Event processor unavailability does not prevent reading existing conversation data
- **NFR19:** MongoDB queries use appropriate indexes to prevent collection scans
