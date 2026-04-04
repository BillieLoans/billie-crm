---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
status: complete
completedAt: '2026-04-03'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
workflowType: 'implementation-readiness'
project_name: 'billie-crm-applications'
user_name: 'Rohan'
date: '2026-04-03'
---

# Implementation Readiness Assessment Report

**Date:** 2026-04-03
**Project:** billie-crm-applications

## Document Inventory

| Document | File | Status |
|:---|:---|:---|
| PRD | `_bmad-output/planning-artifacts/prd.md` | Found (whole) |
| Architecture | `_bmad-output/planning-artifacts/architecture.md` | Found (whole) |
| Epics & Stories | `_bmad-output/planning-artifacts/epics.md` | Found (whole) |
| UX Design | `_bmad-output/planning-artifacts/ux-design-specification.md` | Found (whole) |

**Duplicates:** None
**Missing:** None

## PRD Analysis

### Functional Requirements

**Conversation Monitoring (FR1-FR4):**
FR1: Supervisors can view all conversations in a card grid showing customer name, application number, status badge, loan amount/purpose, last message preview, message count, and time indicators
FR2: Supervisors can see conversation status badges reflecting current state (active, paused, soft end, hard end, approved, declined, ended)
FR3: Supervisors can see the conversation grid update automatically at regular intervals without manual refresh
FR4: Supervisors can paginate or infinite-scroll through conversations sorted by most recent activity

**Search & Filtering (FR5-FR9):**
FR5: Users can search conversations by customer name or application number
FR6: Users can filter conversations by decision status (approved, declined, no decision)
FR7: Users can filter conversations by conversation status (active, paused, ended)
FR8: Users can filter conversations by date range
FR9: Users can combine multiple search and filter criteria simultaneously

**Conversation Detail (FR10-FR16):**
FR10: Users can view the full message transcript with messages attributed to customer or AI assistant
FR11: Users can view the AI assistant's rationale for each response when available
FR12: Users can view assessment data organised by category (Application, Identity, Credit, Statements, Noticeboard)
FR13: Users can expand and collapse individual assessment sections
FR14: Users can view noticeboard posts with version history
FR15: Users can see conversation detail update automatically at regular intervals
FR16: Users can view application details (loan amount, purpose, term) within the conversation

**Credit Assessment Detail (FR17-FR19):**
FR17: Users can view full account conduct assessment: overall decision, individual rule results, pass/fail indicators, scoring details
FR18: Users can view full serviceability assessment: overall decision, monthly metrics, rule results, processed files
FR19: Users can navigate from a conversation's assessment panel to the detailed assessment view

**Customer & Application Context (FR20-FR24):**
FR20: Users can navigate from a conversation to the associated customer's ServicingView record
FR21: Users can navigate from a customer's record to their associated conversations
FR22: Users can see conversations alongside loan accounts, contact notes, and servicing history in the ServicingView
FR23: Conversations are linked to both customer and application records
FR24: Users can see conversation status and last message preview from within the ServicingView

**Event Processing (FR25-FR29):**
FR25: The system consumes and processes all conversation event types from inbox:billie-servicing
FR26: The system stores full conversation state in MongoDB
FR27: The system handles statement capture flow events
FR28: The system handles credit assessment result events including S3 file location references
FR29: The system handles post-identity risk check events

**Message Security & Access (FR30-FR37):**
FR30: The system sanitises all conversation message HTML before rendering
FR31: Users can view formatted message content within sanitised boundaries
FR32: Admin, supervisor, and operations roles can access conversation monitoring and details
FR33: Readonly users can view conversations but cannot perform write actions
FR34: The conversation monitoring nav link is visible to authorised roles in the Payload admin sidebar
FR35: Users can access the conversation monitoring view from the Payload admin sidebar
FR36: Users can navigate between monitoring view, conversation detail, customer record, and assessment detail seamlessly
FR37: The conversation monitoring view operates within the Payload admin template (with sidebar)

**Total FRs: 37**

### Non-Functional Requirements

**Performance (NFR1-NFR6):**
NFR1: All Conversations view initial load < 2 seconds
NFR2: Conversation detail load < 1 second
NFR3: Search and filter results < 1 second
NFR4: Polling cycles complete without visible UI jank
NFR5: Credit assessment detail pages (S3 fetch + render) < 3 seconds
NFR6: 15+ concurrent users on monitoring view without degradation

**Security (NFR7-NFR12):**
NFR7: All message HTML sanitised before rendering (DOMPurify, strict allowlist)
NFR8: S3 assessment URLs validated against bucket allowlist with path traversal prevention
NFR9: Assessment detail API routes rate-limited (30 requests/minute/user)
NFR10: Conversation data accessible only to authenticated users with valid roles
NFR11: No customer PII in application logs or error messages
NFR12: All data access follows Payload CMS RBAC — no custom auth bypass

**Integration (NFR13-NFR16):**
NFR13: New event handlers do not break existing account, customer, or write-off handlers
NFR14: New handlers follow existing patterns: at-least-once delivery, deduplication, DLQ after 3 failures
NFR15: Conversations collection schema extensions backward-compatible with existing Payload collection
NFR16: S3 assessment fetching uses existing s3-client.ts

**Reliability (NFR17-NFR19):**
NFR17: Polling failure on one view does not affect other views
NFR18: Event processor unavailability does not prevent reading existing conversation data
NFR19: MongoDB queries use appropriate indexes to prevent collection scans

**Total NFRs: 19**

### Additional Requirements

- Feature-parity replatform: billie-realtime must be fully replaceable after MVP
- 4 user journeys defined: Supervisor Live Monitoring, Operations Customer Context, Supervisor Fraud Investigation, Admin System Verification
- Technical approach: React Query polling (not WebSockets), no new infrastructure
- Target users: 5-15 concurrent supervisors, operations staff, admins

### PRD Completeness Assessment

- **Strength:** Well-structured with clear FR/NFR numbering, user journeys with narrative detail, measurable success criteria, risk mitigation table
- **Strength:** Explicit scope boundaries — MVP feature set vs post-MVP features clearly delineated
- **Strength:** Technical constraints documented (browser support, real-time strategy, performance targets)
- **No gaps identified:** All FRs are testable, all NFRs have measurable targets

## Epic Coverage Validation

### Coverage Matrix

| FR | PRD Requirement | Epic | Story | Status |
|:---|:---|:---|:---|:---|
| FR1 | Card grid with conversation data | Epic 2 | 2.2 | Covered |
| FR2 | Status badges (7 states) | Epic 2 | 2.2 | Covered |
| FR3 | Auto-updating grid (5s polling) | Epic 2 | 2.3 | Covered |
| FR4 | Pagination/infinite scroll | Epic 2 | 2.3 | Covered |
| FR5 | Search by customer name/app number | Epic 2 | 2.4 | Covered |
| FR6 | Filter by decision status | Epic 2 | 2.4 | Covered |
| FR7 | Filter by conversation status | Epic 2 | 2.4 | Covered |
| FR8 | Filter by date range | Epic 2 | 2.4 | Covered |
| FR9 | Combine multiple filters | Epic 2 | 2.4 | Covered |
| FR10 | Full message transcript | Epic 3 | 3.2 | Covered |
| FR11 | AI assistant rationale | Epic 3 | 3.2 | Covered |
| FR12 | Assessment data by category | Epic 3 | 3.3 | Covered |
| FR13 | Collapsible assessment sections | Epic 3 | 3.3 | Covered |
| FR14 | Noticeboard with version history | Epic 3 | 3.3 | Covered |
| FR15 | Auto-updating detail (3s polling) | Epic 3 | 3.1 | Covered |
| FR16 | Application details in conversation | Epic 3 | 3.1 | Covered |
| FR17 | Account conduct assessment detail | Epic 3 | 3.4 | Covered |
| FR18 | Serviceability assessment detail | Epic 3 | 3.4 | Covered |
| FR19 | Navigate to assessment detail | Epic 3 | 3.4 | Covered |
| FR20 | Navigate conversation to customer | Epic 4 | 4.2 | Covered |
| FR21 | Navigate customer to conversations | Epic 4 | 4.1 | Covered |
| FR22 | Conversations in ServicingView | Epic 4 | 4.1 | Covered |
| FR23 | Linked to customer + application | Epic 4 | 4.1, 4.2 | Covered |
| FR24 | Status + preview in ServicingView | Epic 4 | 4.1 | Covered |
| FR25 | Consume all event types | Epic 1 | 1.1, 1.2 | Covered |
| FR26 | Store full conversation state | Epic 1 | 1.1, 1.2, 1.3 | Covered |
| FR27 | Statement capture flow events | Epic 1 | 1.1 | Covered |
| FR28 | Credit assessment events + S3 refs | Epic 1 | 1.2 | Covered |
| FR29 | Post-identity risk events | Epic 1 | 1.2 | Covered |
| FR30 | HTML sanitisation | Epic 3 | 3.2 | Covered |
| FR31 | Formatted content display | Epic 3 | 3.2 | Covered |
| FR32 | Role-based access (admin/supervisor/operations) | Epic 2 | 2.1 | Covered |
| FR33 | Readonly can view | Epic 2 | 2.1 | Covered |
| FR34 | Nav link in sidebar | Epic 2 | 2.1 | Covered |
| FR35 | Access from sidebar | Epic 2 | 2.1 | Covered |
| FR36 | Seamless navigation between views | Epic 4 | 4.2 | Covered |
| FR37 | Operates within Payload admin template | Epic 2 | 2.1 | Covered |

### Missing Requirements

**None.** All 37 FRs have traceable coverage in epics and stories with specific acceptance criteria.

### Coverage Statistics

- Total PRD FRs: 37
- FRs covered in epics: 37
- Coverage percentage: **100%**
- FRs in epics but not in PRD: 0 (no scope creep)

## UX Alignment Assessment

### UX Document Status

**Found:** `_bmad-output/planning-artifacts/ux-design-specification.md` (complete, 14 steps)

### UX ↔ PRD Alignment

**Strong alignment:**
- All 4 PRD user journeys reflected in UX with detailed interaction flows and Mermaid diagrams
- All 37 FRs have corresponding UX treatment (component specs, interaction patterns, visual design)
- Target users (Alex supervisor, Sarah operations, David admin) consistent across both documents
- Polling intervals match PRD technical requirements (3s detail, 5s grid)
- Performance targets consistent (< 2s page load, < 1s search, < 5s update latency)

**Scope expansion (UX adds requirements not in PRD):**
- PRD states "Desktop-first. No mobile or tablet optimisation" but UX adds mobile as secondary platform (3 breakpoints). User explicitly requested this during UX workflow.
- UX adds keyboard shortcuts (arrow keys, /, Escape, [ ]) not mentioned in PRD
- UX adds filter URL sync for shareable filtered views not in PRD
- UX adds pre-fetch on card hover for instant drill-down not in PRD
- UX adds `prefers-reduced-motion` support not in PRD

**Assessment:** Scope expansions are additive enhancements that don't conflict with PRD. Mobile support was a deliberate product decision. Other additions are UX polish items.

### UX ↔ Architecture Alignment

**Strong alignment:**
- Component structure in Architecture matches UX component strategy (ApplicationsView, ConversationDetailView, split panel)
- Polling strategy matches (5s/3s/30s with `refetchIntervalInBackground: false`)
- Status values and 7-state model consistent
- DOMPurify approach (SanitizedHTML component, strict allowlist) identical
- API response shapes support UX data needs
- CQRS boundaries preserved (read-only feature from web layer)

**Alignment issues found:**

1. **Naming inconsistency (LOW):** Architecture defines `ConversationsPanel` in ServicingView while UX specifies the panel should be framed as "Applications" with an `ApplicationsPanel` component name. The UX explicitly decided on context-dependent naming ("Applications" in ServicingView, "Conversations" in monitoring grid). Architecture was created before this UX decision.
   - **Recommendation:** Update Architecture component naming to match UX: `ApplicationsPanel` in ServicingView, keep `ApplicationsView` for monitoring grid.

2. **Mobile responsiveness not addressed in Architecture (LOW):** Architecture does not mention responsive breakpoints or mobile layouts. UX defines 3 breakpoints with specific adaptations per view. Architecture was designed before mobile was added to platform strategy.
   - **Recommendation:** Non-blocking — responsive design is a CSS/component concern, not an architectural decision. Implementation stories already include responsive ACs.

3. **Keyboard shortcuts not in Architecture (INFORMATIONAL):** UX defines feature-specific keyboard shortcuts (/, Escape, arrow keys, [ ]). Architecture doesn't mention them but this is expected — keyboard shortcuts are component-level behaviour, not architectural.

### Warnings

- **No critical warnings.** All alignment issues are LOW priority and non-blocking.
- The naming inconsistency (ConversationsPanel vs ApplicationsPanel) should be resolved before implementation to prevent confusion. Recommend updating Architecture to match UX naming.

## Epic Quality Review

### Best Practices Compliance Checklist

| Check | Epic 1 | Epic 2 | Epic 3 | Epic 4 |
|:---|:---|:---|:---|:---|
| Delivers user value | ⚠️ Indirect | ✅ | ✅ | ✅ |
| Functions independently | ✅ | ✅ | ✅ | ✅ |
| Stories appropriately sized | ✅ | ✅ | ✅ | ✅ |
| No forward dependencies | ✅ | ✅ | ✅ | ✅ |
| Database tables created when needed | ✅ | N/A | N/A | N/A |
| Clear acceptance criteria | ✅ | ✅ | ✅ | ✅ |
| FR traceability maintained | ✅ | ✅ | ✅ | ✅ |

### Violations Found

#### 🟠 Major Issues (1)

**ISSUE-1: Epic 1 is a technical foundation epic without direct user value**

Epic 1 "Data Pipeline & API Foundation" delivers backend infrastructure (event handlers, schema, API routes) rather than a user-facing capability. The epic goal describes system capabilities ("captures all conversation events and provides API access") rather than user outcomes. This violates the "organize by USER VALUE, not technical layers" principle.

**Mitigating factors:**
- This is a brownfield project with a single developer. The backend work (Python event handlers, MongoDB schema, Next.js API routes) is a fundamentally different skillset and codebase area from the frontend work (React components, CSS, hooks).
- All three frontend epics (2, 3, 4) depend on Epic 1's API routes existing. Embedding API route creation into each frontend epic would create duplication and confusion.
- Epic 1 does deliver a testable deliverable: APIs return conversation data, events flow into MongoDB. This is verifiable without a UI.
- The PRD's implementation sequence (Architecture doc) explicitly recommends: "Event handlers first → API routes → Components."

**Recommendation:** Accept as a pragmatic deviation for a brownfield single-developer project. The alternative (3 large epics each containing backend + frontend work) would be harder to manage and harder to debug. Flag for future reference — in a team context with frontend/backend specialists, this epic structure might need revisiting.

#### 🟡 Minor Concerns (2)

**ISSUE-2: Stories 1.1 and 1.2 use "As the system" as actor**

Stories 1.1 (Statement Capture Flow Event Handlers) and 1.2 (Credit Assessment Event Handlers) use "As the system, I want..." instead of a human actor. Purist user story methodology requires a human user type.

**Mitigating factor:** Event handler stories legitimately have the system as the actor — no human initiates these events. The alternative ("As a developer, I want the system to process events...") is artificial and adds no clarity.

**Recommendation:** Accept. "As the system" is standard practice for background processing stories.

**ISSUE-3: Story 1.6 bundles dompurify installation with S3 proxy API route**

Story 1.6 includes `pnpm add dompurify @types/dompurify` alongside the unrelated S3 assessment proxy work. The dependency is needed by Epic 3 (SanitizedHTML), not by Story 1.6 itself.

**Mitigating factor:** It's a single `pnpm add` command — creating a standalone "install dompurify" story would be trivial overhead. Bundling with the last Epic 1 story ensures the dependency is available before Epic 3 begins.

**Recommendation:** Accept. Pragmatic bundling of a trivial task.

### Dependency Analysis

**Epic-Level Dependencies:**
```
Epic 1 (foundation) ← no dependencies
Epic 2 (monitoring) ← Epic 1
Epic 3 (detail) ← Epic 1, Epic 2
Epic 4 (context) ← Epic 1, Epic 3
```
- ✅ No circular dependencies
- ✅ No epic requires a future epic to function
- ✅ Each epic is independently valuable once its dependencies are met

**Within-Epic Story Dependencies (all PASS):**

Epic 1: 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6
- 1.1: Standalone (adds handlers to existing file)
- 1.2: Standalone (adds more handlers, same pattern as 1.1)
- 1.3: Uses handler output shapes from 1.1/1.2 to define schema
- 1.4: Uses schema from 1.3 to build list API
- 1.5: Uses same patterns as 1.4 for detail API
- 1.6: Uses S3 client patterns for assessment API

Epic 2: 2.1 → 2.2 → 2.3 → 2.4
- 2.1: View scaffold (shell + nav, no data)
- 2.2: Card components (can render with mock data)
- 2.3: Grid assembly with live data (uses 2.1 shell + 2.2 cards + Epic 1 API)
- 2.4: Adds search/filter to existing grid from 2.3

Epic 3: 3.1 → 3.2 → 3.3 → 3.4
- 3.1: Layout scaffold (split panel shell)
- 3.2: Left panel content (transcript, uses 3.1 layout)
- 3.3: Right panel content (assessments, uses 3.1 layout)
- 3.4: Detail pages (linked from 3.3 sections)

Epic 4: 4.1 → 4.2
- 4.1: Panel component in ServicingView
- 4.2: Cross-view navigation (uses 4.1 panel + Epic 3 detail view)

**No forward dependencies found in any epic.**

### Story Sizing Assessment

| Epic | Stories | Avg Complexity | Assessment |
|:---|:---|:---|:---|
| Epic 1 | 6 | Medium | Well-sized — each story is a focused backend task |
| Epic 2 | 4 | Medium-High | Appropriately scoped — Story 2.4 (search/filter) is the largest |
| Epic 3 | 4 | Medium-High | Well-sized — Story 3.2 (transcript + sanitization) is the most complex |
| Epic 4 | 2 | Medium | Could be 1 story but 2 provides cleaner separation |

**No stories flagged as too large or too small.**

### Acceptance Criteria Quality

- ✅ All 16 stories use Given/When/Then format
- ✅ All include error conditions (404, 401, 429)
- ✅ All reference specific FR numbers
- ✅ All have measurable/verifiable outcomes
- ✅ Edge cases covered (stale data, empty states, out-of-order events, scroll preservation)
- ✅ NFR-relevant ACs include specific targets (< 2s load, 30 req/min, 5s polling)

### Brownfield Project Checks

- ✅ No "project setup from template" story (correctly absent — brownfield)
- ✅ Schema changes are extensions with optional fields (NFR15)
- ✅ New handlers added alongside existing ones (NFR13)
- ✅ Existing test infrastructure reused
- ✅ Existing patterns followed (WithTemplate, barrel exports, CSS Modules)

## Summary and Recommendations

### Overall Readiness Status

**READY** — with 1 accepted deviation and 2 minor documentation items.

### Findings Summary

| Category | Critical | Major | Minor | Info |
|:---|:---|:---|:---|:---|
| FR Coverage | 0 | 0 | 0 | 0 |
| NFR Coverage | 0 | 0 | 0 | 0 |
| UX Alignment | 0 | 0 | 2 | 1 |
| Epic Quality | 0 | 1 (accepted) | 2 | 0 |
| **Total** | **0** | **1** | **4** | **1** |

### Critical Issues Requiring Immediate Action

**None.** No critical blockers to implementation.

### Issues to Address Before or During Implementation

1. **Architecture naming alignment (LOW — before implementation):** Update `ConversationsPanel` → `ApplicationsPanel` in Architecture document to match UX specification's context-dependent naming decision. Prevents naming confusion during implementation.

2. **Epic 1 technical foundation deviation (ACCEPTED):** Epic 1 is a technical foundation epic rather than a user-value epic. This is a conscious, justified deviation for a brownfield single-developer project. No action required — documented for future reference.

### Recommended Next Steps

1. **Fix Architecture naming:** Rename `ConversationsPanel` references in `architecture.md` to `ApplicationsPanel` for ServicingView context
2. **Sprint Planning:** Run `/bmad:bmm:workflows:sprint-planning` to create sprint status tracking for Phase 4 implementation
3. **Begin Epic 1:** Start with Story 1.1 (Statement Capture Flow Event Handlers) — the entire implementation pipeline flows from here

### Strengths

- **100% FR coverage** — all 37 functional requirements traceable to specific stories with testable acceptance criteria
- **100% NFR coverage** — all 19 non-functional requirements addressed in story ACs with measurable targets
- **Zero forward dependencies** — all 16 stories are independently completable in sequence
- **Strong document alignment** — PRD, Architecture, UX Design, and Epics are consistent and mutually reinforcing
- **Brownfield-appropriate** — schema extensions use optional fields, new handlers sit alongside existing ones, no new infrastructure
- **Comprehensive UX** — responsive design, accessibility (WCAG 2.1 AA), keyboard navigation, and reduced motion support all specified

### Final Note

This assessment identified 6 items across 4 categories (0 critical, 1 major accepted, 4 minor, 1 informational). The billie-crm-applications feature is **ready for implementation**. The planning artifacts (PRD, Architecture, UX Design, Epics & Stories) are complete, aligned, and provide sufficient detail for a development agent to implement each story without ambiguity.

**Assessment completed:** 2026-04-03
**Assessor:** Implementation Readiness Workflow (adversarial review)
