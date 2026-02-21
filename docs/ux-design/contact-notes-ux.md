# UX Design: Customer Contact Notes

**Author:** Rohan (Product Owner) + Mary (Business Analyst)
**Date:** 20 Feb 2026
**Status:** Draft
**Product Brief:** `_bmad-output/planning-artifacts/product-brief-billie-crm-2026-02-20.md`

---

## 1. Executive Summary

This document defines the UX design for the Customer Contact Notes feature within the existing ServicingView. The design adds a Notes Timeline section and Add Note drawer that integrate seamlessly with the existing AccountPanel, Customer Profile, and drawer-based action patterns.

### Design Principles (Feature-Specific)

- **Customer-level, not account-level:** Notes belong to the customer. Account linking is optional context, not a structural requirement.
- **Scan-first:** The timeline is designed for rapid scanning - Sarah needs to absorb prior interaction context in seconds, not minutes.
- **Immutable by design:** The UI reinforces the append-only philosophy. No edit buttons. Amendments are explicit, visible, and traceable.
- **Minimal friction for creation:** The form is lean. Optional fields are hidden behind an expander. Context is pre-filled from the current view state.

---

## 2. Placement in ServicingView

### Layout Decision

The Notes Timeline lives in the **right column, below the AccountPanel**. It is a customer-level section, independent of which account tab is active.

```
┌──────────────┬──────────────────────────────────────────────┐
│  LEFT COLUMN │  RIGHT COLUMN                                │
│              │                                              │
│  Customer    │  ┌──────────────────────────────────────────┐│
│  Profile     │  │ AccountPanel (existing)                  ││
│              │  │ Overview │ Transactions │ Fees │ Actions  ││
│              │  │ [account-specific content]               ││
│              │  └──────────────────────────────────────────┘│
│              │                                              │
│              │  ┌──────────────────────────────────────────┐│
│              │  │ 📝 Contact Notes (12)      [+ Add Note] ││
│              │  │ Filter: [All Types ▾] [All Accounts ▾]  ││
│              │  │                                          ││
│              │  │ [Notes Timeline]                         ││
│              │  │                                          ││
│              │  │ [Load more...]                           ││
│              │  └──────────────────────────────────────────┘│
└──────────────┴──────────────────────────────────────────────┘
```

### Rationale

- Notes are **customer-scoped**, not account-scoped. They cannot live as a tab inside the account-level AccountPanel without breaking the information hierarchy.
- Placing them below the AccountPanel keeps them visible alongside account data.
- The left column (Customer Profile) stays clean and focused on identity.

---

## 3. Notes Timeline Component

### Section Header

```
┌──────────────────────────────────────────────────────────────┐
│ 📝 Contact Notes (12)                         [+ Add Note]  │
│ ─────────────────────────────────────────────────────────── │
│ Filter: [All Types ▾]  [All Accounts ▾]                     │
└──────────────────────────────────────────────────────────────┘
```

- **Note count** in header, updates live on create/amend
- **"+ Add Note"** button uses primary action style, always visible
- **Type filter dropdown:** All Types | Inbound Call | Outbound Call | Email Received | Email Sent | SMS | General Enquiry | Complaint | Escalation | Internal Note | Account Update | Collections Activity
- **Account filter dropdown:** All Accounts | ACC-001 (Active) | ACC-002 (Closed) | General (no account)
  - "General (no account)" shows notes with no linked account
  - Dropdown only appears when customer has 2+ accounts

### Default State

- Timeline opens **expanded with the 5 most recent notes visible**
- Newest-first ordering
- "Load more" button at the bottom to fetch the next page (server-side pagination)

### Individual Note Card

```
┌──────────────────────────────────────────────────────────────┐
│ 📞 Inbound Call                     20 Feb 2026 · 2:15 PM   │
│ 🔴 High Priority · 😟 Negative                              │
│ ─────────────────────────────────────────────────────────── │
│ Disputed late fee - courtesy waiver                          │
│                                                              │
│ Customer called regarding late fee of $30 applied on         │
│ 18 Feb. Explained the payment was received same day but      │
│ after the cut-off. Offered one-time courtesy waiver...       │
│ [Show more]                                                  │
│ ─────────────────────────────────────────────────────────── │
│ 🔗 ACC-0WOMN8ST · By Sarah Chen                  [Amend ↗] │
└──────────────────────────────────────────────────────────────┘
```

**Card Layout Rules:**

| Element | Position | Behaviour |
|:---|:---|:---|
| Type icon + label | Top-left | Always visible. Icon maps to note type. |
| Timestamp | Top-right | `en-AU` locale formatting |
| Priority + Sentiment | Below type, second row | **Only shown when non-default** (i.e., not normal/neutral). Hidden otherwise to reduce noise. |
| Subject | Bold, always visible | First line of content area |
| Body | Below subject | Truncated to ~3 lines. "Show more" expands inline. Rich text rendered. |
| Linked account | Footer left | Shows account ID if linked. Omitted if no account. |
| Author | Footer centre | "By {firstName} {lastName}" |
| Amend action | Footer right | Opens Add Note drawer in amendment mode |

### Note Type Icons

| Type | Icon | Label |
|:---|:---|:---|
| `phone_inbound` | 📞 | Inbound Call |
| `phone_outbound` | 📱 | Outbound Call |
| `email_inbound` | 📨 | Email Received |
| `email_outbound` | 📧 | Email Sent |
| `sms` | 💬 | SMS |
| `general_enquiry` | ❓ | General Enquiry |
| `complaint` | ⚠️ | Complaint |
| `escalation` | 🔺 | Escalation |
| `internal_note` | 📋 | Internal Note |
| `account_update` | 🔄 | Account Update |
| `collections` | 📊 | Collections Activity |

### Account-Linked Note Highlighting

When an account is selected in the AccountPanel:
- Notes linked to that account get a subtle **left border highlight** (primary blue, 3px)
- Notes linked to other accounts or no account remain unstyled
- This provides visual anchoring without hiding potentially relevant customer-level notes
- The "All Accounts" filter dropdown allows explicit narrowing if desired

### Empty State

When no notes exist for a customer:

```
┌──────────────────────────────────────────────────────────────┐
│ 📝 Contact Notes (0)                          [+ Add Note]  │
│ ─────────────────────────────────────────────────────────── │
│                                                              │
│          No contact notes yet for this customer.             │
│     Add a note to start building interaction history.        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Add Note Drawer

### Layout

Slide-over drawer from the right side, consistent with existing `WaiveFeeDrawer` and `RecordRepaymentDrawer` patterns.

```
                              ┌────────────────────────────────┐
                              │ ✕                    Add Note  │
                              │ ════════════════════════════════│
                              │                                │
                              │ Customer: John Smith (CUS-123) │
                              │ (read-only, pre-filled)        │
                              │                                │
                              │ Note Type *                    │
                              │ ┌────────────────────────────┐ │
                              │ │ Inbound Call            ▾  │ │
                              │ └────────────────────────────┘ │
                              │                                │
                              │ Direction                      │
                              │ ┌────────────────────────────┐ │
                              │ │ Inbound                 ▾  │ │
                              │ └────────────────────────────┘ │
                              │                                │
                              │ Linked Account                 │
                              │ ┌────────────────────────────┐ │
                              │ │ ACC-0WOMN8ST (Active)   ▾  │ │
                              │ └────────────────────────────┘ │
                              │                                │
                              │ Subject *                      │
                              │ ┌────────────────────────────┐ │
                              │ │                            │ │
                              │ └────────────────────────────┘ │
                              │                                │
                              │ Content *                      │
                              │ ┌────────────────────────────┐ │
                              │ │ B I U  ≡  •  🔗            │ │
                              │ │ ──────────────────────────│ │
                              │ │                            │ │
                              │ │                            │ │
                              │ │                            │ │
                              │ └────────────────────────────┘ │
                              │                                │
                              │ ┌─────────────┐ ┌───────────┐ │
                              │ │ ▾ More      │ │  Submit   │ │
                              │ └─────────────┘ └───────────┘ │
                              └────────────────────────────────┘
```

### Field Behaviour

| Field | Required | Pre-fill Logic | Notes |
|:---|:---|:---|:---|
| Customer | Yes (read-only) | Current customer from ServicingView | Cannot be changed |
| Note Type | Yes | Empty (first selection) | Determines whether Direction field appears |
| Direction | Conditional | Auto-set based on type | Only shown for phone/email types. Hidden for internal_note, general_enquiry, etc. |
| Linked Account | No | Pre-fills with currently selected account in AccountPanel. Empty if no account selected. | Dropdown of customer's accounts + empty option |
| Subject | Yes | Empty | Max 200 characters |
| Content | Yes | Empty | Lexical rich text editor. Toolbar: bold, italic, underline, lists, links |
| Priority | No | Defaults to `normal` | Hidden behind "More" expander |
| Sentiment | No | Defaults to `neutral` | Hidden behind "More" expander |

### Direction Auto-Show Rules

| Note Type | Direction Field |
|:---|:---|
| `phone_inbound` | Shown, pre-set to "Inbound" |
| `phone_outbound` | Shown, pre-set to "Outbound" |
| `email_inbound` | Shown, pre-set to "Inbound" |
| `email_outbound` | Shown, pre-set to "Outbound" |
| `sms` | Shown, empty (could be either) |
| All others | Hidden |

### "More" Expander

The Priority and Sentiment fields are hidden behind a collapsible "More" section at the bottom of the form. This keeps the default form lean (5 visible fields) while allowing staff to optionally categorise when relevant.

```
┌─────────────────────────────────────────────┐
│ ▾ More                                      │
│ ┌─────────────────────────────────────────┐ │
│ │ Priority     [Normal ▾]                 │ │
│ │ Sentiment    [Neutral ▾]                │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Submit Behaviour

1. Validate required fields (type, subject, content)
2. Submit via Payload API (local collection, not gRPC)
3. Close the drawer
4. Show success toast: "Note added"
5. Scroll the notes timeline to the top and highlight the new note with a brief green flash (2s fade)

### Validation

| Rule | Message |
|:---|:---|
| Note Type empty | "Please select a note type" |
| Subject empty | "Please enter a subject" |
| Subject > 200 chars | "Subject must be 200 characters or less" |
| Content empty | "Please enter note content" |

---

## 5. Amendment Chain UI

### Immutability Model

Notes are immutable after creation. To correct a note, staff create an **amendment** - a new note linked to the original via `amendsNote`. The original's status changes to `amended` (the only permitted mutation).

### Amended Note Card (Superseded Original)

```
┌──────────────────────────────────────────────────────────────┐
│ 📞 Inbound Call · AMENDED           20 Feb 2026 · 2:15 PM   │
│ ─────────────────────────────────────────────────────────── │
│ Disputed late fee - courtesy waiver                          │
│                                                              │
│ [Content greyed out, truncated to 2 lines]                   │
│ ─────────────────────────────────────────────────────────── │
│ 🔗 ACC-0WOMN8ST · By Sarah Chen    [View current version ↗] │
└──────────────────────────────────────────────────────────────┘
```

- **"AMENDED" badge** in amber/orange next to type label
- Content visually de-emphasised (lighter text colour, reduced opacity)
- **"View current version"** link scrolls to and highlights the active amendment
- Card remains in timeline at its original timestamp position (audit trail integrity)
- "Amend" action removed (can only amend the active version)

### Active Amendment Card (Current Version)

```
┌──────────────────────────────────────────────────────────────┐
│ 📞 Inbound Call · AMENDMENT         20 Feb 2026 · 3:45 PM   │
│ ─────────────────────────────────────────────────────────── │
│ Disputed late fee - courtesy waiver (corrected)              │
│                                                              │
│ [Full content, normal styling]                               │
│ ─────────────────────────────────────────────────────────── │
│ 🔗 ACC-0WOMN8ST · By Sarah Chen                  [Amend ↗] │
│ ℹ️ Amends note from 20 Feb 2:15 PM  [View original]         │
└──────────────────────────────────────────────────────────────┘
```

- **"AMENDMENT" badge** in blue to distinguish from fresh notes
- Content displayed normally (this is the current truth)
- Footer includes **"Amends note from [date]"** with link to original
- "Amend" action available (further corrections create a chain)

### Amendment Timeline Position

Amendments appear at their **own creation timestamp**, not adjacent to the original. If other notes were created between the original and the amendment, they appear in chronological order. The cross-links ("View current version" / "View original") provide navigation between related notes.

### Amend Action Flow

When staff clicks "Amend" on a note:

1. The Add Note drawer opens with title "Amend Note"
2. A banner appears at top: *"You are creating an amendment. The original note will be preserved in the timeline."*
3. Fields pre-filled from original: note type, direction, linked account, subject, **and content**
4. Staff edits the content (or subject, or any field) as needed
5. On submit:
   - New note created with `amendsNote` pointing to original
   - Original note's status set to `amended`
   - Toast: "Amendment created"
   - Timeline scrolls to and highlights the new amendment

---

## 6. Smart Context Behaviour

### Account Selection Interaction

| AccountPanel State | Notes Timeline | "+ Add Note" Pre-fill |
|:---|:---|:---|
| No account selected | All customer notes shown | Customer only, account dropdown empty |
| Account selected | All notes shown. Notes linked to selected account have **blue left border highlight** (3px) | Customer + selected account pre-filled |
| Account filter active | Only notes matching filter shown | Customer + filtered account pre-filled |

### Account Filter Dropdown Options

For a customer with accounts ACC-001 and ACC-002:

```
┌─────────────────────────────┐
│ All Accounts                │  ← Default
│ ACC-001 (Active)            │
│ ACC-002 (Closed)            │
│ General (no account)        │  ← Notes with no linked account
└─────────────────────────────┘
```

- **"General (no account)"** shows only notes with no linked account (general enquiries, service complaints, etc.)
- Dropdown only rendered when customer has 2+ accounts (single-account customers don't need it)

### Read-Only Mode

Contact Notes are **not affected by Read-Only Mode**. The notes feature uses the local Payload CMS collection, not the gRPC ledger. When the ledger is offline:

- ✅ "+ Add Note" remains enabled
- ✅ "Amend" action remains enabled
- ✅ Notes timeline continues to load and display
- ❌ Financial action buttons (Waive Fee, Record Payment) are disabled as per existing behaviour

---

## 7. Keyboard Shortcuts

### New Shortcuts (Contact Notes)

| Shortcut | Action | Scope |
|:---|:---|:---|
| `N` | Open Add Note drawer | When no drawer/modal is open, not typing in an input |
| `Escape` | Close Add Note drawer | When Add Note drawer is open |
| `Cmd+Enter` | Submit note | When inside Add Note drawer form |

### Existing Shortcuts (Preserved)

| Shortcut | Action |
|:---|:---|
| `1` - `4` | Switch AccountPanel tabs |
| `↑` `↓` | Navigate between accounts |
| `Escape` | Close AccountPanel (when no drawer open) |
| `Cmd+K` | Open Command Palette |

**Shortcut Priority:** `N` key is disabled when user is typing in an input, textarea, or select field (same suppression logic as existing shortcuts).

---

## 8. Component Structure

```
src/components/ServicingView/ContactNotes/
├── ContactNotesPanel.tsx        # Main section container with header, filters, timeline
├── ContactNotesTimeline.tsx     # Scrollable list of note cards with pagination
├── ContactNoteCard.tsx          # Individual note card (handles active, amended, amendment states)
├── ContactNoteFilters.tsx       # Type + Account filter dropdowns
├── AddNoteDrawer.tsx            # Slide-over form for creating notes and amendments
├── useContactNotesHotkeys.ts   # Keyboard shortcut hook (N, Escape, Cmd+Enter)
├── styles.module.css            # Component-scoped styles
└── index.ts                     # Barrel exports

src/hooks/queries/
└── useContactNotes.ts           # TanStack Query hook for fetching notes by customer

src/hooks/mutations/
├── useCreateNote.ts             # Create note mutation
└── useAmendNote.ts              # Amend note mutation (create amendment + update original status)
```

### Integration with ServicingView

```typescript
// ServicingView.tsx - Add below AccountPanel
<AccountPanel ... />

<ContactNotesPanel
  customerId={customerId}
  selectedAccountId={selectedAccountId}
/>
```

---

## 9. Accessibility

| Concern | Implementation |
|:---|:---|
| **Keyboard navigation** | Full keyboard access: `N` to create, `Escape` to close, `Cmd+Enter` to submit. Tab order through form fields. |
| **Screen reader** | `aria-live="polite"` on notes timeline for new note announcements. Note cards use semantic HTML (`article` element). |
| **Focus management** | Opening drawer focuses first field (Note Type). Closing drawer returns focus to "+ Add Note" button. |
| **Reduced motion** | New-note highlight flash respects `prefers-reduced-motion` (instant highlight, no animation). |
| **Colour independence** | Amendment badges use text labels ("AMENDED", "AMENDMENT") in addition to colour. Priority/sentiment use text, not colour alone. |

---

## 10. Files to Create

| File | Purpose |
|:---|:---|
| `src/collections/ContactNotes.ts` | Payload CMS collection definition |
| `src/components/ServicingView/ContactNotes/ContactNotesPanel.tsx` | Main panel container |
| `src/components/ServicingView/ContactNotes/ContactNotesTimeline.tsx` | Timeline list with pagination |
| `src/components/ServicingView/ContactNotes/ContactNoteCard.tsx` | Individual note card |
| `src/components/ServicingView/ContactNotes/ContactNoteFilters.tsx` | Filter dropdowns |
| `src/components/ServicingView/ContactNotes/AddNoteDrawer.tsx` | Add/Amend note drawer |
| `src/components/ServicingView/ContactNotes/useContactNotesHotkeys.ts` | Keyboard shortcuts |
| `src/components/ServicingView/ContactNotes/styles.module.css` | Scoped styles |
| `src/components/ServicingView/ContactNotes/index.ts` | Barrel exports |
| `src/hooks/queries/useContactNotes.ts` | Fetch notes query hook |
| `src/hooks/mutations/useCreateNote.ts` | Create note mutation |
| `src/hooks/mutations/useAmendNote.ts` | Amend note mutation |

### Files to Modify

| File | Change |
|:---|:---|
| `src/components/ServicingView/ServicingView.tsx` | Add `ContactNotesPanel` below `AccountPanel` |
| `src/payload.config.ts` | Register `ContactNotes` collection |

---

*This design extends the ServicingView with customer interaction history while preserving existing UX patterns. Sarah can now document every call, and the next agent arrives informed.*
