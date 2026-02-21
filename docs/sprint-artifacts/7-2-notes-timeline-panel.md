# Story 7.2: Notes Timeline Panel

**Epic**: Epic 7 - Customer Contact Notes
**Status**: done
**Started**: 2026-02-20
**Completed**: 2026-02-20

## Story

As a **support staff member**,
I want to see a chronological timeline of all contact notes for a customer on their ServicingView,
So that I can quickly understand prior interactions before handling their call.

## Acceptance Criteria

### AC1: Timeline Renders Below AccountPanel
**Given** I am on the ServicingView for a customer
**When** the page loads
**Then** a "Contact Notes" section renders below the AccountPanel in the right column with a header showing the note count and an "+ Add Note" button

### AC2: Default Display
**Given** the notes timeline loads
**When** notes exist for this customer
**Then** the 5 most recent notes are visible, ordered newest-first, with a "Load more" button at the bottom

### AC3: Note Card Display
**Given** a note appears in the timeline
**When** I view the card
**Then** I see: type icon + label, timestamp, subject (bold), body (truncated to ~3 lines with "Show more"), linked account (if any), author name, and "Amend" action link

### AC4: Priority/Sentiment Conditional Display
**Given** a note has priority `normal` and sentiment `neutral`
**When** the card renders
**Then** the priority and sentiment indicators are NOT shown (hidden when defaults)

**Given** a note has priority `high` or sentiment `negative`
**When** the card renders
**Then** the priority and/or sentiment indicators ARE shown

### AC5: Type Filtering
**Given** the notes timeline header
**When** I select a type from the "All Types" dropdown (e.g., "Complaint")
**Then** only notes matching that type are displayed

### AC6: Account Filtering
**Given** a customer with 2+ loan accounts
**When** I view the notes timeline
**Then** an "All Accounts" filter dropdown appears with: All Accounts, each account ID, and "General (no account)"

**Given** I select a specific account from the filter
**When** the timeline updates
**Then** only notes linked to that account are shown

**Given** I select "General (no account)"
**When** the timeline updates
**Then** only notes with no linked account are shown

### AC7: Account Selection Highlighting
**Given** an account is selected in the AccountPanel
**When** I view the notes timeline (with "All Accounts" filter)
**Then** notes linked to the selected account have a subtle blue left border highlight

### AC8: Pagination
**Given** more than 5 notes exist
**When** I click "Load more"
**Then** the next page of notes loads and appends below the existing notes

### AC9: Empty State
**Given** a customer with no contact notes
**When** the timeline loads
**Then** a message displays: "No contact notes yet for this customer. Add a note to start building interaction history."

### AC10: TanStack Query Integration
**Given** the notes timeline
**When** data is being fetched
**Then** skeleton loaders display while loading, and the query uses the standard `staleTime: 10_000` configuration

---

## Tasks / Subtasks

- [x] **Task 1: Create Query Hook** (AC: 10)
  - [x] Create `src/hooks/queries/useContactNotes.ts`
  - [x] Support pagination, type filter, and account filter parameters
  - [x] Query key: `['contact-notes', customerId, { page, type, accountId }]`
  - [x] Exported from `src/hooks/queries/index.ts`

- [x] **Task 2: Create ContactNotesPanel** (AC: 1, 2, 9)
  - [x] Create `src/components/ServicingView/ContactNotes/ContactNotesPanel.tsx`
  - [x] Header with count, "+ Add Note" button
  - [x] Empty state rendering
  - [x] Skeleton loading state (delegated to ContactNotesTimeline)

- [x] **Task 3: Create ContactNoteCard** (AC: 3, 4)
  - [x] Create `src/components/ServicingView/ContactNotes/ContactNoteCard.tsx`
  - [x] Type icon mapping (all 11 note types)
  - [x] Conditional priority/sentiment display (hidden when normal/neutral)
  - [x] Body truncation with "Show more" / "Show less" expand
  - [x] Linked account, author footer, AMENDED/AMENDMENT badges

- [x] **Task 4: Create ContactNoteFilters** (AC: 5, 6)
  - [x] Create `src/components/ServicingView/ContactNotes/ContactNoteFilters.tsx`
  - [x] Type dropdown with all 11 note types
  - [x] Account dropdown (only when 2+ accounts), includes "General (no account)"

- [x] **Task 5: Create ContactNotesTimeline** (AC: 2, 7, 8)
  - [x] Create `src/components/ServicingView/ContactNotes/ContactNotesTimeline.tsx`
  - [x] Newest-first ordering (passed in from hook)
  - [x] Account selection highlighting (blue left border via isHighlighted prop)
  - [x] "Load more" pagination
  - [x] Skeleton loading state (3 animated skeleton cards)
  - [x] Green flash animation for newly added note

- [x] **Task 6: Integrate with ServicingView** (AC: 1)
  - [x] Add `ContactNotesPanel` to `ServicingView.tsx` below `AccountPanel`/`AccountSelectionPrompt`
  - [x] Pass `customerId`, `selectedAccountId`, `accounts`, `onAddNote` props
  - [x] `addNoteOpen` state added for Story 7.3 drawer wiring

- [x] **Task 7: Create Styles** (AC: all)
  - [x] Create `src/components/ServicingView/ContactNotes/styles.module.css`
  - [x] Card layout, highlight border, filter styles, skeleton animation, flash animation, badges, empty state

- [x] **Task 8: Write Tests**
  - [x] 17 unit tests for `ContactNoteCard` (type icons, priority/sentiment badges, AMENDED/AMENDMENT, amend button, linking, author, highlighting, truncation)
  - [x] 10 unit tests for `ContactNoteFilters` (type options, account threshold, "General (no account)", all callback paths)
  - [x] 6 unit tests for `ContactNotesPanel` (title, add button, callback, empty state, count, timeline visibility)
  - [x] 21 unit tests for `useContactNotes` (query key, enabled, fetch URL, filters, pagination)

---

## References

- [UX Design](docs/ux-design/contact-notes-ux.md) - Sections 2, 3
- [Unified Account Panel](docs/ux-design/unified-account-panel.md) - Existing ServicingView layout
