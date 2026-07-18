# Marketing Module — UX Review & Recommendations

**Scope:** the Marketing module in the CRM admin — contacts grid (`/admin/marketing`),
contact detail (`/admin/marketing/contacts/:id`), feedback queue
(`/admin/marketing/feedback`), and campaign batches (create / assign / send invitations).

**Reviewed:** `src/components/MarketingView/*`, `src/hooks/queries/*`,
`src/hooks/mutations/useMarketingCommands.ts`, `src/collections/{Contacts,Batches,Feedback,Interactions}.ts`,
navigation and command-palette integration.

---

## Executive summary

The module is functionally complete and has several genuinely good foundations — the
duplicate warn-and-confirm on contact creation, typed confirmations for merge/erase,
row-scoped pending states in the feedback queue, the contact peek modal, and the
failed-actions retry queue. The engineering care is visible.

What makes it *feel* clunky is not any single screen — it's five structural issues:

1. **Campaigns (batches) have no home.** The core marketing workflow — build a segment,
   create a batch, send invitations — is compressed into a toolbar of two near-identical
   dropdowns above the contacts table. There is no batch list, no batch detail, and the
   send results (`invitedCount`, `skippedUnconsented`, `skippedNeedsReview`) are captured
   in the projection but never shown in the UI.
2. **Nothing is in the URL.** Filters, page, and search are all component state. Refresh,
   the back button, or "← Back to Marketing" after opening a contact throws away the
   user's place. This is the most frequent friction in the daily loop.
3. **The write path visibly lags the read path.** Commands are 202-accepted and the UI
   papers over projection lag with delayed re-fetches ("appearing in the grid shortly…").
   Users experience this as the app "not doing anything" or "reverting".
4. **Weak information architecture.** Three peer surfaces (Contacts, Campaigns, Feedback)
   are stitched together with text links instead of a stable sub-navigation, and there is
   no overview/landing state that tells a marketer what needs attention today.
5. **The grid under-serves the segmentation job.** Seven always-visible filters, no sort,
   no email column, an invisible cross-page selection model, and no "select all matching"
   make building a send list harder than it should be.

The good news: most of the fixes are UI-layer only. Nothing below requires changes to the
event-sourced backend, and several items reuse patterns that already exist elsewhere in
this codebase (badge counts, command palette, SSE realtime events, template label maps).

---

## 1. Information architecture & navigation

### Findings

- The sidebar has a single "📣 Marketing" entry that lands on the contacts grid. Feedback
  is reached via a `Feedback queue →` text link in the grid header
  (`MarketingView.tsx:278`), and the way back is a `← Back to Marketing` link. Batches
  are not navigable at all — they exist only as `<option>`s.
- There is no signal of pending work. The feedback queue computes an *overdue complaint*
  state (unresolved complaint > 21 days, `FeedbackQueueView.tsx:67-70`) but nothing
  surfaces a count anywhere — a compliance-relevant queue is effectively invisible unless
  someone remembers to open it.
- The module has no overview. A marketer landing on `/admin/marketing` gets a raw table.
  Meanwhile `GET /api/marketing/dashboard-feed` already computes the acquisition funnel,
  stage/source counts and referral rate — but only for Looker Studio (service-key auth).
- Marketing contacts are absent from the global Cmd+K palette, which searches customers
  and loan accounts only. Finding a lead means navigating to Marketing first, then using
  the local search box.

### Recommendations

1. **Add a persistent sub-nav (tabs) across all three pages:**
   `Contacts · Campaigns · Feedback`. Same position on every page; the active tab replaces
   today's ad-hoc back-links. This one change fixes most of the "where am I?" feeling.
2. **Badge the Feedback tab** with the count of open items, styled red when any complaint
   is overdue. The app already has a `NotificationBadge` pattern to reuse.
3. **Add a compact stats strip** above the contacts grid (funnel counts by stage,
   consented %, open feedback, overdue complaints). Reuse the dashboard-feed aggregation
   queries behind a staff-session-authenticated endpoint — the SQL already exists.
4. **Register a marketing-contacts source in the command palette** so `Cmd+K → name`
   works for leads the same way it does for customers.

---

## 2. Campaigns (batches) need to be a first-class object

### Findings

- The full campaign lifecycle lives in one toolbar row (`MarketingView.tsx:418-487`):
  a "0 selected" counter, an *Assign to batch* dropdown (with a `＋ New batch…` sentinel
  option), an *Assign* button, then a second *Send invitations to* dropdown and a *Send
  invitations* button. Two near-identical batch pickers sit side by side; the coupling
  between them (assigning seeds the invite target, `MarketingView.tsx:201`) is invisible
  logic users cannot predict.
- **Send is a high-stakes, outward-facing action permanently parked next to filters.**
  The confirm dialog is good copy, but it reports nothing quantitative — you confirm a
  send without ever seeing how many people will receive it.
- The batch projection carries exactly the data a marketer wants after a send —
  `invitedAt`, `invitedCount`, `skippedUnconsented`, `skippedNeedsReview`
  (`collections/Batches.ts:32-38`) — and the only place any of it appears is a dropdown
  option label (`… · sent 14/07/2026`). The send outcome toast is the only time the
  numbers are ever visible, and toasts evaporate.
- After creating a batch, `handleBatchCreated` silently polls for up to ~12s
  (`MarketingView.tsx:220-231`). The modal closes immediately and nothing on screen
  indicates the batch is materialising — the dropdown just doesn't contain it yet.
- Membership is invisible: the only way to see who's in a batch is to set the grid's
  Batch *filter* — a read path that shares a picker style with the write path, inviting
  mix-ups.

### Recommendations

1. **Create a Campaigns tab** with a list view: name, created, member count, consented
   count, sent status, invited/skipped numbers. All fields already exist in the
   projection; this is purely a read view.
2. **Create a batch detail page** (`/admin/marketing/campaigns/:batchId`): criteria
   snapshot, member list (the existing grid component filtered to the batch), send
   history and results. Move **Send invitations** here.
3. **Make the send confirmation a pre-flight summary:** "This batch has 120 members.
   **84** will receive an invitation. 30 have no marketing consent, 6 are flagged for
   review (skipped)." The backend can answer this cheaply (it already computes the same
   partition at send time); it converts an act of faith into an informed decision and is
   the single highest-value safety improvement in the module.
4. **Convert the grid's assign bar into a contextual bulk-action bar** that appears only
   when ≥1 row is selected (the standard pattern in Gmail/Linear/HubSpot). Contents:
   "N selected · Assign to campaign… · Clear selection". Remove the permanent invite
   controls from the grid entirely.
5. **Rename "Batch" to "Campaign" (or "Send list") in the UI.** "Batch" is
   system-of-record vocabulary; nothing user-facing needs it. Keep `batchId` internally.

---

## 3. State, URLs and the back button

### Findings

- All grid state — `q`, seven filters, `page` — is `useState` (`MarketingView.tsx:100-111`).
  Consequences: refresh loses everything; back/forward do nothing meaningful; a filtered
  view can't be shared or bookmarked; and the everyday loop of *filter → open contact →
  back* resets the operator to page 1 with no filters. The feedback queue has the same
  issue with its status filter.
- Selection is also lost on any navigation, which punishes exactly the multi-page
  curation workflow the checkboxes exist for.

### Recommendations

1. **Sync filters, search and page to `searchParams`** (`router.replace` on change,
   initialise state from the URL). This is the highest-leverage quick win in the module:
   it fixes back-button amnesia, makes views shareable ("here's the Sydney waitlist"),
   and makes the CSV export reproducible — the export URL and the grid URL become the
   same query string.
2. **Offer a contact peek from the grid** (the `ContactPeekModal` already built for the
   feedback queue) so quick lookups don't require leaving the list at all. Row click can
   keep navigating; add a peek affordance (or make `Space`/hover-card the peek, which the
   keyboard hook already half-supports via `onPeek`).

---

## 4. Perceived latency: projection lag

### Findings

- Every command invalidates queries now + at 1.5s + 4s (`useMarketingCommands.ts:23-29`),
  and note-logging does its own double `setTimeout` (`ContactDetail.tsx:174-179`). The
  toast copy admits the model: *"Contact created — appearing in the grid shortly"*.
- The symptoms users will report as "clunky": a logged note that doesn't appear for a few
  seconds; a cleared review flag that still shows flagged; a merged contact still in the
  grid; a created batch missing from the picker. Each looks like a failed action.

### Recommendations

1. **Adopt optimistic updates for the low-risk, deterministic mutations** (React Query
   `onMutate` cache writes with rollback): log note, flag/clear review, advisory council,
   consent badge, feedback acknowledge/resolve. The client knows the exact end state; the
   invalidation cycle then confirms it. This removes ~90% of the perceived lag at zero
   backend cost.
2. **Where optimism is inappropriate (create contact, merge, erase), show explicit
   pending affordances** instead of toast-promises: a skeleton row "Syncing…" at the top
   of the grid, or an inline banner "1 change syncing…" that clears when the projection
   catches up.
3. **Longer term:** the app already has a realtime events route for other surfaces —
   pushing marketing projection updates over the same SSE channel would let you delete
   the `setTimeout` lattice entirely and drop the 30s polling interval.

---

## 5. The contacts grid

### Findings

- **Columns:** Name shows `firstName` only — with no email column and no surname field,
  a grid of "Sarah / Sarah / —" is not scannable, even though search explicitly matches
  email. No column sorts; `Updated` is the implicit order but can't be flipped.
- **Filters:** seven dropdowns + search are always visible with no summary of what's
  active and no "clear all". The *City* filter is a hardcoded 6-city list over a
  free-text `like` backend (`MarketingView.tsx:50-52`) — any contact outside those six
  cities is unreachable by filter. *Review* and *Advisory council* are binary selects
  ("All contacts / Members only") doing the job of toggle chips. The *Loan outcome*
  filter buries an important compliance rule in a hover tooltip ("win-back segments
  should target Repaid").
- **Selection:** persists invisibly across pages — the count says "3 selected" but there
  is no way to see who they are, deselect from a summary, or select everything matching
  the current filter (assembling a 500-contact campaign means 20 × select-all-on-page).
- **Keyboard:** j/k + Enter + Space exist (nice) but are completely undiscoverable, and
  clickable `<tr>`s aren't otherwise keyboard-focusable.
- **Minor:** header actions ("+ New contact", "Export CSV", feedback link) are unstyled
  siblings of the title; export uses `window.open` (popup blockers).

### Recommendations

1. **Identity cell:** stack name over email/mobile in one column (primary + secondary
   text). Add sortable `Updated` (asc/desc) at minimum.
2. **Filter bar redesign:** keep Search + Stage + Campaign always visible; move Source,
   City, Loan outcome, Review, Advisory behind a "Filters" popover with a count badge
   ("Filters · 2"); render active filters as dismissible chips with a **Clear all**. Make
   City a typeahead over the free-text backend instead of a fixed list.
3. **Selection summary:** "12 selected (3 on other pages) · View · Clear". Add
   **"Select all 240 matching"** as a server-side operation for the assign command — this
   is the feature that makes campaign building actually scale.
4. **Keyboard discoverability:** a subtle "j/k to navigate · ⏎ open · space select" hint
   in the table footer, or a `?` shortcut overlay (a pattern worth sharing with the
   Accounts browser, which uses the same hook).

---

## 6. Contact detail

### Findings

- The right rail is nine stacked panels (Customer link, Same person, Review, Advisory
  council, Consent history, Referrals, Feedback, Loan status, Data & privacy, Audit) —
  a long undifferentiated scroll where routine info and destructive actions
  (Erase contact) share equal visual weight.
- **Consent history and Audit render raw event type strings** (`contact.consent.set.v1`
  style) straight from the projection (`ContactDetail.tsx:240,487,594`). For the one
  panel a marketer must be able to read confidently (Spam Act posture), this is the
  wrong altitude. The codebase already has a template-label map pattern
  (`src/lib/notifications/templateLabels.ts`) to copy.
- The consent badge is binary Granted/Declined, but consent is *per channel*
  (sms/whatsapp/email in `RecordConsentModal`). A contact granted email-only shows the
  same green badge as one granted everything — an operator could reasonably believe an
  SMS send is fine.
- The timeline renders every interaction with no kind filter and no pagination; the
  emoji-icon language (🆕📤📥💬🔗🔀🗒️📦) carries no colour/shape semantics and renders
  inconsistently across platforms.
- The header omits fields the *peek modal* shows (city, source, referral code) — the
  compact view is richer than the full view. No copy-to-clipboard on mobile/email.
- Two of the inline dialogs (Flag for review, Unlink, and the grid's Send-invitations
  confirm) are hand-rolled copies that **lack the `useEscapeClose` behaviour** the other
  six modals have — Esc works in some dialogs and not others, which users feel even if
  they can't name it. None of the modals trap focus.

### Recommendations

1. **Group the rail into three sections:** *Profile* (customer link, referrals, loan
   status, advisory council), *Compliance* (consent + history, review flag, data &
   privacy), *History* (audit). Or promote the timeline/compliance split into tabs.
   Separate the Erase action visually (danger zone at the bottom, as GitHub does).
2. **Humanize event labels** everywhere (consent history, audit, timeline kinds):
   `contact.consent.set.v1` → "Marketing consent granted (SMS, WhatsApp) — campus stall
   form". One mapping module, used by all three panels.
3. **Show per-channel consent** as three mini-chips (SMS ✓ / WA ✓ / Email ✗) in the
   detail header and the peek modal.
4. **Timeline controls:** kind filter chips (Messages / Notes / Feedback / System) and
   "show more" pagination past ~25 items.
5. **Extract one shared `Modal` component** (overlay, Esc, focus trap, `role="dialog"`,
   labelled title) and migrate all nine dialogs. Fixes the inconsistency and the a11y gap
   in one move.
6. Add click-to-copy on mobile/email in the header; bring the header up to peek-modal
   parity (source, city).

---

## 7. Feedback queue

### Findings

- Default filter is **All statuses** — the triage view opens showing resolved history
  mixed with live work.
- No filter by type (complaint vs other) even though the overdue rule is
  complaint-specific; no sort by age; the 21-day threshold is invisible until you hover
  the badge.
- Statuses render as raw lowercase values in a neutral badge (`new`, `acknowledged`,
  `resolved`) — no colour differentiation, no capitalisation.
- Truncated feedback bodies rely on `title` tooltips (unavailable on touch, awkward for
  long complaints). The resolve modal quotes the body — good — but reading a full
  complaint in the queue itself requires the peek-modal → full-profile hop.
- Good patterns worth keeping/extending: row-scoped pending, required resolution note,
  Acknowledge as one-click.

### Recommendations

1. **Default to open items** (`new + acknowledged`); make "Resolved" an explicit tab or
   filter choice.
2. Add **Type filter** and an **Overdue quick filter**; colour-code status badges
   (new = attention, acknowledged = in-progress, resolved = muted) and show
   "Overdue > 21d" as explicit text, not hover-only.
3. Let the feedback row expand (accordion) or make the peek modal include the full
   feedback body, so triage never requires leaving the queue.

---

## 8. Smaller polish items

| Item | Where | Note |
|---|---|---|
| Colour token misuse | `styles.module.css:115,509,630,666` | `--theme-success-*` used with **blue** fallbacks for focus/selection/primary buttons; success elsewhere is green. Define `--marketing-primary`/use the admin primary token so themes don't produce green submit buttons in one place and blue in another. |
| Channel-set mismatch | `NewContactModal` vs `RecordConsentModal` | Channel preference offers SMS/WhatsApp; consent offers SMS/WhatsApp/Email. Align, or explain why email isn't a preference. |
| Mobile input | `NewContactModal.tsx:170-179` | Only a `+61…` placeholder; `marketing-normalise` exists server-side — show the normalised E.164 preview client-side, and validate before submit. |
| Consent "method" | `RecordConsentModal.tsx:126-141` | Free text (50 chars) for a field used as compliance evidence → suggest a select of common methods (campus form, phone call, email request, web form) + "other" free text, for consistency in exports. |
| Export CSV | grid + feedback headers | `window.open` can be popup-blocked and gives no feedback; use a same-tab download (anchor `download`) and a "Preparing export…" toast. |
| New-contact success | `NewContactModal` | On success, offer "View contact" in the toast (route to the created `contactId`) instead of leaving the user to find it in a lagging grid. |
| Empty states | grid, timeline, panels | Plain text only. First-run grid should offer the primary action: "No contacts match — clear filters · + New contact". |
| `Loan status` panel | `ContactDetail.tsx:548-552` | A panel containing one unlabelled raw value (`repaid`). Fold into the Profile group with a label and human casing. |

---

## Prioritised roadmap

### Quick wins (days; UI-only, no backend changes)
1. URL-synced filters/page on grid + feedback queue *(fixes back-button amnesia — do this first)*
2. Sub-nav tabs Contacts · Campaigns · Feedback + open-feedback badge
3. Feedback queue: default to open items; status colours; type/overdue filters
4. Humanized event/consent labels (shared mapping module)
5. Identity cell (name + email/mobile) and sortable Updated column
6. Shared Modal component (Esc + focus trap everywhere)
7. "Clear all filters" + active-filter chips; batch → "Campaign" rename
8. Fix success-token colour fallbacks

### Medium (1–2 sprints)
9. Campaigns tab: list view over the existing batch projection (incl. send results)
10. Campaign detail page; move Send invitations there with the pre-flight summary
    ("84 of 120 will receive…")
11. Contextual bulk-action bar replacing the permanent assign/invite toolbar
12. Selection summary + server-side "select all matching filter" assign
13. Optimistic updates for deterministic mutations; pending affordances for the rest
14. Contact detail rail regrouped (Profile / Compliance / History) + per-channel consent
    chips + timeline filters
15. Marketing contacts in the global Cmd+K palette

### Strategic
16. Overview stats strip / marketing landing (reuse dashboard-feed aggregations behind
    staff auth)
17. SSE projection-update push to eliminate lag-polling and the 30s refetch interval
18. Campaign wizard: segment → review audience → name → (later) schedule send, as the
    canonical guided path for the whole workflow

---

*Prepared as part of the marketing module UX review, July 2026. File references are to
the state of the `main` branch at commit `9571210`.*

---

## Implementation status (July 2026)

Everything above except the two backend-dependent strategic items has been implemented on
this branch. Decisions taken during implementation:

- **"Campaign" is a UI label only** — the API, collections and event vocabulary keep
  `batch`/`batchId`, so no schema or platform changes were needed.
- **The send pre-flight** is computed from the `contacts` projection by a new read-only
  route (`GET /api/marketing/batches/[batchId]/preflight`) that applies the same
  consent/review/erased partition MarketingService applies at send time.
- **"Select all N matching"** uses a new `ids_only=true` mode on the contacts list route,
  capped at 10,000 ids (the `AssignBatchSchema` maximum).
- **The overview strip** (`GET /api/marketing/overview`) reuses the dashboard-feed
  aggregation SQL behind staff-session auth instead of the BI service key.
- **Feedback's "Open" default** is a server-side synthetic status (`status=open` → not
  resolved) shared by the list and CSV-export routes, so exports always match the screen.
- **Perceived projection lag** was addressed with optimistic cache updates for the
  deterministic commands (review flag, advisory council, consent, feedback status, note
  logging) with rollback on error; the lag-tolerant re-invalidation now merely confirms.
- **Channel preference stays SMS/WhatsApp** (the platform's UpsertContact contract);
  the form now explains that email consent is a separate per-channel record.

Deferred (require changes outside this repo):

1. **SSE projection-update push** — needs the Python event processor to emit
   UI-refresh notifications; would remove the residual lag-polling entirely.
2. **Campaign scheduling / wizard** — needs a platform-side scheduled-send command.
