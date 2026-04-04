# Component Inventory: Billie CRM Web

Comprehensive inventory of all React components, hooks, stores, and providers in the Billie CRM web application. The app extends Payload CMS v3.45.0 admin UI with custom views rendered inside the Payload admin template.

**Totals:** 25 component directories, 53 React Query hooks (29 queries + 20 mutations + 4 custom hooks), 6 Zustand stores.

---

## View Components

View components render full admin pages inside Payload's admin template. Each uses a `*WithTemplate` wrapper pattern to integrate with the Payload admin layout (sidebar navigation, header, etc.).

### DashboardView

Home page with portfolio health widgets. Route: `/admin/dashboard`.

| Component | File | Description |
|-----------|------|-------------|
| DashboardView | `index.tsx` | Main dashboard layout, arranges widgets in a grid |
| DashboardViewWithTemplate | `DashboardViewWithTemplate.tsx` | Payload admin template wrapper |
| PortfolioHealthWidget | `PortfolioHealthWidget.tsx` | Portfolio-level health metrics and aging summary |
| ECLSummaryWidget | `ECLSummaryWidget.tsx` | Expected credit loss summary across buckets |
| SystemStatusWidget | `SystemStatusWidget.tsx` | Ledger and event processor health indicators |
| PendingDisbursementsWidget | `PendingDisbursementsWidget.tsx` | Count/summary of loans awaiting disbursement |

`src/components/DashboardView/`

### ServicingView

Core customer servicing UI. Route: `/admin/servicing/:customerId`. The largest component directory (28+ sub-components across three sub-modules).

| Component | File | Description |
|-----------|------|-------------|
| ServicingView | `ServicingView.tsx` | Main container, loads customer context and renders sub-components |
| ServicingViewWithTemplate | `ServicingViewWithTemplate.tsx` | Payload admin template wrapper |
| CustomerHeader | `CustomerHeader.tsx` | Customer name, ID, status badge, contact details |
| CustomerProfile | `CustomerProfile.tsx` | Detailed customer profile information |
| LoanAccountCard | `LoanAccountCard.tsx` | Summary card for a single loan account |
| LoanAccountDetails | `LoanAccountDetails.tsx` | Expanded account detail view |
| TransactionHistory | `TransactionHistory.tsx` | Searchable/filterable transaction history list |
| FeeList | `FeeList.tsx` | Outstanding and historical fees for an account |
| VulnerableCustomerBanner | `VulnerableCustomerBanner.tsx` | Prominent banner when customer is flagged as vulnerable |
| WaiveFeeDrawer | `WaiveFeeDrawer.tsx` | Context drawer to waive a fee |
| RecordRepaymentDrawer | `RecordRepaymentDrawer.tsx` | Context drawer to record a manual repayment |
| BulkWaiveFeeDrawer | `BulkWaiveFeeDrawer.tsx` | Context drawer to waive multiple fees at once |
| WriteOffRequestDrawer | `WriteOffRequestDrawer.tsx` | Context drawer to submit a write-off request for approval |
| ApplyFeeDrawer | `ApplyFeeDrawer.tsx` | Context drawer to apply a late/dishonour fee |
| DisburseLoanDrawer | `DisburseLoanDrawer.tsx` | Context drawer to disburse a loan |
| CustomerHeaderSkeleton | `CustomerHeaderSkeleton.tsx` | Loading skeleton for CustomerHeader |
| CustomerProfileSkeleton | `CustomerProfileSkeleton.tsx` | Loading skeleton for CustomerProfile |
| LoanAccountsSkeleton | `LoanAccountsSkeleton.tsx` | Loading skeleton for loan account cards |
| TransactionsSkeleton | `TransactionsSkeleton.tsx` | Loading skeleton for transaction list |

**AccountPanel sub-module** (`ServicingView/AccountPanel/`):

| Component | File | Description |
|-----------|------|-------------|
| AccountPanel | `AccountPanel.tsx` | Container for tabbed account detail view |
| AccountTabs | `AccountTabs.tsx` | Tab navigation (Overview, ECL, Fees, Transactions, etc.) |
| AccountHeader | `AccountHeader.tsx` | Account ID, status, and quick actions |
| AccountSwitcher | `AccountSwitcher.tsx` | Dropdown to switch between customer's loan accounts |
| OverviewTab | `OverviewTab.tsx` | Balance summary, aging, key account metrics |
| ECLTab | `ECLTab.tsx` | ECL allowance, triggers, calculation breakdown |
| FeesTab | `FeesTab.tsx` | Fee list with waive actions |
| TransactionsTab | `TransactionsTab.tsx` | Transaction history within account panel |
| ActionsTab | `ActionsTab.tsx` | Available account actions (disburse, write-off, etc.) |
| AccrualsTab | `AccrualsTab.tsx` | Accrual history and yield calculations |
| RepaymentScheduleList | `RepaymentScheduleList.tsx` | Instalment schedule with payment status indicators |
| EnhancedScheduleList | `EnhancedScheduleList.tsx` | Extended schedule view with additional detail |
| AccrualHistoryModal | `AccrualHistoryModal.tsx` | Modal showing full accrual calculation history |
| CarryingAmountModal | `CarryingAmountModal.tsx` | Modal showing carrying amount breakdown |
| useAccountPanelHotkeys | `useAccountPanelHotkeys.ts` | Keyboard shortcuts scoped to account panel |

**ContactNotes sub-module** (`ServicingView/ContactNotes/`):

| Component | File | Description |
|-----------|------|-------------|
| ContactNotesPanel | `ContactNotesPanel.tsx` | Main container for contact notes section |
| ContactNotesTimeline | `ContactNotesTimeline.tsx` | Chronological timeline of contact notes |
| ContactNoteCard | `ContactNoteCard.tsx` | Individual note display with author, timestamp, rich text |
| AddNoteDrawer | `AddNoteDrawer.tsx` | Context drawer with Tiptap editor for new notes |
| ContactNoteFilters | `ContactNoteFilters.tsx` | Filter controls (date range, author, category) |
| useContactNotesHotkeys | `useContactNotesHotkeys.ts` | Keyboard shortcuts scoped to contact notes |

`src/components/ServicingView/`

### ApprovalsView

Write-off approval queue. Restricted to Admin and Supervisor roles. Route: `/admin/approvals`.

| Component | File | Description |
|-----------|------|-------------|
| ApprovalsView | `ApprovalsView.tsx` | Main container with pending/history tab layout |
| ApprovalsViewWithTemplate | `ApprovalsViewWithTemplate.tsx` | Payload admin template wrapper |
| ApprovalsList | `ApprovalsList.tsx` | Sortable list of pending write-off requests |
| ApprovalDetailDrawer | `ApprovalDetailDrawer.tsx` | Drawer showing full write-off request details |
| ApprovalActionModal | `ApprovalActionModal.tsx` | Confirmation modal for approve/reject actions |
| HistoryTab | `HistoryTab.tsx` | Past approval decisions with filtering |
| HistoryFilters | `HistoryFilters.tsx` | Filter controls for approval history |
| HistoryDetailDrawer | `HistoryDetailDrawer.tsx` | Drawer showing historical decision details |

`src/components/ApprovalsView/`

### CollectionsView

Overdue accounts queue, filterable by aging bucket and days past due. Route: `/admin/collections`.

| Component | File | Description |
|-----------|------|-------------|
| CollectionsView | `CollectionsView.tsx` | Filterable overdue accounts table with bucket/DPD filters |
| CollectionsViewWithTemplate | `CollectionsViewWithTemplate.tsx` | Payload admin template wrapper |

`src/components/CollectionsView/`

### PeriodCloseView

Month-end close wizard and close history. Route: `/admin/period-close`.

| Component | File | Description |
|-----------|------|-------------|
| PeriodCloseView | `PeriodCloseView.tsx` | Main view with wizard and history tabs |
| PeriodCloseViewWithTemplate | `PeriodCloseViewWithTemplate.tsx` | Payload admin template wrapper |
| PeriodCloseWizard | `PeriodCloseWizard.tsx` | Step-by-step close wizard (preview, acknowledge anomalies, finalize) |

`src/components/PeriodCloseView/`

### ECLConfigView

Expected Credit Loss configuration management. Route: `/admin/ecl-config`.

| Component | File | Description |
|-----------|------|-------------|
| ECLConfigView | `ECLConfigView.tsx` | PD rate editor, overlay management, scheduled changes |
| ECLConfigViewWithTemplate | `ECLConfigViewWithTemplate.tsx` | Payload admin template wrapper |

`src/components/ECLConfigView/`

### ExportCenterView

Data export management and job tracking. Route: `/admin/exports`.

| Component | File | Description |
|-----------|------|-------------|
| ExportCenterView | `ExportCenterView.tsx` | Export job creation, status tracking, download links |
| ExportCenterViewWithTemplate | `ExportCenterViewWithTemplate.tsx` | Payload admin template wrapper |

`src/components/ExportCenterView/`

### InvestigationView

Event history and traceability tools. Tabs: Events, ECL trace, Accrual trace. Route: `/admin/investigation`.

| Component | File | Description |
|-----------|------|-------------|
| InvestigationView | `InvestigationView.tsx` | Tabbed view for event replay, ECL trace, accrual trace |
| InvestigationViewWithTemplate | `InvestigationViewWithTemplate.tsx` | Payload admin template wrapper |

`src/components/InvestigationView/`

### PendingDisbursementsView

Pending loan disbursements with disburse action. Route: `/admin/pending-disbursements`.

| Component | File | Description |
|-----------|------|-------------|
| PendingDisbursementsView | `PendingDisbursementsView.tsx` | List of loans awaiting disbursement with action drawer |
| PendingDisbursementsViewWithTemplate | `PendingDisbursementsViewWithTemplate.tsx` | Payload admin template wrapper |

`src/components/PendingDisbursementsView/`

### MyActivityView

Current user's write-off requests with filter by status (All/Submitted/Decided). Route: `/admin/my-activity`.

| Component | File | Description |
|-----------|------|-------------|
| MyActivityView | `index.tsx` | User's own write-off request history with status filter |
| MyActivityViewWithTemplate | `MyActivityViewWithTemplate.tsx` | Payload admin template wrapper |

`src/components/MyActivityView/`

### SystemStatusView

System health monitoring and stream processing status. Route: `/admin/system-status`.

| Component | File | Description |
|-----------|------|-------------|
| SystemStatusView | `SystemStatusView.tsx` | Ledger health, Redis stream status, event processing metrics |
| SystemStatusViewWithTemplate | `SystemStatusViewWithTemplate.tsx` | Payload admin template wrapper |

`src/components/SystemStatusView/`

### LoanAccountServicing

In-collection servicing panel. Renders inside Payload's Loan Account edit view as a custom tab.

| Component | File | Description |
|-----------|------|-------------|
| LoanAccountServicing | `index.tsx` | Main container. Fetches account context, displays balance, actions, and transactions |
| BalanceCard | `BalanceCard.tsx` | Live balances (Principal, Fees, Total) with ledger-offline fallback |
| TransactionList | `TransactionList.tsx` | Transaction history data table with type filtering and pagination |
| RecordPaymentModal | `RecordPaymentModal.tsx` | `POST /api/ledger/repayment` -- records manual payments |
| ApplyLateFeeModal | `ApplyLateFeeModal.tsx` | `POST /api/ledger/late-fee` -- applies late fee |
| WaiveFeeModal | `WaiveFeeModal.tsx` | `POST /api/ledger/waive-fee` -- waives a fee (requires approval) |
| AdjustmentModal | `AdjustmentModal.tsx` | `POST /api/ledger/adjustment` -- manual debit/credit corrections |
| WriteOffModal | `WriteOffModal.tsx` | `POST /api/ledger/write-off` -- writes off bad debt (requires "WRITE OFF" confirmation) |
| DisburseLoanModal | `DisburseLoanModal.tsx` | `POST /api/ledger/disburse` -- disburse a loan |

`src/components/LoanAccountServicing/`

---

## Shared Components

Reusable components used across multiple views.

### ui (Primitives)

| Component | File | Description |
|-----------|------|-------------|
| CommandPalette | `CommandPalette/CommandPalette.tsx` | Global search overlay (Cmd+K / Ctrl+K / F7). Uses cmdk library |
| CustomerSearchResult | `CommandPalette/CustomerSearchResult.tsx` | Search result row for a customer match |
| LoanAccountSearchResult | `CommandPalette/LoanAccountSearchResult.tsx` | Search result row for a loan account match |
| Skeleton | `Skeleton/Skeleton.tsx` | Loading placeholder with shimmer animation |
| ContextDrawer | `ContextDrawer/ContextDrawer.tsx` | Slide-in drawer panel for forms and detail views |
| CopyButton | `CopyButton.tsx` | Click-to-copy button with tooltip feedback |

`src/components/ui/`

### SortableTable

| Component | File | Description |
|-----------|------|-------------|
| SortableTable | `index.tsx` | Reusable table with sortable column headers, accepts column definitions |

`src/components/SortableTable/`

### Breadcrumb

| Component | File | Description |
|-----------|------|-------------|
| Breadcrumb | `index.tsx` | Hierarchical navigation path display |

`src/components/Breadcrumb/`

### LedgerStatus

| Component | File | Description |
|-----------|------|-------------|
| LedgerStatusIndicator | `LedgerStatusIndicator.tsx` | Persistent indicator showing ledger service health. Polls every 30s. Renders in Providers |

`src/components/LedgerStatus/`

### ReadOnlyBanner

| Component | File | Description |
|-----------|------|-------------|
| ReadOnlyBanner | `ReadOnlyBanner.tsx` | Persistent banner displayed when app is in read-only mode (ledger offline) |

`src/components/ReadOnlyBanner/`

### VersionConflictModal

| Component | File | Description |
|-----------|------|-------------|
| VersionConflictModal | `VersionConflictModal.tsx` | Dialog shown when optimistic locking detects a concurrent edit conflict |

`src/components/VersionConflictModal/`

### FailedActions

| Component | File | Description |
|-----------|------|-------------|
| FailedActionsBadge | `FailedActionsBadge.tsx` | Badge counter shown in global UI when there are retryable failed actions |
| FailedActionsPanel | `FailedActionsPanel.tsx` | Expandable panel listing failed actions with retry/dismiss controls |

`src/components/FailedActions/`

### Notifications

| Component | File | Description |
|-----------|------|-------------|
| NotificationBadge | `NotificationBadge.tsx` | Unread notification count badge |
| NotificationPanel | `NotificationPanel.tsx` | Dropdown panel listing notifications |
| NotificationIndicator | `NotificationIndicator.tsx` | Combined badge + panel trigger |
| NotificationIndicatorWrapper | `NotificationIndicatorWrapper.tsx` | Wrapper for Payload admin actions slot integration |
| NotificationAction | `NotificationAction.tsx` | Individual notification item with action button |

`src/components/Notifications/`

### LoanAccounts

| Component | File | Description |
|-----------|------|-------------|
| DisburseRowActionCell | `DisburseRowActionCell.tsx` | Inline action cell for disbursement in collection list views |

`src/components/LoanAccounts/`

### AdminRootRedirect

| Component | File | Description |
|-----------|------|-------------|
| AdminRootRedirect | `AdminRootRedirect.tsx` | Server component that redirects `/admin` to `/admin/dashboard` |

`src/components/AdminRootRedirect/`

### Auth

| Component | File | Description |
|-----------|------|-------------|
| GoogleLoginButton | `GoogleLoginButton.tsx` | Google OAuth login button for Payload admin login page |

`src/components/Auth/`

### UserSessionGuard

| Component | File | Description |
|-----------|------|-------------|
| UserSessionGuard | `index.tsx` | Security component that detects user changes and clears all client-side state (Zustand stores, localStorage) to prevent cross-user data leakage |

`src/components/UserSessionGuard/`

---

## Navigation

Sidebar navigation items registered in `payload.config.ts` via `admin.components.beforeNavLinks`. Each is a standalone component directory with its own styles.

| Component | Directory | Description |
|-----------|-----------|-------------|
| NavSearchTrigger | `navigation/NavSearchTrigger/` | Opens the global command palette (Cmd+K) |
| NavDashboardLink | `navigation/NavDashboardLink/` | Link to `/admin/dashboard` |
| NavCollectionsLink | `navigation/NavCollectionsLink/` | Link to `/admin/collections` (overdue accounts) |
| NavApprovalsLink | `navigation/NavApprovalsLink/` | Link to `/admin/approvals` with pending count badge |
| NavPeriodCloseLink | `navigation/NavPeriodCloseLink/` | Link to `/admin/period-close` |
| NavECLConfigLink | `navigation/NavECLConfigLink/` | Link to `/admin/ecl-config` |
| NavExportsLink | `navigation/NavExportsLink/` | Link to `/admin/exports` |
| NavInvestigationLink | `navigation/NavInvestigationLink/` | Link to `/admin/investigation` |
| NavSystemStatus | `navigation/NavSystemStatus/` | Link to `/admin/system-status` |
| NavSettingsMenu | `navigation/NavSettingsMenu/` | Settings dropdown menu |

`src/components/navigation/`

---

## Hooks

All data fetching uses TanStack React Query. Hooks are organized in `src/hooks/queries/` (reads) and `src/hooks/mutations/` (writes), with custom utility hooks at `src/hooks/`.

### Query Hooks (29)

| Hook | File | Description |
|------|------|-------------|
| useCustomerSearch | `queries/useCustomerSearch.ts` | Search customers by name, email, phone, or ID |
| useLoanAccountSearch | `queries/useLoanAccountSearch.ts` | Search loan accounts by account number or customer ID |
| useCustomer | `queries/useCustomer.ts` | Fetch full customer record with loan accounts and live balances |
| useTransactions | `queries/useTransactions.ts` | Paginated transaction history for an account, with type filtering |
| useOverdueAccounts | `queries/useOverdueAccounts.ts` | Overdue accounts list with bucket/DPD filtering for CollectionsView |
| usePortfolioECL | `queries/usePortfolioECL.ts` | Portfolio-level ECL summary by bucket |
| useEventProcessingStatus | `queries/useEventProcessingStatus.ts` | Redis stream processing lag and consumer group status |
| useAccountAging | `queries/useAccountAging.ts` | Account aging bucket and transition history |
| useAccruedYield | `queries/useAccruedYield.ts` | Current accrued yield with calculation breakdown |
| useAccrualHistory | `queries/useAccruedYield.ts` | Historical accrual events (co-located with useAccruedYield) |
| useECLAllowance | `queries/useECLAllowance.ts` | ECL allowance, triggers, calculation breakdown for an account |
| useScheduleWithStatus | `queries/useScheduleWithStatus.ts` | Repayment schedule with instalment payment status |
| useCarryingAmountBreakdown | `queries/useCarryingAmountBreakdown.ts` | Carrying amount decomposition (principal, fees, accrued interest) |
| useClosedPeriods | `queries/useClosedPeriods.ts` | List of finalized period close records |
| useECLConfig | `queries/useECLConfig.ts` | Current ECL configuration (PD rates, overlays) |
| useECLConfigHistory | `queries/useECLConfigHistory.ts` | Audit trail of ECL configuration changes |
| usePendingConfigChanges | `queries/usePendingConfigChanges.ts` | Scheduled but not yet applied ECL config changes |
| useExportJobs | `queries/useExportJobs.ts` | Export job list with status, type, and format metadata |
| useEventHistory | `queries/useEventHistory.ts` | Event stream history for an account (Investigation) |
| useTraceECL | `queries/useTraceECL.ts` | ECL calculation trace showing source events and inputs |
| useTraceAccrual | `queries/useTraceAccrual.ts` | Accrual calculation trace showing source events and inputs |
| useContactNotes | `queries/useContactNotes.ts` | Contact notes for a customer with filtering |
| useDashboard | `queries/useDashboard.ts` | Aggregated dashboard data for widgets |
| useApprovalHistory | `queries/useApprovalHistory.ts` | Historical write-off approval decisions |
| useApprovalNotifications | `queries/useApprovalNotifications.ts` | Unread approval notification count |
| useLedgerHealth | `queries/useLedgerHealth.ts` | Ledger service health check (drives read-only mode) |
| useFeesCount | `queries/useFeesCount.ts` | Outstanding fee count for an account |
| usePendingApprovals | `queries/usePendingApprovals.ts` | Count/list of write-off requests pending approval |
| usePendingWriteOff | `queries/usePendingWriteOff.ts` | Pending write-off request for a specific account |

### Mutation Hooks (20)

| Hook | File | Description | API Endpoint |
|------|------|-------------|--------------|
| useWaiveFee | `mutations/useWaiveFee.ts` | Waive a fee on a loan account | `POST /api/ledger/waive-fee` |
| useRecordRepayment | `mutations/useRecordRepayment.ts` | Record a manual repayment with allocation | `POST /api/ledger/repayment` |
| useWriteOffRequest | `mutations/useWriteOffRequest.ts` | Submit a write-off request for approval | `POST /api/commands/writeoff` |
| useApproveWriteOff | `mutations/useApproveWriteOff.ts` | Approve a pending write-off request | `POST /api/commands/writeoff/:id/approve` |
| useRejectWriteOff | `mutations/useRejectWriteOff.ts` | Reject a pending write-off request | `POST /api/commands/writeoff/:id/reject` |
| useCancelWriteOff | `mutations/useCancelWriteOff.ts` | Cancel a submitted write-off request | `POST /api/commands/writeoff/:id/cancel` |
| useCreateNote | `mutations/useCreateNote.ts` | Create a new contact note (rich text via Tiptap) | `POST /api/contact-notes` |
| useAmendNote | `mutations/useAmendNote.ts` | Amend an existing contact note | `PATCH /api/contact-notes/:id` |
| useFinalizePeriodClose | `mutations/useFinalizePeriodClose.ts` | Finalize a period close | `POST /api/period-close/finalize` |
| usePeriodClosePreview | `mutations/usePeriodClosePreview.ts` | Generate period close preview with anomaly detection | `POST /api/period-close/preview` |
| useAcknowledgeAnomaly | `mutations/useAcknowledgeAnomaly.ts` | Acknowledge a period close anomaly | `POST /api/period-close/acknowledge` |
| useUpdatePDRate | `mutations/useUpdatePDRate.ts` | Update probability of default rates | `PATCH /api/ecl-config/pd-rates` |
| useUpdateOverlay | `mutations/useUpdateOverlay.ts` | Update ECL overlay adjustment | `PATCH /api/ecl-config/overlay` |
| useScheduleConfigChange | `mutations/useScheduleConfigChange.ts` | Schedule a future ECL config change | `POST /api/ecl-config/schedule` |
| useCancelConfigChange | `mutations/useCancelConfigChange.ts` | Cancel a scheduled ECL config change | `DELETE /api/ecl-config/schedule/:id` |
| useTriggerPortfolioRecalc | `mutations/useTriggerPortfolioRecalc.ts` | Trigger portfolio-wide ECL recalculation | `POST /api/ecl-config/recalc` |
| useCreateExportJob | `mutations/useCreateExportJob.ts` | Create a new data export job | `POST /api/exports` |
| useRetryExport | `mutations/useRetryExport.ts` | Retry a failed export job | `POST /api/exports/:id/retry` |
| useBatchQuery | `mutations/useBatchQuery.ts` | Batch query multiple accounts (Investigation) | `POST /api/investigation/batch` |
| useRandomSample | `mutations/useRandomSample.ts` | Random sample of accounts for investigation | `POST /api/investigation/sample` |

### Custom Hooks (4)

| Hook | File | Description |
|------|------|-------------|
| useGlobalHotkeys | `useGlobalHotkeys.ts` | Global keyboard shortcuts (also exports `useCommandPaletteHotkeys`) |
| useReadOnlyMode | `useReadOnlyMode.ts` | Syncs ledger health status with `useUIStore.readOnlyMode` |
| useTrackCustomerView | `useTrackCustomerView.ts` | Records customer ID to `useRecentCustomersStore` on view |
| useVersionConflictModal | `useVersionConflictModal.ts` | Logic for detecting and displaying version conflict dialogs |

---

## Stores

Client-side state managed via Zustand. Located in `src/stores/`.

### useUIStore

**File:** `src/stores/ui.ts`

Global UI state. Not persisted.

| State | Type | Description |
|-------|------|-------------|
| readOnlyMode | `boolean` | When `true`, all mutation actions are disabled (ledger offline) |
| commandPaletteOpen | `boolean` | Open/close state for the global search palette |
| commandPaletteQuery | `string` | Current search query in the command palette |
| highlightedTransactionId | `string \| null` | Transaction to highlight (for payment-to-transaction linking) |
| transactionNavigationSource | `object \| null` | Back-navigation context (`paymentNumber`, `transactionId`) |
| expandedPaymentNumber | `number \| null` | Payment number to auto-expand when returning to Overview |

### useFailedActionsStore

**File:** `src/stores/failed-actions.ts`

Queue of failed mutations for retry. Persisted to `localStorage` with 24-hour TTL and a maximum of 50 items. Cleared on user change by `UserSessionGuard`.

| State / Method | Description |
|----------------|-------------|
| actions | Array of `FailedAction` objects |
| addFailedAction | Add a failed action (deduplicates by type + accountId) |
| removeAction | Remove on success or dismiss |
| incrementRetryCount | Track retry attempts |
| clearAll | Clear entire queue |
| getActiveCount | Count of non-expired actions |
| loadFromStorage | Hydrate from localStorage on mount |

**Action types:** `waive-fee`, `record-repayment`, `write-off-request`

### useOptimisticStore

**File:** `src/stores/optimistic.ts`

Tracks in-flight mutations per account for optimistic UI updates. Not persisted.

| State / Method | Description |
|----------------|-------------|
| pendingByAccount | `Map<accountId, Map<mutationId, PendingMutation>>` |
| setPending | Register a new pending mutation |
| setStage | Update mutation stage (`pending` / `succeeded` / `failed`) |
| clearPending | Remove a completed mutation |
| getPendingForAccount | List all pending mutations for an account |
| getPendingAmount | Sum of pending mutation amounts (excluding failed) |
| hasPendingMutations | Boolean check for any pending mutations |
| hasPendingAction | Check if a specific action type is pending |

### useRecentCustomersStore

**File:** `src/stores/recentCustomers.ts`

Last 10 viewed customer IDs. Persisted to `localStorage` via Zustand `persist` middleware. Stores only IDs and timestamps (no PII). Cleared on user change by `UserSessionGuard`.

| State / Method | Description |
|----------------|-------------|
| customers | Array of `{ customerId, viewedAt }` (max 10) |
| addCustomer | Add/promote a customer to top of recents (deduplicates) |
| clearHistory | Clear all recent customer records |

### useVersionStore

**File:** `src/stores/version.ts`

Tracks loan account document versions for optimistic locking / conflict detection. Not persisted.

| State / Method | Description |
|----------------|-------------|
| versions | `Map<loanAccountId, AccountVersion>` |
| setVersion | Track a loaded account's version (`updatedAt`, `payloadDocId`) |
| getExpectedVersion | Get the `updatedAt` value to send with mutations |
| getVersionInfo | Get full version record for an account |
| clearVersion | Clear version after successful mutation |
| clearAllVersions | Clear all on logout or full page refresh |
| hasVersion | Check if a version is being tracked |

### Barrel Export

**File:** `src/stores/index.ts`

Re-exports `useOptimisticStore`, `useRecentCustomersStore`, and `useUIStore`. Note: `useFailedActionsStore` and `useVersionStore` are imported directly from their source files where needed.

---

## Providers

**File:** `src/providers/index.tsx`

The `Providers` component wraps all Payload admin pages. Registered in `payload.config.ts` as `admin.components.providers`. Must be the default export.

### Provider Tree

```
Providers
  QueryClientProvider          -- TanStack React Query context
    UserSessionGuard           -- Clears stores on user change (security)
    AuthenticatedIndicators    -- Only renders when user is authenticated
      ReadOnlyModeSync         -- Syncs ledger health -> readOnlyMode
      ReadOnlyBanner           -- Shows banner when in read-only mode
      GlobalCommandPalette     -- Global Cmd+K search
      LedgerStatusIndicator    -- Persistent health indicator
      FailedActionsBadge       -- Failed action count badge
    {children}                 -- Page content
    Toaster                    -- sonner toast notifications (top-right)
    ReactQueryDevtools         -- Dev-only query inspector
```

`AuthenticatedIndicators` is a guard that renders nothing on the login screen, preventing unauthenticated health-check requests from triggering false "offline" or "read-only" states.

---

## Patterns

### View Template Wrapper

All custom views use a `*WithTemplate` component that wraps the view in Payload's `DefaultTemplate`, providing the admin sidebar, header, and layout. The `WithTemplate` component is the one registered in `payload.config.ts` under `admin.views`.

### State Management Split

- **Server state**: TanStack React Query (queries for reads, mutations for writes)
- **Client state**: Zustand (UI state, optimistic updates, failed action queue, version tracking, recent customers)
- These layers are connected: mutation hooks update Zustand optimistic state, and query invalidation is triggered on mutation success.

### Optimistic Updates

Mutation hooks register pending operations in `useOptimisticStore` before the server responds. Balance displays and action buttons read from this store to show immediate feedback. On failure, mutations are moved to `useFailedActionsStore` for retry.

### Failed Action Persistence

`useFailedActionsStore` persists to `localStorage` with a 24-hour TTL and a cap of 50 items. Failed actions are retryable from the `FailedActionsPanel`. Duplicates (same type + account) are deduplicated.

### Session Isolation

`UserSessionGuard` detects when the authenticated user changes and clears all client-side stores (`useFailedActionsStore`, `useRecentCustomersStore`, React Query cache). This prevents cross-user data leakage.

### Optimistic Locking

`useVersionStore` tracks the `updatedAt` timestamp of each loaded loan account. Mutation hooks include this as `expectedVersion` in API requests. If the server detects a mismatch (another user modified the record), the `VersionConflictModal` is shown.

### Role-Based UI

Four roles: `admin`, `supervisor`, `operations`, `readonly`. Approval actions (`useApproveWriteOff`, `useRejectWriteOff`) require `admin` or `supervisor`. The `readOnlyMode` flag additionally disables all mutation actions when the ledger is offline, regardless of role.

### Keyboard Shortcuts

Global hotkeys (`useGlobalHotkeys`) and view-scoped hotkeys (`useAccountPanelHotkeys`, `useContactNotesHotkeys`) provide keyboard navigation. The command palette responds to Cmd+K / Ctrl+K / F7.

### Styling

- CSS Modules for custom components (`*.module.css`)
- Payload's design system CSS variables reused where possible
- Australian locale throughout (AUD currency, en-AU date formats via `src/lib/formatters.ts`)
