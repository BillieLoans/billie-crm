# Story 7.1: ContactNotes Payload Collection

**Epic**: Epic 7 - Customer Contact Notes
**Status**: done
**Started**: 2026-02-20
**Completed**: 2026-02-20

## Story

As a **developer**,
I want a ContactNotes Payload CMS collection with all required fields, indexes, and access control,
So that the data model is ready for the notes timeline and add-note UI components.

## Acceptance Criteria

### AC1: Collection Registered
**Given** the billie-crm codebase
**When** I run `pnpm dev`
**Then** a `contact-notes` collection is available in Payload with slug `contact-notes` in the "Servicing" admin group

### AC2: Core Fields
**Given** the `contact-notes` collection
**When** I inspect the schema
**Then** the following fields exist:
- `customer` (relationship → `customers`, required)
- `loanAccount` (relationship → `loan-accounts`, optional)
- `application` (relationship → `applications`, optional)
- `conversation` (relationship → `conversations`, optional)
- `noteType` (select, required) with options: `phone_inbound`, `phone_outbound`, `email_inbound`, `email_outbound`, `sms`, `general_enquiry`, `complaint`, `escalation`, `internal_note`, `account_update`, `collections`
- `contactDirection` (select, optional): `inbound`, `outbound`
- `subject` (text, required, maxLength: 200)
- `content` (richText / Lexical, required)
- `priority` (select, optional, default: `normal`): `low`, `normal`, `high`, `urgent`
- `sentiment` (select, optional, default: `neutral`): `positive`, `neutral`, `negative`, `escalation`
- `createdBy` (relationship → `users`, required, auto-populated from session)
- `amendsNote` (relationship → `contact-notes`, optional, self-referential)
- `status` (select, default: `active`): `active`, `amended`

### AC3: Indexes
**Given** the collection in MongoDB
**When** I check indexes
**Then** indexes exist on: `customer`, `loanAccount`, `createdAt`, `amendsNote`

### AC4: Access Control
**Given** the `contact-notes` collection
**When** access control is evaluated
**Then**:
- Read: Any authenticated user
- Create: `admin`, `supervisor`, `operations` roles
- Update: Only the `status` field can be updated (to `amended`), only by `admin`, `supervisor`, `operations`
- Delete: `admin` only

### AC5: Auto-Populate CreatedBy
**Given** a user creates a contact note via the API
**When** the note is saved
**Then** `createdBy` is automatically set to the authenticated user's ID via a `beforeChange` hook

### AC6: Import Map Regenerated
**Given** the collection is registered in `payload.config.ts`
**When** I run `pnpm run generate:importmap`
**Then** the import map regenerates without errors

---

## Tasks / Subtasks

- [x] **Task 1: Create Collection Definition** (AC: 1, 2)
  - [x] Create `src/collections/ContactNotes.ts` with all fields
  - [x] Register collection in `src/payload.config.ts`
  - [x] Run `pnpm run generate:importmap`

- [x] **Task 2: Add Indexes** (AC: 3)
  - [x] Add index configuration for `customer`, `loanAccount`, `amendsNote`
  - [x] Add explicit `createdAt` field override with `index: true` — Payload's `timestamps: true` does not auto-index `createdAt` in MongoDB; without this the timeline sort (Story 7.2) would cause a full collection scan at scale

- [x] **Task 3: Configure Access Control** (AC: 4)
  - [x] Implement read/create/update/delete access functions
  - [x] Restrict update to `status` field only (via `beforeChange` hook stripping all other fields)
  - [x] Enforce status transition: `status` may only be set to `amended` on update — throws if any other value is supplied, preventing re-activation of amended notes

- [x] **Task 4: Auto-Populate Hook** (AC: 5)
  - [x] Add `beforeChange` hook to set `createdBy` from `req.user`

- [x] **Task 5: Write Tests** (AC: 1-5)
  - [x] Added 50 tests to `tests/unit/collections.test.ts` (ContactNotes section)
  - [x] Tests: slug/config, all fields, 11 noteType options, access control matrix (4 roles × 4 operations), beforeChange hook (createdBy auto-pop, immutability on update, status transition validation), contactDirection conditional display, createdAt index

---

## Implementation Details

### New Collection: ContactNotes

Created Payload CMS collection for persisting customer contact notes:

**Fields:**
- `customer` — Relationship → `customers` (required, indexed)
- `loanAccount` — Relationship → `loan-accounts` (optional, indexed)
- `application` — Relationship → `applications` (optional)
- `conversation` — Relationship → `conversations` (optional)
- `noteType` — Select, 11 options: phone_inbound, phone_outbound, email_inbound, email_outbound, sms, general_enquiry, complaint, escalation, internal_note, account_update, collections (required)
- `contactDirection` — Select: inbound, outbound (conditional on phone/email note types)
- `subject` — Text, required, maxLength 200
- `content` — RichText (Lexical editor), required
- `priority` — Select: low, normal, high, urgent (default: normal)
- `sentiment` — Select: positive, neutral, negative, escalation (default: neutral)
- `createdBy` — Relationship → `users` (required, read-only in admin, auto-populated via hook)
- `amendsNote` — Relationship → `contact-notes` (self-referential, indexed, read-only in admin)
- `status` — Select: active, amended (default: active, indexed)
- `createdAt` — Date, indexed (explicit override of Payload timestamp to ensure MongoDB index exists for timeline sort)

**Access Control:**
- Read: Any authenticated user
- Create: admin, supervisor, operations
- Update: admin, supervisor, operations — restricted to `status` field only via `beforeChange` hook; status may only be set to `amended` (transition is enforced)
- Delete: admin only

**Hooks:**
- `beforeChange` (create): auto-populates `createdBy` from `req.user`
- `beforeChange` (update): strips all fields except `status`; throws if `status !== 'amended'`

---

## Files Changed

### New Files
- `src/collections/ContactNotes.ts` — Payload collection definition with fields, RBAC, and immutability hooks

### Modified Files
- `src/payload.config.ts` — Imported and registered `ContactNotes` collection
- `src/payload-types.ts` — Auto-regenerated TypeScript types (`ContactNote` interface, `ContactNotesSelect`)
- `src/app/(payload)/admin/importMap.js` — Auto-regenerated Payload import map
- `tests/unit/collections.test.ts` — Added 28+ ContactNotes tests (schema, RBAC matrix, hook behaviour)
- `docs/epics.md` — Added Epic 7 summary, updated overview table and dependency diagram

---

## References

- [Product Brief](_bmad-output/planning-artifacts/product-brief-billie-crm-2026-02-20.md) - Data model specification
- [UX Design](docs/ux-design/contact-notes-ux.md) - Component structure
- [Data Models](docs/data-models-billie-crm-web.md) - Existing collection patterns
