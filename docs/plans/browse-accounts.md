# Browse Accounts — Implementation Plan

## Context

Billie CRM today surfaces loan accounts only through narrow, purpose-built lenses: Collections (overdue only), Approvals (write-offs only), Pending Disbursements (one status only), dashboard widgets (recently created / upcoming payments), and the `⌘K` palette for point lookup. There is no way to ask *"show me all accounts where X"* — no faceted browser, no shared smart views, no exploratory query surface for audit, reconciliation, customer-care follow-up, or self-defined queue work.

This plan adds a new `/admin/accounts` page modelled on Linear/Superhuman-style operator inboxes: team-shared **Smart Views** in a left rail, composable filter chips, URL-shareable state, a dense table with `j/k` keyboard navigation, a right-side peek drawer, and `⌘K` integration. It complements (does not replace) Collections and Approvals — those keep their bucket-specific affordances.

**Outcome**: an operator can land on `/admin/accounts?view=arrears&min_balance=500`, scan a queue with the keyboard, peek details without losing context, and share the URL with a teammate.

---

## Decisions and assumptions (push back if any are wrong)

| Decision | Rationale |
|---|---|
| **"My queue" Smart View deferred** to phase 2. `LoanAccounts` has no `assignedOfficer` field; rushing one in is a separate product call. | The page still ships with 7 useful views day one. |
| **DPD / aging column deferred.** DPD lives in the ledger service; per-row fetch is N+1, no batch endpoint exists. MVP uses `lastPayment.date` and `daysSinceLastPayment` (computed client-side) as the recency proxy in the Arrears view. | Unblocks v1. Phase 2 denormalises DPD onto `LoanAccount` via the Python event processor (cheap to read in Payload, processor already updates the doc on aging events). |
| **CSV export is client-side** (`Blob`) from the loaded result set, capped at the current page. | The async export-job system at `/admin/exports` is heavy for ad-hoc browsing. Phase 3 graduates to that system if scale demands. |
| **Smart Views are code-defined config**, not user-editable. **Saved Views** (per-user) are phase 3. | Operators share a vocabulary; team-wide queries belong in version control. |
| **Sidebar placement**: `🗂 Accounts` inserted **between Dashboard and Collections**. | Matches discovery / importance order. |
| **URL is the source of truth for state** — view, filters, sort, page all encoded as query params. The rail, chips, and table all read from a single parsed `FiltersState`. | Shareability is the biggest collab affordance missing from existing views. |
| **Page name**: sidebar label `Accounts`, route `/admin/accounts`. | Plain, scannable. "Browse" / "Search" lose meaning quickly. |

---

## Architecture overview

```
URL  /admin/accounts?view=arrears&min_balance=500&sort=-last_payment
      │
      ▼
AccountsBrowserView  (admin shell template, registered in payload.config.ts)
  ├── SmartViewRail        (left)   reads SMART_VIEWS from src/lib/smart-views.ts
  ├── FilterBar            (top)    active filter chips + add-filter + result count + ⌘E
  ├── AccountsTable        (centre) dense rows, sortable headers
  ├── AccountPeekDrawer    (right)  reuses ContextDrawer
  └── ShortcutsCheatsheet  (modal)  `?` to open
```

Data flow:

```
AccountsTable
  → useAccountsBrowser({ filters, sort, page })           (src/hooks/queries/)
     → GET /api/loan-accounts/browse?<qs>                  (new route)
        • Zod-parses query string
        • composes Payload `where` clause
        • returns Payload list shape { docs, totalDocs, page, totalPages, hasNextPage, hasPrevPage }
```

---

## Files to create — MVP

| Path | Purpose | Model after |
|---|---|---|
| `src/lib/smart-views.ts` | `SmartView` interface + the starter `SMART_VIEWS` list. | New. |
| `src/lib/account-filters.ts` | Filter types, predicate composition, Zod URL schema, `filtersToQueryString` / `queryStringToFilters`. | New. |
| `src/hooks/queries/useAccountsBrowser.ts` | RQ hook. Key `['accounts','browse', filters] as const`. Returns Payload list shape + states. | `src/hooks/queries/usePendingApprovals.ts:61-102` |
| `src/hooks/useListKeyboardNav.ts` | `j/k`, `Space`, `Enter` for a table's focus index. | Wraps `src/hooks/useGlobalHotkeys.ts:22-63` |
| `src/app/api/loan-accounts/browse/route.ts` | Listing endpoint. Zod-parse → Payload `where` → paginated response. | Patterns from `/api/write-off-requests` referenced in `usePendingApprovals` |
| `src/components/AccountsBrowserView/AccountsBrowserView.tsx` | Top-level component (composition only). | `src/components/CollectionsView/CollectionsView.tsx` |
| `src/components/AccountsBrowserView/AccountsBrowserViewWithTemplate.tsx` | Admin template wrap. Named export `AccountsBrowserViewWithTemplate`. | `src/components/CollectionsView/CollectionsViewWithTemplate.tsx` |
| `src/components/AccountsBrowserView/SmartViewRail.tsx` | Left rail; highlights active view. | New. |
| `src/components/AccountsBrowserView/FilterBar.tsx` | Active chips + add-filter dropdown + count + export button. | Inline filter row in `CollectionsView` |
| `src/components/AccountsBrowserView/AccountsTable.tsx` | Dense rows, sortable headers, row click → peek, Enter → navigate. | `CollectionsView` table; badges from `AccountHeader.tsx` |
| `src/components/AccountsBrowserView/AccountPeekDrawer.tsx` | Right drawer; status, balance, last payment, last contact note, actions. | `src/components/ApprovalsView/ApprovalDetailDrawer.tsx` (wraps `ContextDrawer`) |
| `src/components/AccountsBrowserView/ShortcutsCheatsheet.tsx` | `?`-triggered modal listing shortcuts. | New. |
| `src/components/AccountsBrowserView/styles.module.css` | Co-located CSS; theme-var conventions. | `CollectionsView/styles.module.css` |
| `src/components/navigation/NavAccountsLink/index.tsx` | Sidebar link. No count badge in MVP. | `src/components/navigation/NavCollectionsLink/index.tsx:15-43` |
| `src/components/navigation/NavAccountsLink/styles.module.css` | Mirrors `NavCollectionsLink` styling. | Same. |

## Files to modify — MVP

| Path | Change |
|---|---|
| `src/payload.config.ts` | (a) Register view under `admin.views.accounts`: `Component: '@/components/AccountsBrowserView/AccountsBrowserViewWithTemplate#AccountsBrowserViewWithTemplate'`, `path: '/accounts'`. (b) Insert `NavAccountsLink` into `admin.components.beforeNavLinks` between `NavDashboardLink` and `NavCollectionsLink`. |
| `src/app/(payload)/admin/importMap.js` | Regenerate via `pnpm generate:importmap` after the payload.config.ts change. |
| `src/components/ui/CommandPalette/CommandPalette.tsx` | Add a "Browse" section above the existing search-results sections. Static entries: "Browse: All accounts" + one per `SMART_VIEWS`. Selecting `router.push`es to `/admin/accounts?view=<id>` and closes the palette. |
| `src/hooks/index.ts` | Barrel-export `useAccountsBrowser`. |

---

## Smart Views — v1 starter set

Defined in `src/lib/smart-views.ts`:

| id | label | filter | sort | notes |
|---|---|---|---|---|
| `all` | All accounts | none | `-createdAt` | escape hatch |
| `arrears` | Arrears | `accountStatus = in_arrears` | `lastPayment.date asc` | replaces "go to Collections" for non-bucket browsing |
| `high-value-at-risk` | High value at risk | `accountStatus = in_arrears` ∧ `totalOutstanding > 500` | `-totalOutstanding` | triage |
| `disbursed-today` | Disbursed today | `accountStatus = active` ∧ `openedDate = @today` | `-openedDate` | disbursement-run sanity check |
| `pending-disbursement` | Pending disbursement | `accountStatus = pending_disbursement` | `-createdAt` | mirrors existing standalone view; deep-link parity |
| `recent-payoff` | Recently paid off | `accountStatus = paid_off` ∧ `closedDate ≥ @30d_ago` | `-closure.closedDate` | customer-care follow-up |
| `written-off-30d` | Written off — last 30d | `closure.reason = WRITTEN_OFF` ∧ `closedDate ≥ @30d_ago` | `-closure.closedDate` | audit / ledger reconciliation |
| `deceased` | Deceased customer | join `customers.individualStatus = DECEASED` | `-updatedAt` | comms suppression — requires a customer subquery; if implementation is awkward, fall back to a static `customerIdString in [...]` resolved at hook-time |

`@today` / `@30d_ago` are resolved at hook-time, not baked.

---

## Filter dimensions (MVP)

URL param → field:

| Param | Field |
|---|---|
| `view` | smart view id |
| `status` | `accountStatus` (multi) |
| `min_balance` / `max_balance` | `balances.totalOutstanding` |
| `opened_from` / `opened_to` | `loanTerms.openedDate` |
| `closed_from` / `closed_to` | `closure.closedDate` |
| `last_pmt_before` | `lastPayment.date` (sugar: "older than X") |
| `closure_reason` | `closure.reason` |
| `customer_status` | join `customers.individualStatus` |
| `payment_frequency` | `repaymentSchedule.paymentFrequency` |
| `q` | text search OR over `accountNumber`, `loanAccountId`, `customerName` (3+ char min, matches `/api/loan-accounts/search` behaviour) |
| `sort` | signed sort key (e.g. `-balances.totalOutstanding`) |
| `page` | offset pagination |

All parsed by one Zod schema in `src/lib/account-filters.ts`. The schema is the single source of truth — the API route uses it server-side; the FilterBar and rail consume it on the client.

---

## Keyboard shortcuts (MVP)

| Key | Action |
|---|---|
| `j` / `↓` | Next row |
| `k` / `↑` | Previous row |
| `Space` | Open peek drawer |
| `Enter` / `o` | Open servicing |
| `c` | Copy selected account number |
| `/` | Focus filter search input |
| `g a` | Go to Accounts (global) |
| `g v <n>` | Jump to Smart View N |
| `?` | Open shortcuts cheatsheet |
| `Esc` | Close drawer / cheatsheet |
| `⌘E` | Export current results to CSV |

Implementation: extend `useGlobalHotkeys` (`src/hooks/useGlobalHotkeys.ts`) to support chord sequences (`g a`, `g v <n>`); add a new `useListKeyboardNav` hook for table-local `j/k`. `?` is registered as a global (with `allowInInput: false`).

---

## Reuse map

| Concern | Source |
|---|---|
| View shell + admin template wrap | `src/components/CollectionsView/CollectionsViewWithTemplate.tsx` |
| Filter row layout | `src/components/CollectionsView/CollectionsView.tsx` filter section |
| Status badge palette | `src/components/ServicingView/AccountPanel/AccountHeader.tsx` |
| Right-side drawer primitive | `src/components/ui/ContextDrawer/ContextDrawer.tsx`; wrap as `ApprovalDetailDrawer.tsx` does |
| Paginated list hook | `src/hooks/queries/usePendingApprovals.ts:61-102` |
| QueryClient defaults | `src/providers/query-client.tsx:9-27` (10s staleTime, refetchOnWindowFocus, retry: 2) |
| `qs-esm` query composition + Payload `where` | `usePendingApprovals.ts:61-71` |
| `⌘K` palette pattern | `src/components/ui/CommandPalette/CommandPalette.tsx` |
| Sidebar link with badge | `src/components/navigation/NavCollectionsLink/index.tsx:15-43` |
| Global hotkey registration | `src/hooks/useGlobalHotkeys.ts:22-63` and `:72-106` |
| Row → servicing navigation | `src/components/CollectionsView/CollectionsView.tsx:85-96` |

---

## Phase 2 (post-MVP)

- **Peek drawer enrichment**: last 5 contact notes, last 3 payments, next upcoming payment, active write-off banner.
- **Watching ★** + a "Watched accounts" Smart View. New per-user prefs collection (or JSON blob on the user doc).
- **DPD / aging column** — denormalise `currentDPD` and `agingBucket` onto `LoanAccount` via the Python event processor (already writes the doc on payment / aging events). Re-render the Arrears view to use real DPD.
- **"My queue"** Smart View — requires `assignedOfficer` relationship on `LoanAccounts` + a re-assignment UI affordance. Schema + UX call for product.
- **"No contact 7d"** Smart View — denormalise `lastContactedAt` onto `LoanAccount` (event processor change), then it's a single Payload `where`.
- **Bulk actions** — multi-select rows → CSV export of selection; later: bulk re-assignment, bulk note.
- **Density toggle** (compact / cozy) — small CSS toggle, low effort, high operator value.

## Phase 3 (later)

- **Saved Views (per-user)** — new collection `accountSavedViews` keyed on user; UI to save / rename / delete; share-with-team option.
- **Natural-syntax search bar** — parser for `status:in_arrears balance:>500 last_pmt:<7d`. Layered on top of the chip system.
- **Server-side CSV export job** — graduate to `/admin/exports` if client-side hits scale.
- **Group-by / Board / Calendar view modes** — only if there's demand. Likely never; table covers 95%.

---

## Verification

1. **Build & typegen**: `pnpm generate:types && pnpm generate:importmap && pnpm build` — succeeds with no TS errors.
2. **Lint**: `pnpm lint` clean.
3. **Unit tests** (new):
   - `tests/unit/lib/account-filters.test.ts` — URL parsing round-trip; Zod rejects malformed.
   - `tests/unit/lib/smart-views.test.ts` — every Smart View resolves to a valid Payload `where`.
   - `tests/unit/hooks/useAccountsBrowser.test.ts` — happy path + filter composition.
4. **Integration test** (`tests/int/api/loan-accounts-browse.int.spec.ts`):
   - Seed ~10 accounts across 5 statuses with existing test helpers.
   - Hit `GET /api/loan-accounts/browse?status=in_arrears&min_balance=500&sort=-balances.totalOutstanding`.
   - Assert filtered `docs`, `totalDocs`, pagination flags.
5. **Manual smoke** (`pnpm dev`):
   - `/admin/accounts` renders the All accounts table.
   - Each Smart View click updates the URL and refilters.
   - Adding a balance filter creates a chip, syncs URL, refilters.
   - `j` / `k` move through rows; `Space` opens peek; `Enter` opens servicing.
   - `?` opens cheatsheet; `Esc` closes.
   - Copy URL with filters → paste in another tab → identical view loads.
   - `⌘K` → "Browse: Arrears" → lands on view.
   - Sidebar shows `🗂 Accounts` between Dashboard and Collections.
6. **Role gating**: `readonly` user — page loads, peek works, mutating row actions hidden. `operations` — full access.
7. **CSV export**: `⌘E` → downloaded `.csv` matches what's on screen (column set = current Smart View's columns).
