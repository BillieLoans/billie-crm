# Story 7.4: Amendment Chain

**Epic**: Epic 7 - Customer Contact Notes
**Status**: pending

## Story

As a **support staff member**,
I want to amend a contact note by creating a new version linked to the original,
So that corrections are traceable without destroying the audit trail.

## Acceptance Criteria

### AC1: Amend Action on Note Cards
**Given** a note card in the timeline with status `active`
**When** I view the card footer
**Then** an "Amend" action link is visible

**Given** a note card with status `amended`
**When** I view the card footer
**Then** the "Amend" action is NOT visible (can only amend the active version)

### AC2: Amend Drawer Pre-Fill
**Given** I click "Amend" on a note
**When** the drawer opens
**Then**:
- Title shows "Amend Note"
- A banner displays: "You are creating an amendment. The original note will be preserved in the timeline."
- Note type, direction, linked account, subject, and content are pre-filled from the original note
- All pre-filled fields are editable

### AC3: Amendment Created
**Given** I edit the pre-filled content and click Submit
**When** the amendment is saved
**Then**:
- A new note is created with `amendsNote` pointing to the original note's ID
- The original note's `status` is set to `amended`
- Toast displays "Amendment created"
- Timeline scrolls to and highlights the new amendment

### AC4: Amended Note Card Visual
**Given** a note with status `amended` appears in the timeline
**When** I view the card
**Then**:
- An "AMENDED" badge in amber/orange appears next to the type label
- Content is visually de-emphasised (lighter text, reduced opacity)
- Footer shows "View current version" link instead of "Amend"

### AC5: Amendment Note Card Visual
**Given** a note with `amendsNote` set (it is an amendment)
**When** I view the card
**Then**:
- An "AMENDMENT" badge in blue appears next to the type label
- Content displays normally (full styling)
- Footer includes: "Amends note from [original date]" with "View original" link
- "Amend" action is available (for further corrections)

### AC6: Cross-Linking Navigation
**Given** I click "View current version" on an amended note
**When** the link is activated
**Then** the timeline scrolls to and briefly highlights the active amendment

**Given** I click "View original" on an amendment note
**When** the link is activated
**Then** the timeline scrolls to and briefly highlights the original amended note

### AC7: Timeline Position
**Given** an amendment is created at 3:45 PM for an original note at 2:15 PM
**When** the timeline renders
**Then** the amendment appears at its own creation timestamp (3:45 PM), not adjacent to the original

---

## Tasks / Subtasks

- [ ] **Task 1: Create Amend Mutation Hook** (AC: 3)
  - [ ] Create `src/hooks/mutations/useAmendNote.ts`
  - [ ] Creates new note with `amendsNote` reference
  - [ ] Updates original note's `status` to `amended`
  - [ ] Both operations in sequence (create amendment, then update original)
  - [ ] Invalidate `['contact-notes', customerId]` queries on success

- [ ] **Task 2: Update ContactNoteCard for States** (AC: 1, 4, 5)
  - [ ] Add `amended` visual state (amber badge, de-emphasised content, "View current version")
  - [ ] Add `amendment` visual state (blue badge, "Amends note from...", "View original")
  - [ ] Conditionally show/hide "Amend" action based on status

- [ ] **Task 3: Update AddNoteDrawer for Amendment Mode** (AC: 2)
  - [ ] Accept `amendingNote` prop for pre-fill
  - [ ] Show "Amend Note" title and info banner when in amendment mode
  - [ ] Pre-fill all fields including content from original note

- [ ] **Task 4: Cross-Link Scrolling** (AC: 6)
  - [ ] Implement scroll-to-note-and-highlight utility
  - [ ] "View current version" / "View original" triggers scroll + highlight
  - [ ] Reuse the green flash highlight pattern from new note creation

- [ ] **Task 5: Write Tests**
  - [ ] Unit tests for amended note card (badge, de-emphasis, no amend action)
  - [ ] Unit tests for amendment note card (badge, "Amends note from", view original link)
  - [ ] Unit test for amend mutation (creates amendment, updates original status)
  - [ ] Unit test for pre-fill in amendment mode

---

## References

- [UX Design](docs/ux-design/contact-notes-ux.md) - Section 5
- [Product Brief](_bmad-output/planning-artifacts/product-brief-billie-crm-2026-02-20.md) - Immutability model
