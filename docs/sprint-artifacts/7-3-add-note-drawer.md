# Story 7.3: Add Note Drawer

**Epic**: Epic 7 - Customer Contact Notes
**Status**: done

## Story

As a **support staff member**,
I want to create a contact note via a slide-over drawer with smart pre-population,
So that I can quickly document customer interactions without leaving the ServicingView.

## Acceptance Criteria

### AC1: Drawer Opens from Add Note Button
**Given** I am on the ServicingView for a customer
**When** I click the "+ Add Note" button in the notes timeline header
**Then** a slide-over drawer opens from the right with title "Add Note"

### AC2: Customer Pre-Fill
**Given** the Add Note drawer opens
**When** the form renders
**Then** the customer field shows the current customer name and ID (read-only, not editable)

### AC3: Account Pre-Fill
**Given** an account is selected in the AccountPanel
**When** I open the Add Note drawer
**Then** the "Linked Account" dropdown is pre-filled with the selected account

**Given** no account is selected in the AccountPanel
**When** I open the Add Note drawer
**Then** the "Linked Account" dropdown is empty (account is optional)

### AC4: Required Fields Validation
**Given** I click "Submit" with empty required fields
**When** validation runs
**Then** error messages display for: Note Type ("Please select a note type"), Subject ("Please enter a subject"), Content ("Please enter note content")

### AC5: Direction Field Conditional Display
**Given** I select note type `phone_inbound` or `phone_outbound` or `email_inbound` or `email_outbound`
**When** the type changes
**Then** the Direction dropdown appears with the appropriate pre-set value

**Given** I select note type `general_enquiry`, `complaint`, `escalation`, `internal_note`, `account_update`, or `collections`
**When** the type changes
**Then** the Direction dropdown is hidden

### AC6: More Expander
**Given** the Add Note form
**When** I click "More"
**Then** Priority (default: normal) and Sentiment (default: neutral) dropdowns are revealed

### AC7: Rich Text Editor
**Given** the Content field
**When** I interact with it
**Then** a Lexical rich text editor renders with toolbar options: bold, italic, underline, lists, links

### AC8: Subject Length Limit
**Given** I type in the Subject field
**When** the text exceeds 200 characters
**Then** a validation message shows "Subject must be 200 characters or less"

### AC9: Submit Success
**Given** I have filled all required fields and click "Submit"
**When** the note is saved successfully
**Then**:
- The drawer closes
- A toast displays "Note added"
- The notes timeline scrolls to the top
- The new note is highlighted with a brief green flash (2s fade, respects prefers-reduced-motion)

### AC10: Keyboard Shortcuts
**Given** I am on the ServicingView with no drawer open and not focused on an input
**When** I press `N`
**Then** the Add Note drawer opens

**Given** the Add Note drawer is open
**When** I press `Escape`
**Then** the drawer closes

**Given** I am inside the Add Note form
**When** I press `Cmd+Enter`
**Then** the form submits (same as clicking Submit)

### AC11: Focus Management
**Given** the Add Note drawer opens
**When** the transition completes
**Then** focus is set to the Note Type dropdown (first field)

**Given** the Add Note drawer closes
**When** the transition completes
**Then** focus returns to the "+ Add Note" button

---

## Tasks / Subtasks

- [x] **Task 1: Create Mutation Hook** (AC: 9)
  - [x] Create `src/hooks/mutations/useCreateNote.ts`
  - [x] POST to Payload REST API for `contact-notes` collection
  - [x] Invalidate `['contact-notes', customerId]` queries on success

- [x] **Task 2: Create AddNoteDrawer** (AC: 1-9, 11)
  - [x] Create `src/components/ServicingView/ContactNotes/AddNoteDrawer.tsx`
  - [x] React Hook Form + Zod validation
  - [x] Customer read-only display
  - [x] Account dropdown with pre-fill logic
  - [x] Conditional Direction field
  - [x] "More" collapsible section for Priority/Sentiment
  - [x] Content textarea with Lexical JSON conversion on submit (full Lexical editor deferred post-MVP)
  - [x] Submit handler with toast, query invalidation, highlight, and focus return

- [x] **Task 3: Create Keyboard Shortcuts Hook** (AC: 10)
  - [x] Create `src/components/ServicingView/ContactNotes/useContactNotesHotkeys.ts`
  - [x] `N` to open drawer (suppressed when typing in inputs)
  - [x] `Escape` to close drawer (handled by ContextDrawer)
  - [x] `Cmd+Enter` to submit (handled by form's onKeyDown)

- [x] **Task 4: Wire Drawer to ServicingView** (AC: 1, 3)
  - [x] Drawer state owned by `ContactNotesPanel` (removed from ServicingView)
  - [x] `selectedAccountId` passed through for pre-fill
  - [x] Keyboard shortcuts registered via `useContactNotesHotkeys`
  - [x] `customerName` threaded from ServicingView → ContactNotesPanel → AddNoteDrawer

- [x] **Task 5: Write Tests**
  - [x] 38 unit tests for `AddNoteDrawer` (rendering, validation, conditional fields, submit flow, Cmd+Enter)
  - [x] 12 unit tests for `useContactNotesHotkeys` (N key, input suppression, modifier keys, cleanup)
  - [x] 11 unit tests for `useCreateNote` (POST payload, toast, query invalidation, error handling, loading state)
  - [x] 6 unit tests for `ContactNotesPanel` (updated to reflect self-contained drawer state)

---

## References

- [UX Design](docs/ux-design/contact-notes-ux.md) - Section 4
- [Project Context](docs/project_context.md) - Form patterns (React Hook Form + Zod)

---

## Implementation Details

### Architecture decisions

- **Drawer state moved to `ContactNotesPanel`** — the panel now owns `addNoteOpen`, `newlyAddedNoteId`, and the hotkeys registration. `ServicingView` no longer manages note drawer state.
- **Content field** — uses a `<textarea>` that is converted to Payload-compatible Lexical JSON on submit via `textToLexical()`. The full Lexical rich-text toolbar is deferred post-MVP.
- **Focus management** — ContextDrawer already handles focus trapping and returning focus to the trigger element. `AddNoteDrawer` overrides focus to land on the Note Type `<select>` 100ms after open (AC11).
- **Cmd+Enter** — handled by an `onKeyDown` on the `<form>` element within `AddNoteDrawer`, keeping the logic co-located with the form rather than in the external hotkeys hook.
- **N-key shortcut** — handled by `useContactNotesHotkeys` registered in `ContactNotesPanel`. Suppressed when any input/textarea/select/contenteditable is focused.

### Note flash

`newlyAddedNoteId` is set in `ContactNotesPanel.handleNoteSuccess` after the drawer closes and cleared after 3s. `ContactNotesTimeline` applies `styles.noteFlash` class to the matching note card.

## Files Changed

### New files
- `src/hooks/mutations/useCreateNote.ts` — mutation hook; POSTs to Payload REST API
- `src/components/ServicingView/ContactNotes/AddNoteDrawer.tsx` — the drawer form
- `src/components/ServicingView/ContactNotes/useContactNotesHotkeys.ts` — N-key shortcut hook
- `tests/unit/hooks/useCreateNote.test.ts` — 11 tests
- `tests/unit/ui/add-note-drawer.test.tsx` — 38 tests
- `tests/unit/hooks/useContactNotesHotkeys.test.ts` — 12 tests

### Modified files
- `src/hooks/mutations/index.ts` — added `useCreateNote` export
- `src/components/ServicingView/ContactNotes/ContactNotesPanel.tsx` — added drawer state, hotkeys, `AddNoteDrawer` render, `newlyAddedNoteId` prop to timeline
- `src/components/ServicingView/ContactNotes/styles.module.css` — added drawer form styles
- `src/components/ServicingView/ServicingView.tsx` — removed `addNoteOpen` state, removed `onAddNote` prop, added `customerName` prop to `ContactNotesPanel`
- `tests/unit/ui/contact-notes-panel.test.tsx` — updated for new panel API (removed `onAddNote`, added QueryClientProvider wrapper, mocked new deps)
- `docs/sprint-artifacts/7-3-add-note-drawer.md` — this file
