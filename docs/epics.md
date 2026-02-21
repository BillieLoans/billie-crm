---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
inputDocuments:
  - docs/prd.md
  - docs/architecture.md
  - docs/ux-design-specification.md
  - docs/project_context.md
workflowType: 'epics-stories'
lastStep: 4
status: 'complete'
completedAt: '2025-12-11'
project_name: 'billie-crm'
user_name: 'Rohan'
date: '2025-12-11'
---

# billie-crm - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for billie-crm, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

**Customer Intelligence (Search & View):**
- **FR1:** Staff can search for customers using partial or exact matches on Name, Email, Mobile Number, or Customer ID (minimum 3 characters).
- **FR2:** Staff can search for loan accounts by Account Number or Application ID.
- **FR3:** Staff can search for specific transactions by Payment Reference or Transaction ID.
- **FR4:** Staff can view a "Single Customer View" dashboard aggregating Profile, Accounts, and recent Transactions.
- **FR4.1:** Staff can filter the transaction history by Transaction Type (e.g., Fees, Repayments) and Date Range.
- **FR5:** Staff can view the latest known balances (Principal, Interest, Fees, Total) for all active loan accounts.
- **FR6:** Staff can view a chronological history of all financial transactions for a specific loan account.
- **FR7:** Staff can view customer identity flags (e.g., "Staff", "Investor", "Vulnerable") clearly on the dashboard.

**Financial Operations (Write Actions):**
- **FR8:** Staff can initiate a "Waive Fee" action directly from the loan account view.
- **FR9:** Staff can initiate a "Record Repayment" action (manual bank transfer entry) from the loan account view.
- **FR10:** Staff can initiate a "Write-Off" request for an account balance, triggering an approval workflow.
- **FR10.1:** Staff can cancel their own pending write-off requests before they are approved.
- **FR11:** System must optimistically update the UI balance immediately upon action submission (before server confirmation).
- **FR12:** System must revert the optimistic update and display an actionable error toast with retry option if the backend action fails.

**Governance & Audit (Compliance):**
- **FR13:** Approvers (Supervisors) can view a queue of pending "Write-Off" requests.
- **FR13.1:** Approvers can sort/filter the approval queue by Date Requested, Amount, and Requestor.
- **FR14:** Approvers can Approve or Reject a write-off request with a mandatory comment.
- **FR15:** Compliance Officers can view an immutable audit log of all financial mutations (who, what, when, reason).
- **FR15.1:** Audit logs and transaction histories must support server-side pagination to handle large datasets.
- **FR16:** System must cryptographically link the Approver's identity to the approved transaction event.
- **FR17:** Staff cannot approve their own requests (Segregation of Duties).
- **FR17.1:** Staff can view their current approval limits and permissions directly in the UI.

**Notification & Workflow:**
- **FR18:** Approvers receive a real-time notification (Toast) when a new request is assigned to their queue.
- **FR19:** Staff receive a notification when their request is Approved or Rejected.
- **FR22:** Staff can view the sync status (e.g., "Saving...", "Synced", "Failed") of any recent write action.
- **FR23:** Failed actions must trigger a persistent alert in a global notification center that remains visible across page navigation.

**System Health & Resilience:**
- **FR20:** Staff can view a "System Status" indicator showing the health/latency of the Event Processor connection.
- **FR21:** The application automatically switches to "Read-Only Mode" if the connection to the Event Processor is lost, disabling write actions.
- **FR24:** System must detect version conflicts (e.g., modifying a stale account state) and prompt the user to refresh the data.

### Non-Functional Requirements

**Performance:**
- **NFR1 (Responsiveness):** UI interactions must respond in < 100ms (Optimistic UI).
- **NFR2 (Data Freshness):** Background data must refresh every 10 seconds with immediate revalidation on write actions.
- **NFR3 (Load Time):** Single Customer View must achieve FCP in < 1.5 seconds.

**Security:**
- **NFR4 (Access Control):** All API routes must validate user role (Support vs. Approver) against session token.
- **NFR5 (Data Minimization):** Frontend must strictly type API responses to prevent over-fetching PII.
- **NFR6 (Auditability):** All write actions must log actor_id, resource_id, action_type, timestamp, reason to immutable event store.

**Reliability & Resilience:**
- **NFR7 (Graceful Degradation):** UI must enter "Read-Only Mode" within 30 seconds of Ledger Service outage detection.
- **NFR8 (Error Recovery):** Optimistic UI failures must trigger user-dismissible toast with "Retry" action.

**Accessibility:**
- **NFR9 (Keyboard Nav):** Primary Actions (Search, Forms, Main Buttons) must be keyboard accessible.

### Additional Requirements

**From Architecture (Technical Foundation):**
- AR1: Install new dependencies (TanStack Query, Zustand, cmdk, sonner, zod, nanoid, react-hook-form)
- AR2: Create foundational files (env.ts, query-client.ts, providers, stores, types, error messages)
- AR3: Implement RBAC middleware pattern (`withAuth(role)`) for API routes
- AR4: Implement health check middleware (`withLedgerHealth`) for gRPC routes
- AR5: Configure TanStack Query with 10s staleTime and intelligent polling
- AR6: Implement entity-indexed Zustand store for optimistic UI state
- AR7: Implement MutationStage enum for Truth Scale feedback
- AR8: Create centralized ERROR_MESSAGES map
- AR9: Implement idempotency key generation utility
- AR10: Register custom Payload views (ServicingView, ApprovalsView) via admin.components.views

**From UX Design (Interaction Patterns):**
- UX1: Implement Command Palette (Cmd+K) using cmdk library
- UX2: Implement slide-over drawers for context panels (ContextDrawer component)
- UX3: Implement "Truth Scale" feedback (optimistic → submitted → confirmed → failed)
- UX4: Implement keyboard-first navigation with global hotkeys
- UX5: Implement responsive table-to-card transformation for mobile
- UX6: Implement skeleton loaders for loading states
- UX7: Implement `aria-live` announcements for optimistic updates (accessibility)
- UX8: Implement dashboard home page with actionable items
- UX9: Implement breadcrumb navigation for wayfinding
- UX10: Implement recent customers tracking (localStorage persistence)

### FR Coverage Map

| FR | Epic | Description |
| :--- | :--- | :--- |
| FR1 | Epic 1 | Customer search (Name, Email, Mobile, ID) |
| FR2 | Epic 1 | Loan account search |
| FR3 | Epic 1 | Transaction search |
| FR4 | Epic 2 | Single Customer View dashboard |
| FR4.1 | Epic 2 | Transaction filtering |
| FR5 | Epic 2 | Live balances display |
| FR6 | Epic 2 | Transaction history |
| FR7 | Epic 2 | Identity flags display |
| FR8 | Epic 3 | Waive Fee action |
| FR9 | Epic 3 | Record Repayment action |
| FR10 | Epic 4 | Write-Off request |
| FR10.1 | Epic 4 | Cancel pending write-off |
| FR11 | Epic 3 | Optimistic UI updates |
| FR12 | Epic 3 | Error toast with retry |
| FR13 | Epic 4 | Approval queue view |
| FR13.1 | Epic 4 | Approval queue filtering |
| FR14 | Epic 4 | Approve/Reject with comment |
| FR15 | Epic 4 | Audit log view |
| FR15.1 | Epic 4 | Pagination for large datasets |
| FR16 | Epic 4 | Cryptographic approver linking |
| FR17 | Epic 4 | Segregation of duties |
| FR17.1 | Epic 4 | Permission visibility |
| FR18 | Epic 4 | Approver notifications |
| FR19 | Epic 4 | Request status notifications |
| FR20 | Epic 5 | System status indicator |
| FR21 | Epic 5 | Read-Only Mode |
| FR22 | Epic 5 | Sync status display |
| FR23 | Epic 5 | Persistent alert center |
| FR24 | Epic 5 | Version conflict detection |
| UX4 | Epic 6 | Keyboard-first navigation (persistent nav) |
| UX5 | Epic 6 | Responsive design (mobile nav) |
| UX8 | Epic 6 | Dashboard home page |
| UX9 | Epic 6 | Breadcrumb navigation |
| UX10 | Epic 6 | Recent customers tracking |

## Epic List

### Epic 1: Global Search & Foundation
Staff can search for customers, accounts, and transactions using the Command Palette (Cmd+K), with results showing Customer Card previews.

**User Outcome:** Staff can instantly find any customer by name, email, phone, or ID and see basic information in search results.

**FRs Covered:** FR1, FR2, FR3
**ARs Covered:** AR1-AR10 (Dependencies, Stores, Providers, Middleware)
**UX Covered:** UX1 (Command Palette), UX4 (Keyboard Navigation)
**NFRs Addressed:** NFR1 (< 100ms), NFR9 (Keyboard Nav)

**Implementation Notes:**
- First story establishes technical foundation (heavy lift)
- Search results include Customer Card preview (name, ID, status, account count)
- Results link to ServicingView (Epic 2) or show "Coming Soon" placeholder

---

### Epic 2: Single Customer View
Staff can view a complete customer profile with accounts, balances, and transaction history in one screen.

**User Outcome:** Staff can see everything about a customer without switching tabs — profile, all accounts, live balances, recent transactions.

**FRs Covered:** FR4, FR4.1, FR5, FR6, FR7
**NFRs Addressed:** NFR3 (< 1.5s FCP), NFR9 (Keyboard Nav)
**UX Covered:** UX2 (ContextDrawer), UX5 (Responsive), UX6 (Skeletons)

**Implementation Notes:**
- ServicingView registered as custom Payload view
- Uses TanStack Query for data fetching with server prefetch
- Implements table-to-card transformation for mobile

---

### Epic 3: Financial Actions (Optimistic UI)
Staff can waive fees and record repayments with instant UI feedback.

**User Outcome:** Staff can take financial actions that update the UI immediately, with clear feedback on action status.

**FRs Covered:** FR8, FR9, FR11, FR12
**NFRs Addressed:** NFR1 (< 100ms UI), NFR2 (10s polling), NFR8 (Error Recovery)
**ARs Covered:** AR6 (Optimistic Store), AR7 (MutationStage), AR9 (Idempotency)
**UX Covered:** UX3 (Truth Scale), UX7 (aria-live)

**Implementation Notes:**
- Waive Fee implemented first (simpler, validates pattern)
- Record Repayment follows (more complex validation)
- Optimistic UI with MutationStage progression
- Error handling with retry action in toast

---

### Epic 4: Write-Off & Approval Workflow
Staff can request write-offs, and Approvers can review, approve, or reject requests with full notification support.

**User Outcome:** Complete governance workflow — staff request, approvers receive notifications, review with full context, and approve/reject with mandatory comments.

**FRs Covered:** FR10, FR10.1, FR13, FR13.1, FR14, FR15, FR15.1, FR16, FR17, FR17.1, FR18, FR19
**NFRs Addressed:** NFR4 (RBAC), NFR6 (Auditability)
**ARs Covered:** AR3 (withAuth middleware)

**Implementation Notes:**
- ApprovalsView registered as custom Payload view
- RBAC enforced via withAuth middleware
- Segregation of duties (self-approval prevention)
- Real-time toast notifications for approvers
- Audit log with server-side pagination

---

### Epic 5: System Health & Resilience
System gracefully handles backend unavailability and provides clear status indicators.

**User Outcome:** Staff always know the system status and can continue viewing data even when write operations are unavailable.

**FRs Covered:** FR20, FR21, FR22, FR23, FR24
**NFRs Addressed:** NFR7 (Graceful Degradation)
**ARs Covered:** AR4 (withLedgerHealth), AR8 (ERROR_MESSAGES)

**Implementation Notes:**
- System status indicator in header
- Read-Only Mode with global banner
- Persistent notification center for failed actions
- Version conflict detection with refresh prompt

---

## Epic 1: Global Search & Foundation

Staff can search for customers, accounts, and transactions using the Command Palette (Cmd+K), with results showing Customer Card previews.

### Story 1.1: Technical Foundation Setup

As a **developer**,
I want the application to have TanStack Query, Zustand, and supporting libraries configured,
So that all future features have a consistent state management foundation.

**Acceptance Criteria:**

**Given** the billie-crm codebase
**When** I run `pnpm install`
**Then** the following packages are installed: `@tanstack/react-query`, `zustand`, `cmdk`, `sonner`, `zod`, `nanoid`, `react-hook-form`, `@hookform/resolvers`

**Given** the application starts
**When** any page loads
**Then** the QueryClientProvider wraps the application with staleTime: 10000ms configured

**Given** the application starts
**When** any page loads
**Then** the Toaster (sonner) component is rendered for notifications

**Given** the src/stores directory
**When** I import from `@/stores`
**Then** I can access `useOptimisticStore` with `pendingByAccount` Map and `MutationStage` type

**Given** the src/lib/errors directory
**When** I import `ERROR_MESSAGES` from `@/lib/errors/messages`
**Then** I get a typed map of error codes to user-friendly messages

---

### Story 1.2: Command Palette UI Component

As a **support staff member**,
I want to press Cmd+K (or Ctrl+K) to open a search palette,
So that I can quickly search without clicking through menus.

**Acceptance Criteria:**

**Given** I am on any page in the Payload admin
**When** I press Cmd+K (Mac) or Ctrl+K (Windows)
**Then** a centered modal search palette opens with focus on the input field

**Given** the command palette is open
**When** I press Escape or click outside
**Then** the palette closes

**Given** the command palette is open
**When** I type text
**Then** the input updates and shows a loading indicator while searching

**Given** the command palette is closed
**When** I press F7 (global search hotkey from UX spec)
**Then** the command palette opens

---

### Story 1.3: Customer Search API & Results

As a **support staff member**,
I want to search for customers by name, email, phone, or customer ID,
So that I can quickly find a customer's account.

**Acceptance Criteria:**

**Given** I have typed at least 3 characters in the command palette
**When** the search executes
**Then** API route `/api/customer/search` is called with the query

**Given** a customer "John Smith" with email "john@example.com" exists
**When** I search for "John" or "john@" or the customer ID
**Then** the results show a Customer Card with: Name, Customer ID, Email, Status badge, Account count

**Given** search results are displayed
**When** I use arrow keys to navigate
**Then** the selected result is highlighted and Enter key triggers selection

**Given** I select a customer from results
**When** ServicingView (Epic 2) is not yet implemented
**Then** a toast displays "Single Customer View coming in Epic 2" and the palette closes

**Given** no customers match my search
**When** results are empty
**Then** display "No customers found for '{query}'"

---

### Story 1.4: Loan Account & Transaction Search

As a **support staff member**,
I want to search by Account Number, Application ID, or Transaction ID,
So that I can find accounts directly without knowing the customer.

**Acceptance Criteria:**

**Given** I search with a pattern matching Account Number format (e.g., "ACC-12345")
**When** results return
**Then** loan account results appear with: Account Number, Customer Name, Balance, Status

**Given** I search with a pattern matching Transaction ID
**When** results return
**Then** transaction results appear with: Transaction ID, Type, Amount, Date, Account Number

**Given** search results include multiple types (customers, accounts, transactions)
**When** displayed in the palette
**Then** results are grouped by type with section headers

---

## Epic 2: Single Customer View

Staff can view a complete customer profile with accounts, balances, and transaction history in one screen.

### Story 2.1: ServicingView Custom Payload View

As a **support staff member**,
I want to navigate to a dedicated servicing page for a customer,
So that I can see all their information in one place.

**Acceptance Criteria:**

**Given** I am logged into Payload admin
**When** I navigate to `/admin/servicing/:customerId`
**Then** the ServicingView custom view renders within the Payload admin shell

**Given** the ServicingView loads
**When** the customer data is being fetched
**Then** skeleton loaders display for each section (profile, accounts, transactions)

**Given** the ServicingView URL contains an invalid customer ID
**When** the page loads
**Then** an error message displays "Customer not found" with a link back to search

**Given** the command palette (Epic 1) search results
**When** I select a customer
**Then** I am navigated to `/admin/servicing/{customerId}`

---

### Story 2.2: Customer Profile & Identity Flags

As a **support staff member**,
I want to see the customer's profile information and identity flags,
So that I know who I'm helping and any special considerations.

**Acceptance Criteria:**

**Given** I am on the ServicingView for a customer
**When** the profile section loads
**Then** I see: Full Name, Customer ID, Email, Phone, Address, Account Status

**Given** a customer has identity flags (e.g., "Staff", "Investor", "Vulnerable")
**When** the profile displays
**Then** flags appear as colored badges next to the customer name

**Given** a customer is marked as "Vulnerable"
**When** viewing their profile
**Then** a warning banner displays with handling guidelines

---

### Story 2.3: Loan Accounts List with Live Balances

As a **support staff member**,
I want to see all loan accounts for a customer with live balances,
So that I can quickly understand their financial position.

**Acceptance Criteria:**

**Given** I am on the ServicingView
**When** the accounts section loads
**Then** I see a list of all loan accounts with: Account Number, Product Type, Status, Balance Summary

**Given** each loan account card
**When** balance data is fetched from `/api/ledger/balance`
**Then** display Principal, Fees, Total Outstanding with currency formatting (AUD)

**Given** the gRPC ledger is unavailable
**When** balance fetch fails
**Then** display cached balance from MongoDB with "Cached - Ledger Offline" badge

**Given** I click on a loan account card
**When** the account expands
**Then** show additional details in a ContextDrawer (slide-over panel)

---

### Story 2.4: Transaction History with Filtering

As a **support staff member**,
I want to view transaction history for an account with filtering options,
So that I can investigate specific activity.

**Acceptance Criteria:**

**Given** I am viewing a loan account's details
**When** the transactions section loads
**Then** display a table with: Date, Type, Amount, Reference, Balance After

**Given** the transaction list
**When** I select a filter (Type: Fees, Repayments, etc.)
**Then** the list updates to show only matching transactions

**Given** the transaction list
**When** I select a date range filter
**Then** the list updates to show only transactions within that range

**Given** more than 20 transactions exist
**When** scrolling to the bottom
**Then** additional transactions load (infinite scroll or pagination)

**Given** I am on mobile/tablet
**When** viewing transactions
**Then** table transforms to card layout (responsive design)

---

## Epic 3: Financial Actions (Optimistic UI)

Staff can waive fees and record repayments with instant visual feedback while processing happens in background.

### Story 3.1: Waive Fee Action with Optimistic UI

As a **support staff member**,
I want to waive a fee on a customer's account with immediate visual feedback,
So that I know my action was received without waiting for backend confirmation.

**Acceptance Criteria:**

**Given** I am viewing a loan account's fee list
**When** I click "Waive" on a fee entry
**Then** a slide-over drawer opens with: Fee Amount, Fee Type, Reason field (required), Confirm button

**Given** I have filled in a reason and click "Confirm Waive"
**When** the request is submitted
**Then** the drawer closes and the fee immediately shows "Waiving..." status (optimistic)

**Given** the optimistic state is applied
**When** the backend confirms success
**Then** the fee status updates to "Waived" with green checkmark, toast shows "Fee waived successfully"

**Given** the optimistic state is applied
**When** the backend returns an error
**Then** the fee reverts to original state, toast shows error message from `ERROR_MESSAGES`, retry option appears

**Given** I click "Waive" on a fee
**When** the system is in Read-Only Mode
**Then** the action is disabled with tooltip "System in read-only mode"

---

### Story 3.2: Record Repayment Action with Optimistic UI

As a **support staff member**,
I want to record a manual repayment with immediate visual feedback,
So that I can quickly process phone/branch payments.

**Acceptance Criteria:**

**Given** I am viewing a loan account in ServicingView
**When** I click "Record Repayment" button
**Then** a slide-over drawer opens with: Amount field, Date field (default today), Reference field, Payment Method dropdown, Notes field

**Given** I enter repayment details and click "Submit"
**When** the request is submitted
**Then** the drawer closes, a pending transaction appears in the list with "Processing..." badge

**Given** the optimistic repayment is displayed
**When** the backend confirms success
**Then** the transaction updates to "Confirmed", balance recalculates, toast shows "Repayment recorded"

**Given** the optimistic repayment is displayed
**When** the backend returns an error
**Then** the pending transaction shows "Failed" badge with retry/dismiss options

**Given** I submit a repayment
**When** the amount exceeds the outstanding balance
**Then** a confirmation dialog asks "Overpayment detected. Continue?"

---

### Story 3.3: Idempotency & Duplicate Prevention

As a **support staff member**,
I want the system to prevent duplicate submissions,
So that I don't accidentally waive a fee twice or double-record a payment.

**Acceptance Criteria:**

**Given** I have submitted a fee waiver
**When** I click "Waive" on the same fee again while pending
**Then** the action is disabled with message "Action in progress"

**Given** a fee waiver request is sent to the API
**When** the request includes an idempotency key (nanoid)
**Then** the server returns the same response for duplicate requests

**Given** I double-click the "Submit" button quickly
**When** the form processes
**Then** only one request is sent (button disabled after first click)

**Given** a network error occurs during submission
**When** I retry the action
**Then** the same idempotency key is used to prevent duplicates

---

### Story 3.4: Bulk Fee Waiver

As a **support staff member**,
I want to waive multiple fees at once,
So that I can quickly resolve disputes affecting multiple charges.

**Acceptance Criteria:**

**Given** I am viewing a loan account's fee list
**When** I enter "selection mode" (checkbox appears on each fee row)
**Then** I can select multiple waivable fees

**Given** I have selected 3 fees totaling $150
**When** I click "Waive Selected"
**Then** a summary drawer shows: Number of fees, Total amount, Single reason field

**Given** I confirm the bulk waiver
**When** submitted
**Then** all selected fees show "Waiving..." status, optimistic update applied to each

**Given** the bulk waiver completes
**When** some fees succeed and some fail
**Then** successful fees show "Waived", failed fees show error state with individual retry

---

## Epic 4: Write-Off & Approval Workflow

Staff can request write-offs, and Approvers can review, approve, or reject requests with full notification support.

### Story 4.1: Write-Off Request Form

As a **support staff member**,
I want to submit a write-off request for a loan account,
So that I can escalate uncollectable debt for approval.

**Acceptance Criteria:**

**Given** I am viewing a loan account in ServicingView
**When** I click "Request Write-Off"
**Then** a slide-over drawer opens with: Account summary, Write-off amount (default: full balance), Reason dropdown, Supporting notes field, Document upload option

**Given** I have completed the write-off form
**When** I click "Submit Request"
**Then** the request is saved with status "Pending Approval", toast confirms "Write-off request submitted"

**Given** a write-off request is submitted
**When** viewing the loan account
**Then** a badge shows "Write-Off Pending" with link to view request details

**Given** the write-off amount exceeds policy threshold (e.g., $10,000)
**When** I submit the request
**Then** a warning displays "This request requires senior approval"

---

### Story 4.2: ApprovalsView Custom Payload View

As an **approver**,
I want a dedicated view showing all pending approval requests,
So that I can efficiently work through my queue.

**Acceptance Criteria:**

**Given** I am logged in with Approver or Admin role
**When** I navigate to `/admin/approvals`
**Then** the ApprovalsView custom view renders with a list of pending requests

**Given** I am logged in without Approver role
**When** I try to access `/admin/approvals`
**Then** I receive a 403 Forbidden error with "Access denied" message

**Given** the approvals queue loads
**When** there are pending requests
**Then** each row shows: Request Date, Customer Name, Account, Amount, Requestor, Priority indicator

**Given** the approvals list
**When** I click a row
**Then** the request details expand inline or in a slide-over drawer

**Given** multiple pending requests exist
**When** viewing the queue
**Then** requests are sorted by date (oldest first) with urgent items flagged

---

### Story 4.3: Approve/Reject Actions with Comments

As an **approver**,
I want to approve or reject write-off requests with mandatory comments,
So that there is a clear audit trail of decisions.

**Acceptance Criteria:**

**Given** I am viewing a write-off request in ApprovalsView
**When** I click "Approve"
**Then** a modal prompts for mandatory comment before confirming

**Given** I enter an approval comment and confirm
**When** the approval is processed
**Then** the request status updates to "Approved", request disappears from queue, audit log is updated

**Given** I am viewing a write-off request
**When** I click "Reject"
**Then** a modal prompts for mandatory rejection reason

**Given** I reject a request
**When** the rejection is processed
**Then** the request status updates to "Rejected", requestor is notified via toast/notification center

**Given** I am the same user who submitted the request
**When** I try to approve my own request
**Then** the approve button is disabled with "Cannot approve own request" tooltip (segregation of duties)

---

### Story 4.4: Approval Notifications

As an **approver**,
I want to be notified when new write-off requests require my attention,
So that I don't miss time-sensitive approvals.

**Acceptance Criteria:**

**Given** a new write-off request is submitted
**When** I am logged in as an Approver
**Then** a toast notification appears "New write-off request requires approval"

**Given** I have unread approval notifications
**When** viewing the Payload admin header
**Then** a badge shows the count of pending approvals

**Given** I click the notification badge
**When** the notification panel opens
**Then** I see a list of recent notifications with links to each request

**Given** I approve/reject a request
**When** the requestor is logged in
**Then** they receive a notification of the decision

---

### Story 4.5: Audit Log & History

As an **auditor or manager**,
I want to view the complete history of write-off requests and decisions,
So that I can review compliance and decision patterns.

**Acceptance Criteria:**

**Given** I navigate to ApprovalsView
**When** I select "History" tab
**Then** I see a paginated list of all completed requests (approved + rejected)

**Given** the audit history view
**When** I filter by date range, status, or approver
**Then** the list updates to show matching records

**Given** I click a historical request
**When** the details expand
**Then** I see: Original request details, All comments, Decision timestamp, Approver name, IP address logged

**Given** the audit log
**When** records exist
**Then** data cannot be modified (immutable audit trail)

---

## Epic 5: System Health & Resilience

System gracefully handles backend unavailability and provides clear status indicators.

### Story 5.1: Ledger Health Check & Status Indicator

As a **support staff member**,
I want to see the system connection status at a glance,
So that I know if my actions will succeed before I attempt them.

**Acceptance Criteria:**

**Given** I am logged into the Payload admin
**When** viewing any page
**Then** a status indicator displays in the header showing ledger connectivity (green/yellow/red)

**Given** the gRPC ledger is healthy
**When** the status indicator shows
**Then** it displays green with "Connected" tooltip

**Given** the gRPC ledger is degraded (high latency)
**When** the status indicator shows
**Then** it displays yellow with "Degraded - some operations may be slow" tooltip

**Given** the gRPC ledger is offline
**When** the status indicator shows
**Then** it displays red with "Ledger Offline - read-only mode active" tooltip

**Given** the health check runs
**When** it executes
**Then** it polls `/api/ledger/health` every 30 seconds with withLedgerHealth wrapper

---

### Story 5.2: Read-Only Mode Activation

As a **support staff member**,
I want write actions to be gracefully disabled when the ledger is offline,
So that I don't submit actions that will fail.

**Acceptance Criteria:**

**Given** the ledger health check returns offline status
**When** Read-Only Mode activates
**Then** a persistent banner appears at the top: "System in read-only mode. Write operations temporarily unavailable."

**Given** Read-Only Mode is active
**When** I view any action button (Waive Fee, Record Repayment, Request Write-Off)
**Then** the button is disabled with "Unavailable in read-only mode" tooltip

**Given** Read-Only Mode is active
**When** I am viewing customer data
**Then** all read operations continue to work (viewing profiles, balances, transactions)

**Given** the ledger comes back online
**When** the health check succeeds
**Then** Read-Only Mode deactivates, banner dismisses, action buttons re-enable, toast shows "System restored"

---

### Story 5.3: Failed Action Notification Center

As a **support staff member**,
I want to see a persistent list of my failed actions,
So that I can retry them when the system recovers.

**Acceptance Criteria:**

**Given** an action fails due to system error (not validation)
**When** the failure occurs
**Then** the action is added to the notification center with: Action type, Account, Timestamp, Error message, Retry button

**Given** I have failed actions in the notification center
**When** viewing the Payload admin header
**Then** a notification badge shows the count of failed actions

**Given** I click on a failed action in the notification center
**When** the system is back online
**Then** I can click "Retry" to re-attempt the action

**Given** I successfully retry or dismiss a failed action
**When** the notification center updates
**Then** the action is removed from the list

**Given** the browser tab closes
**When** I return later
**Then** failed actions persist (stored in localStorage with TTL)

---

### Story 5.4: Version Conflict Detection

As a **support staff member**,
I want to be alerted when data has changed since I loaded it,
So that I don't overwrite someone else's changes.

**Acceptance Criteria:**

**Given** I loaded a customer's account at version 5
**When** another user modifies the account (version 6)
**Then** my next action attempt returns a version conflict error

**Given** a version conflict is detected
**When** the error displays
**Then** a modal shows: "This record was modified by another user. Please refresh to see the latest data." with Refresh button

**Given** I click "Refresh" on a version conflict
**When** the data reloads
**Then** I see the latest version and can retry my action

**Given** I am editing a form when a conflict is detected
**When** the conflict modal appears
**Then** my unsaved changes are preserved in a "Your changes" section for reference

---

### Story 5.5: Graceful Error Handling

As a **support staff member**,
I want system errors to display helpful messages,
So that I understand what went wrong and what to do next.

**Acceptance Criteria:**

**Given** any API call fails
**When** the error is a known error code
**Then** display the user-friendly message from `ERROR_MESSAGES` constant

**Given** any API call fails
**When** the error is an unknown error
**Then** display "An unexpected error occurred. Please try again or contact support." with error ID for support reference

**Given** a network timeout occurs
**When** the error displays
**Then** show "Request timed out. Please check your connection and try again." with Retry button

**Given** an error occurs
**When** the toast/modal displays
**Then** include a "Copy error details" link for support tickets (includes error ID, timestamp, action attempted)

---

## Epic 6: Navigation UX

Staff have persistent navigation, a dashboard home page, and clear wayfinding throughout the application.

**User Outcome:** Staff can navigate the application intuitively via an enhanced sidebar (Dashboard, Approvals, Search, System Status), understand where they are via breadcrumbs, and start their day from a dashboard showing actionable items.

**Architectural Decision:** Sidebar-first approach - works with Payload's native sidebar architecture rather than fighting it. This reduces implementation effort and leverages Payload's built-in mobile responsiveness.

**FRs Covered:** None (UX Enhancement)
**NFRs Addressed:** NFR9 (Keyboard Nav)
**UX Covered:** UX4 (Keyboard Navigation), UX5 (Responsive)

**Implementation Notes:**
- **Sidebar-first approach:** Work with Payload's existing sidebar architecture, not against it
- Custom `Nav` component wraps Payload's `DefaultNav` to add our navigation items
- Dashboard consolidates action items from multiple sources
- Recent customers stored in localStorage for persistence (IDs only, no PII)
- Mobile responsive handled by Payload's built-in mobile sidebar
- Story 6.5 (Mobile Responsive) cancelled - Payload handles this natively

---

### Story 6.1: Enhanced Sidebar Navigation

As a **support staff member**,
I want the Payload sidebar to include quick navigation to key areas,
So that I can access Dashboard, Approvals, and Search without leaving the admin interface.

**Acceptance Criteria:**

**Given** I am logged into the Payload admin
**When** viewing any page in the application
**Then** the sidebar displays our custom navigation items above Payload's default collection links

**Given** the enhanced sidebar renders
**When** viewing the top section
**Then** I see: Search trigger (🔍), Dashboard link (🏠), and Approvals link (✅) with pending count badge

**Given** I click the Search trigger (🔍)
**When** the click is processed
**Then** the Command Palette opens (existing functionality from Epic 1)

**Given** I click the Dashboard link (🏠)
**When** the click is processed
**Then** I navigate to `/admin/dashboard`

**Given** I click the Approvals link (✅)
**When** logged in with Approver role
**Then** I navigate to `/admin/approvals`

**Given** I am NOT logged in with Approver role
**When** the sidebar renders
**Then** the Approvals link is not visible

**Given** the sidebar renders
**When** viewing the bottom section
**Then** I see the Ledger Status indicator (🟢/🟡/🔴 Online/Degraded/Offline) with latency

**Given** I am on mobile/tablet
**When** using the application
**Then** Payload's built-in mobile sidebar handles responsive behavior (no custom implementation needed)

**Technical Requirements:**

**Given** the sidebar implementation
**When** configuring Payload
**Then** use `admin.components.Nav` to wrap `DefaultNav` with our custom `PayloadNavWrapper`

**Given** the PayloadNavWrapper component
**When** rendering
**Then** structure as: [Custom Nav Items] → [Divider] → [Payload DefaultNav] → [System Status]

---

### Story 6.2: Dashboard Home Page

As a **support staff member**,
I want a dashboard home page that shows actionable items,
So that I can quickly see what needs my attention when I log in.

**Acceptance Criteria:**

**Given** I navigate to `/admin/dashboard`
**When** the dashboard loads
**Then** I see a personalized greeting "Good morning/afternoon/evening, {firstName}!"

**Given** I log in successfully
**When** Payload redirects after authentication
**Then** I am redirected to `/admin/dashboard` (not the default Payload collection list)

**Given** the dashboard loads
**When** there are pending approvals (and I have approver role)
**Then** an "Action Items" card shows: "✅ {count} Pending Approvals" with "Review Approvals →" link

**Given** the dashboard loads
**When** I do NOT have approver role
**Then** the "Pending Approvals" card is not shown

**Given** the dashboard loads
**When** there are failed actions in localStorage
**Then** an "Action Items" card shows: "⚠️ {count} Failed Actions" with "View Failed →" link

**Given** the dashboard loads
**When** viewing "Recent Customers" section
**Then** I see my last 5 viewed customers with: Customer ID, Name, Account count, Total outstanding, "Last viewed" timestamp

**Given** I click on a recent customer row
**When** the click is processed
**Then** I navigate to `/admin/servicing/{customerId}`

**Given** the dashboard loads
**When** viewing "System Status" section
**Then** I see: Ledger Service status + response time, Database connection status

**Given** the dashboard loads
**When** viewing the tip section
**Then** I see a contextual tip like "💡 Press ⌘K to quickly search for any customer"

**Technical Requirements:**

**Given** the dashboard component mounts
**When** fetching dashboard data
**Then** call `GET /api/dashboard?recentCustomerIds={ids}` with IDs from localStorage store

**Given** the dashboard API is called
**When** the response returns
**Then** it includes: `user`, `actionItems`, `recentCustomersSummary`, `systemStatus`

**Given** the dashboard is registered in Payload
**When** configuring `payload.config.ts`
**Then** use `admin.components.views.DashboardView` with `path: '/dashboard'`

---

### Story 6.3: Breadcrumb Navigation

As a **support staff member**,
I want to see breadcrumbs showing my location in the application,
So that I can understand the page hierarchy and navigate back easily.

**Acceptance Criteria:**

**Given** I am on the Dashboard (`/admin`)
**When** viewing breadcrumbs
**Then** no breadcrumb is displayed (root page)

**Given** I am on ServicingView for customer "John Smith"
**When** viewing breadcrumbs
**Then** I see: "🏠 › Customer CUST-001 › John Smith"

**Given** I am on ApprovalsView
**When** viewing breadcrumbs
**Then** I see: "🏠 › Approvals"

**Given** I click "🏠" in the breadcrumb
**When** the click is processed
**Then** I navigate to the dashboard home

**Given** I am viewing a nested page
**When** the breadcrumb displays
**Then** the current page name is bold and not a link

---

### Story 6.4: Recent Customers Store

As a **support staff member**,
I want my recently viewed customers to persist across sessions,
So that I can quickly return to customers I was helping.

**Acceptance Criteria:**

**Given** I navigate to a customer's ServicingView
**When** the page loads
**Then** the customer is added to my "recent customers" list

**Given** I view the same customer multiple times
**When** the recent customers list updates
**Then** the customer appears only once, moved to the top with updated timestamp

**Given** I have viewed more than 10 customers
**When** viewing the recent customers list
**Then** only the most recent 10 are stored (FIFO)

**Given** I close my browser and return later
**When** viewing the dashboard
**Then** my recent customers persist (stored in localStorage)

**Given** I click "Clear History" on the recent customers section
**When** the action completes
**Then** all recent customers are removed from storage

**Security Requirements:**

**Given** the localStorage persistence mechanism
**When** storing recent customer data
**Then** ONLY store non-PII data: `customerId` (string) and `viewedAt` (timestamp)

**Given** the dashboard displays recent customers
**When** rendering customer details (name, account count, balance)
**Then** fetch fresh data from the server using stored IDs (do NOT cache PII in localStorage)

**Given** an XSS attack compromises localStorage
**When** the attacker reads `recent-customers` key
**Then** they can only see customer IDs and timestamps (no names, emails, or financial data)

**Technical Notes:**
- Use Zustand persist middleware with localStorage backend
- Store minimal schema: `{ customers: Array<{ customerId: string, viewedAt: number }> }`
- Dashboard component fetches customer summary data via authenticated API using stored IDs
- No customer names, emails, phone numbers, or financial data stored client-side

---

### Story 6.5: Mobile Responsive Navigation

**STATUS: CANCELLED** ❌

*This story has been cancelled as part of the sidebar-first architectural decision.*

**Reason:** Payload CMS v3 includes built-in mobile-responsive sidebar navigation. Our enhanced sidebar (Story 6.1) automatically inherits this responsive behavior without any custom implementation.

**What Payload provides natively:**
- ✅ Hamburger menu trigger on mobile
- ✅ Slide-in sidebar panel
- ✅ Touch-friendly navigation
- ✅ Automatic breakpoint handling

**Remaining mobile considerations (handled in other stories):**
- Dashboard cards stack vertically (CSS in Story 6.2)
- Recent customers use card layout on mobile (CSS in Story 6.2)

---

### Story 6.6: User Menu Enhancements

**SCOPE REDUCED** - Payload provides most user menu functionality natively.

As a **support staff member**,
I want to view my recent activity from the user menu,
So that I can review actions I've taken.

**Acceptance Criteria:**

**Given** I click on my avatar/name in Payload's header
**When** the dropdown opens
**Then** I see Payload's default items PLUS a new "My Activity" link

**Given** I click "My Activity"
**When** the link navigates
**Then** I see a filtered view of the audit log showing only my actions

**What Payload provides natively (no implementation needed):**
- ✅ User name and email display
- ✅ Sign Out functionality
- ✅ Account settings link

**What we add:**
- 🆕 "My Activity" link to filtered audit log

**Technical Notes:**
- Use Payload's `admin.components.logout` or `afterNavLinks` to inject our link
- My Activity view can reuse the existing audit log component with a user filter

---

### Story 6.7: Role-Based Collection Visibility

As a **system administrator**,
I want Payload's sidebar to show different collections based on user roles,
So that operational staff see a clean, task-focused interface while admins retain full system access.

**Acceptance Criteria:**

**Given** I am logged in with role "operations" or "supervisor" or "readonly"
**When** the sidebar renders
**Then** I do NOT see Payload's default collection links (Users, Media, etc.)
**And** I only see our custom navigation items (Search, Dashboard, Approvals)

**Given** I am logged in with role "admin"
**When** the sidebar renders
**Then** I see all Payload collection links AND our custom navigation items

**Given** I successfully authenticate
**When** Payload completes the login process
**Then** I am redirected to /admin/dashboard (not the default collection list)

**Role Definitions:**
- `admin` - Full system access (sees all collections)
- `supervisor` - Operations + approval authority (no raw collections)
- `operations` - Day-to-day servicing (no raw collections)
- `readonly` - View-only access (no raw collections)

**Technical Notes:**
- Use `admin.hidden` on collections to control sidebar visibility
- Configure `admin.custom.afterLogin` for dashboard redirect
- Redirect authenticated users from `/` to `/admin/dashboard`

---

## Epic 7: Customer Contact Notes

**Goal:** Enable support staff to record, view, and amend customer interaction notes directly within the ServicingView, providing continuity across agents and an immutable audit trail for compliance.

**Dependencies:** Epic 2 (ServicingView must exist)

**References:**
- [Product Brief](_bmad-output/planning-artifacts/product-brief-billie-crm-2026-02-20.md)
- [UX Design](docs/ux-design/contact-notes-ux.md)

### Story 7.1: ContactNotes Payload Collection

As a **developer**, I want a ContactNotes Payload CMS collection with all required fields, indexes, and access control, so that the data model is ready for the notes timeline and add-note UI components.

| AC | Description |
|----|-------------|
| AC1 | Collection registered in Payload with slug `contact-notes` |
| AC2 | All fields present: customer, loanAccount, application, conversation, noteType (11 options), contactDirection, subject, content (Lexical), priority, sentiment, createdBy, amendsNote, status |
| AC3 | Indexes on customer, loanAccount, createdAt, amendsNote |
| AC4 | RBAC: Read (all authenticated), Create (admin/supervisor/operations), Update (status field only, admin/supervisor/operations), Delete (admin only) |
| AC5 | createdBy auto-populated from authenticated user via beforeChange hook |

[Full Story →](sprint-artifacts/7-1-contact-notes-collection.md)

### Story 7.2: Notes Timeline Panel

As a **support staff member**, I want to see a chronological timeline of all contact notes for a customer on their ServicingView, so that I can quickly understand prior interactions before handling their call.

| AC | Description |
|----|-------------|
| AC1 | "Contact Notes" section renders below AccountPanel in the right column |
| AC2 | 5 most recent notes visible by default, newest-first |
| AC3 | Note cards show: type icon, timestamp, subject, truncated body, linked account, author, "Amend" action |
| AC4 | Priority/sentiment indicators hidden when at default values |
| AC5 | Filter by note type dropdown |
| AC6 | Filter by account dropdown (includes "General (no account)") |
| AC7 | Notes linked to selected account highlighted with blue left border |
| AC8 | "Load more" pagination |
| AC9 | Empty state message when no notes exist |
| AC10 | TanStack Query with skeleton loaders and standard staleTime |

[Full Story →](sprint-artifacts/7-2-notes-timeline-panel.md)

### Story 7.3: Add Note Drawer

As a **support staff member**, I want to create a contact note via a slide-over drawer with smart pre-population, so that I can quickly document customer interactions without leaving the ServicingView.

| AC | Description |
|----|-------------|
| AC1 | "+ Add Note" button opens slide-over drawer from right |
| AC2 | Customer field read-only, pre-filled |
| AC3 | Linked Account pre-filled from AccountPanel selection |
| AC4 | Required field validation: noteType, subject, content |
| AC5 | Direction field conditionally shown for phone/email types |
| AC6 | "More" expander reveals Priority and Sentiment fields |
| AC7 | Lexical rich text editor for content |
| AC8 | Subject limited to 200 characters |
| AC9 | Submit closes drawer, shows toast, scrolls timeline, highlights new note |
| AC10 | Keyboard shortcuts: `N` opens, `Escape` closes, `Cmd+Enter` submits |
| AC11 | Focus managed: auto-focus first field on open, return focus on close |

[Full Story →](sprint-artifacts/7-3-add-note-drawer.md)

### Story 7.4: Amendment Chain

As a **support staff member**, I want to amend a contact note by creating a new version linked to the original, so that corrections are traceable without destroying the audit trail.

| AC | Description |
|----|-------------|
| AC1 | "Amend" action on active notes only (not on already-amended notes) |
| AC2 | Amend drawer pre-fills all fields from original note with info banner |
| AC3 | Submit creates new note with `amendsNote` reference, sets original to `amended` status |
| AC4 | Amended notes show amber "AMENDED" badge, de-emphasised content, "View current version" link |
| AC5 | Amendment notes show blue "AMENDMENT" badge, "Amends note from [date]", "View original" link |
| AC6 | Cross-links scroll to and highlight the target note |
| AC7 | Amendments appear at their own creation timestamp in the timeline |

[Full Story →](sprint-artifacts/7-4-amendment-chain.md)

---

## Summary

### Epic Overview

| Epic | Stories | FRs Covered | Sprint Estimate |
|------|---------|-------------|-----------------|
| Epic 1: Global Search & Foundation | 4 | FR1-FR3 + Foundation | 2 sprints |
| Epic 2: Single Customer View | 4 | FR4-FR7 | 2 sprints |
| Epic 3: Financial Actions | 4 | FR8-FR12 | 2 sprints |
| Epic 4: Write-Off & Approval | 5 | FR10, FR13-FR19 | 2-3 sprints |
| Epic 5: System Health | 5 | FR20-FR24 | 1-2 sprints |
| Epic 6: Navigation UX | 6 (1 cancelled) | UX Enhancement | 0.5-1 sprint |
| Epic 7: Customer Contact Notes | 4 | Contact Notes MVP | 1-2 sprints |

**Total: 32 active stories across 7 epics (~10-14 sprints)**

*Note: Epic 6 had Story 6.5 cancelled (Payload handles mobile natively). Story 6.7 added for role-based visibility.*

### Implementation Order

1. **Epic 1** establishes technical foundation - must be first
2. **Epic 2** builds the primary UI that all other features depend on
3. **Epic 3** adds core financial actions using the foundation
4. **Epic 4** adds governance layer (can partially parallel with Epic 3)
5. **Epic 5** adds resilience (can be threaded throughout or at end)
6. **Epic 6** adds navigation UX polish (can parallel with Epic 5)
7. **Epic 7** adds contact notes (requires Epic 2, can parallel with Epics 3-6)

### Dependencies

```
Epic 1 (Foundation) ──► Epic 2 (Customer View) ──► Epic 3 (Actions)
                              │                         │
                              │                         ▼
                              │                Epic 4 (Approvals)
                              │                         │
                              ▼                         │
                     Epic 7 (Contact Notes)             │
                                                        │
Epic 5 (Resilience) ◄──────────────────────────────────┘
        │
        ▼
Epic 6 (Navigation UX)
```

### Definition of Done (All Stories)

- [ ] Code complete with TypeScript strict mode
- [ ] Unit tests passing (≥80% coverage for new code)
- [ ] Integration tests for API routes
- [ ] E2E test for happy path
- [ ] Accessibility audit passed (WCAG 2.1 AA)
- [ ] Code review approved
- [ ] Documentation updated
- [ ] Deployed to staging
- [ ] Product Owner acceptance
