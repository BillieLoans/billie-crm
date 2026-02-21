# Story 7.4: Amendment Chain

Status: review

## Story

As a support staff member,  
I want to amend a contact note by creating a new version linked to the original,  
so that corrections are traceable without destroying the audit trail.

## Acceptance Criteria

1. "Amend" action is visible only for notes with `status: active` and hidden for `status: amended`.
2. Clicking "Amend" opens amendment-mode drawer with:
   - title "Amend Note"
   - immutable-audit warning banner
   - all editable fields prefilled from selected source note (type, direction, linked account, subject, content, optional metadata)
3. Submitting amendment:
   - creates a new note with `amendsNote` set to original note id
   - updates original note status to `amended`
   - shows toast "Amendment created"
   - scrolls timeline to new note and highlights it
4. Amended/original note card shows amber `AMENDED` badge, de-emphasized content, and "View current version" link.
5. Amendment/current note card shows blue `AMENDMENT` badge, "Amends note from [date]" context, and "View original" link.
6. Cross-links scroll to target card and apply temporary highlight.
7. Amendment appears by its own `createdAt` timestamp in normal newest-first ordering.

## Tasks / Subtasks

- [x] **Task 1: Add amend mutation hook** (AC: 3)
  - [x] Create `src/hooks/mutations/useAmendNote.ts`
  - [x] Implement two-step flow:
    1) create amendment (`POST /api/contact-notes`)
    2) mark original as amended (`PATCH /api/contact-notes/{id}` or equivalent Payload update endpoint)
  - [x] Ensure failure semantics:
    - if create fails: do not attempt status update
    - if create succeeds but status update fails: surface actionable error and keep context for retry path
  - [x] Invalidate `['contact-notes', customerId]` after success
  - [x] Export hook from `src/hooks/mutations/index.ts`

- [x] **Task 2: Wire panel/timeline amend flow** (AC: 1, 3, 6)
  - [x] In `src/components/ServicingView/ContactNotes/ContactNotesPanel.tsx`, add amendment state:
    - active source note (or id)
    - target note id for post-submit highlight
  - [x] Pass `onAmend` callback into `ContactNotesTimeline`
  - [x] Resolve note by id and open drawer in amendment mode
  - [x] Add reusable scroll-and-highlight helper for cross-link navigation

- [x] **Task 3: Extend AddNoteDrawer to amendment mode** (AC: 2, 3)
  - [x] Update `src/components/ServicingView/ContactNotes/AddNoteDrawer.tsx` props:
    - optional `amendingNote`
    - optional amendment submit handler (or internal branch to new hook)
  - [x] Render amendment UX:
    - title "Amend Note"
    - explanatory banner
  - [x] Prefill all editable fields from source note, including rich-text content
  - [x] Keep existing validation, keyboard behavior, and focus management
  - [x] Submit through amendment flow and return new note id for highlight

- [x] **Task 4: Update note-card variants and links** (AC: 1, 4, 5, 6)
  - [x] Update `src/components/ServicingView/ContactNotes/ContactNoteCard.tsx`
  - [x] Preserve current active card behavior; add explicit variant rendering for:
    - amended original (`status === 'amended'`)
    - amendment (`amendsNote` set)
  - [x] Replace actions by state:
    - amended original: hide "Amend", show "View current version"
    - amendment/current: show contextual "View original" metadata row; keep "Amend"
  - [x] Emit link callbacks up to timeline/panel for scroll navigation

- [x] **Task 5: Styling and motion compliance** (AC: 4, 5, 6)
  - [x] Update `src/components/ServicingView/ContactNotes/styles.module.css`:
    - amber and blue badge tokens
    - de-emphasis style for amended content
    - link affordance for cross-navigation
  - [x] Reuse existing `noteFlash` pattern for both creation and cross-link targets
  - [x] Respect `prefers-reduced-motion` for all highlight transitions

- [x] **Task 6: Tests** (AC: 1-7)
  - [x] Add/extend unit tests:
    - `tests/unit/hooks/useAmendNote.test.ts`
    - `tests/unit/ui/add-note-drawer.test.tsx` (amendment prefill + banner + submit)
    - `tests/unit/ui/contact-note-card.test.tsx` (stateful rendering/action gating)
    - `tests/unit/ui/contact-notes-panel.test.tsx` (amend open/submit wiring)
    - `tests/unit/ui/contact-notes-timeline.test.tsx` (cross-link callbacks/highlight)
  - [x] Verify query invalidation and toast behavior on success/failure paths

## Dev Notes

- Existing implementation already supports:
  - immutable model in `ContactNotes` collection (`status` can only transition to `amended`)
  - timeline rendering with `amendsNote` and `status` fields
  - new-note flash/highlight flow in panel/timeline
- Story 7.4 should extend these patterns, not replace them.
- Amendment flow must remain customer-scoped and local Payload-backed (not ledger/gRPC path).

### Technical Requirements

- Use TanStack Query mutation pattern with explicit cache invalidation after success.
- Keep query key convention `['contact-notes', customerId, ...]`.
- Keep all interactive components as client components with named exports.
- Keep date formatting in `en-AU` locale (`toLocaleString('en-AU', ...)`).
- Preserve subject max length and required-field validation from existing drawer schema.
- Do not add a new collection; use existing `contact-notes` schema and fields.

### Architecture Compliance

- Respect CQRS split: this story is a local CMS projection concern and should not call ledger APIs.
- Keep feature boundaries:
  - UI state/orchestration in panel/timeline components
  - API write logic in mutation hook
  - collection immutability enforced in backend schema hooks
- Continue payload-admin custom-view patterns already established in ServicingView.

### Library / Framework Requirements

- `@tanstack/react-query` v5: use `useMutation` and `queryClient.invalidateQueries`.
- `react-hook-form` + `zod` + `@hookform/resolvers`: reuse existing form-validation stack.
- Payload CMS 3.45.x relationship semantics:
  - use existing `amendsNote` self-relationship
  - keep indexed query patterns (`customer`, `loanAccount`, `createdAt`, `amendsNote`).
- `sonner`: use concise success/error toasts aligned with existing note flows.

### File Structure Requirements

- Create:
  - `src/hooks/mutations/useAmendNote.ts`
  - `tests/unit/hooks/useAmendNote.test.ts`
- Modify:
  - `src/hooks/mutations/index.ts`
  - `src/components/ServicingView/ContactNotes/AddNoteDrawer.tsx`
  - `src/components/ServicingView/ContactNotes/ContactNoteCard.tsx`
  - `src/components/ServicingView/ContactNotes/ContactNotesPanel.tsx`
  - `src/components/ServicingView/ContactNotes/ContactNotesTimeline.tsx`
  - `src/components/ServicingView/ContactNotes/styles.module.css`
  - `tests/unit/ui/add-note-drawer.test.tsx`
  - `tests/unit/ui/contact-note-card.test.tsx`
  - `tests/unit/ui/contact-notes-panel.test.tsx`
  - `tests/unit/ui/contact-notes-timeline.test.tsx`

### Testing Requirements

- Unit-test mutation sequencing:
  - create amendment request payload contains `amendsNote`
  - original status update issued with `status: amended`
  - error handling for partial failure path
- Unit-test UI state gating:
  - amended original has no "Amend" action
  - amendment/current retains "Amend" and includes backward link
- Unit-test drawer prefill:
  - note type, direction, account, subject, and content hydrate correctly in amendment mode
- Unit-test timeline navigation:
  - cross-link click propagates target id
  - target card receives highlight class/flash behavior

### Previous Story Intelligence

- Story 7.3 moved drawer ownership into `ContactNotesPanel`; keep this ownership model.
- Existing new-note highlight uses `newlyAddedNoteId` + `noteFlash` CSS with timed clear.
- Form submit shortcuts and focus behavior are already test-covered; amendment mode must not regress these.
- Current content pipeline is Tiptap JSON in create flow and tolerant rendering in cards; amendment prefill should retain rich-content fidelity.

### Git Intelligence Summary

- Recent repository commits are mostly unrelated infra/security work; no conflicting UI pattern change to contact notes surfaced.
- Current workspace changes already show Epic 7 files staged/modified, so align with existing naming and module layout instead of introducing alternate structures.

### Latest Technical Information

- TanStack Query v5 guidance confirms `onSuccess` invalidation and async invalidation (`await invalidateQueries`) for deterministic post-mutation freshness.
- Payload docs for relationship fields reinforce existing approach: indexed relationship fields and validation/access controls are appropriate for amendment chaining.
- No mandatory library migration is required for this story; follow current pinned project versions in `docs/project_context.md`.

### Project Context Reference

- [Source: `docs/sprint-artifacts/7-4-amendment-chain.md`]
- [Source: `docs/sprint-artifacts/7-3-add-note-drawer.md`]
- [Source: `docs/sprint-artifacts/7-2-notes-timeline-panel.md`]
- [Source: `docs/sprint-artifacts/7-1-contact-notes-collection.md`]
- [Source: `docs/ux-design/contact-notes-ux.md`]
- [Source: `docs/epics.md`]
- [Source: `docs/project_context.md`]
- [Source: `docs/architecture.md`]
- [Source: `_bmad-output/planning-artifacts/product-brief-billie-crm-2026-02-20.md`]

## Dev Agent Record

### Agent Model Used

gpt-5.3-codex

### Debug Log References

- create-story workflow execution (automated / yolo-style for zero-intervention path)
- dev-story implementation execution for Story 7.4

### Completion Notes List

- Implemented `useAmendNote` with two-step create+status-update mutation and partial-failure retry context.
- Wired panel/timeline/card cross-link flow with scroll-and-highlight navigation and amendment-mode drawer launch.
- Extended `AddNoteDrawer` for amendment mode (title/banner, rich prefill, mutation branching).
- Added/updated unit tests for mutation sequencing, amendment UI state gating, drawer prefill, and cross-link highlight behavior.
- Full unit regression run passed: 1204/1204 tests.

### File List

- `_bmad-output/implementation-artifacts/7-4-amendment-chain.md`
- `src/hooks/mutations/useAmendNote.ts`
- `src/hooks/mutations/index.ts`
- `src/components/ServicingView/ContactNotes/AddNoteDrawer.tsx`
- `src/components/ServicingView/ContactNotes/ContactNoteCard.tsx`
- `src/components/ServicingView/ContactNotes/ContactNotesPanel.tsx`
- `src/components/ServicingView/ContactNotes/ContactNotesTimeline.tsx`
- `src/components/ServicingView/ContactNotes/styles.module.css`
- `tests/unit/hooks/useAmendNote.test.ts`
- `tests/unit/ui/add-note-drawer.test.tsx`
- `tests/unit/ui/contact-note-card.test.tsx`
- `tests/unit/ui/contact-notes-panel.test.tsx`
- `tests/unit/ui/contact-notes-timeline.test.tsx`

## Change Log

- 2026-02-21: Implemented Story 7.4 amendment chain (mutation flow, amendment-mode drawer, note cross-links/highlights, and test coverage).
