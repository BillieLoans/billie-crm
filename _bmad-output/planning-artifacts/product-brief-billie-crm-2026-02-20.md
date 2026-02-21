---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
status: complete
completedAt: '2026-02-20'
inputDocuments:
  - docs/analysis/brainstorming-session-2025-12-11.md
  - docs/architecture.md
  - docs/ux-design-specification.md
  - docs/epics.md
  - docs/prd.md
  - docs/data-models-billie-crm-web.md
  - docs/project_context.md
date: 2026-02-20
author: Rohan
---

# Product Brief: Customer Contact Notes

<!-- Content will be appended sequentially through collaborative workflow steps -->

## Executive Summary

**Customer Contact Notes** is a new capability for Billie CRM that introduces a compliance-grade interaction record system, enabling support staff to document every customer touchpoint - calls, emails, complaints, and internal notes - directly within the Single Customer View. Today, when a customer calls back and reaches a different agent, all context from prior interactions is lost. Staff have no mechanism to record notes, and there is no record of how complaints were handled. This feature closes that gap by providing an immutable, versioned contact log linked to customers and their accounts, transforming Billie CRM from a financial servicing tool into a complete customer relationship platform.

The system follows the project's event-sourcing philosophy: notes are append-only with amendments creating new versioned entries rather than overwriting originals. This ensures a tamper-proof record suitable for demonstrating proper complaint handling. A post-action prompt mechanism will encourage consistent note-taking by nudging staff to document context after performing financial actions like fee waivers or repayments.

---

## Core Vision

### Problem Statement

Support staff at Billie have **zero continuity between customer interactions**. When a customer calls, any context from prior conversations - what was discussed, what was promised, why a decision was made - exists only in the memory of the agent who handled it. If a different agent picks up the next call, the customer must re-explain their entire situation from scratch.

This is not a "bad tool" problem - it is a **"no tool" problem**. Staff currently have no mechanism to record interaction notes against customer records. The context simply vanishes when the call ends.

### Problem Impact

- **Customer Experience Degradation:** Every repeat call starts cold. Customers feel unheard and frustrated when they have to repeat themselves, eroding trust in the brand.
- **Complaint Handling Exposure:** Without documented records of how complaints were received, investigated, and resolved, the business cannot demonstrate proper handling if a complaint is escalated. This is a reputational and operational risk.
- **Accountability Gap:** There is no way to verify what was communicated to a customer, what was promised, or what follow-up was agreed. He-said-she-said situations have no resolution mechanism.
- **Operational Inefficiency:** Staff spend time re-discovering context that a previous agent already established, directly increasing Average Handle Time (AHT).

### Why Existing Solutions Fall Short

The current Billie CRM captures **system-generated audit trails** exceptionally well - every fee waiver, repayment, and approval decision is logged immutably through the event-sourcing architecture. However, these audit logs record *what the system did*, not *why the human did it* or *what was discussed with the customer*.

Existing note-like fields in the system (e.g., `notes` on write-off requests, `noticeboard` on applications) are narrowly scoped to specific entities and workflows. There is no unified, customer-centric contact record that spans across all interactions and account contexts.

### Proposed Solution

A **ContactNotes** collection within Payload CMS that provides:

1. **Immutable Interaction Records:** Every note is append-only. Corrections create new versioned entries linked to the original, maintaining a tamper-proof audit trail consistent with the project's event-sourcing philosophy.
2. **Flexible Entity Linking:** Notes belong to a customer (required) and can optionally be linked to a specific loan account, application, or conversation for precise context.
3. **Structured Categorisation:** Note types (inbound call, outbound call, email, complaint, escalation, internal note, etc.) with direction, priority, and sentiment fields enable consistent recording and future trend analysis.
4. **Follow-up Tracking:** Built-in follow-up date, assignee, and completion tracking ensures promises made to customers are not forgotten.
5. **Post-Action Prompts:** After financial actions (fee waivers, repayments), the system prompts the agent to document the interaction context, driving consistent adoption without mandating it.
6. **Rich Text Content:** Lexical-based rich text editor for note bodies, supporting formatted content for detailed interaction records.

### Key Differentiators

- **Immutable by Design:** Unlike typical CRM note fields that allow edits (destroying the audit trail), ContactNotes follows the same append-only philosophy as the financial ledger. The original record always exists.
- **Integrated, Not Bolted On:** Notes live inside the Single Customer View, linked to the same entities staff are already working with. There's no context switch to a separate "notes system."
- **Prompted, Not Forgotten:** Post-action prompts create a natural workflow nudge that drives adoption without enforcement. Staff are reminded at the moment context is freshest.
- **Complaint-Ready Records:** The combination of immutability, structured types (complaint, escalation), and timestamped authorship provides the documentation needed to demonstrate proper complaint handling.

---

## Target Users

### Primary Users

**Sarah Chen - Senior Support Specialist**

Sarah is the front-line voice of Billie. She handles 30-40 customer calls per day, ranging from balance enquiries to fee disputes to payment arrangements. She is the primary *creator* of contact notes.

**Day-to-Day with Contact Notes:**
- After handling a customer call, Sarah documents what was discussed, what actions were taken, and any promises made. She's typically writing the note after the call ends, not during.
- When a customer calls in, the first thing she checks is the notes timeline on the Single Customer View - scanning for prior interactions, complaints, or follow-ups so she arrives informed rather than cold.
- After performing a financial action (fee waiver, repayment), the system prompts her to add a note. She selects the note type (e.g., "Inbound Call"), types a subject and body, optionally links it to the account she was working on, and submits. The whole process takes under two minutes.
- When a call involves a complaint, she selects "Complaint" as the note type and includes details of what was raised and how it was addressed. No special workflow triggers - just a categorised record.

**Success Moment:** A customer calls back about a previous dispute. Sarah opens their profile, sees the note from the last agent - "Customer disputed late fee, explained grace period, waived as courtesy, customer satisfied" - and picks up the conversation seamlessly. The customer says "oh good, you already know about it."

**What makes her love it:** Speed and simplicity. The note form doesn't fight her. It pre-fills the customer and account context. She doesn't have to hunt for fields or navigate away from what she's doing.

### Secondary Users

**Michael Torres - Service Team Lead (Supervisor)**

Michael oversees a team of support agents. He creates notes occasionally (escalation outcomes, management decisions) but primarily *reads* notes created by his team. He reviews notes when handling escalated calls, investigating complaint patterns, or following up on assigned tasks.

**Day-to-Day with Contact Notes:**
- When an escalated customer lands on his desk, he reads the notes timeline to understand the full history before engaging.
- He checks his dashboard for follow-ups assigned to him by his team.
- After resolving an escalation, he creates a note documenting the outcome and resolution.

**Success Moment:** He can trace the complete arc of a complaint - from initial call to escalation to resolution - through the notes timeline without asking his team for context.

---

**Pri Anand - Compliance & Risk Officer**

Pri doesn't create notes. She *audits* them. During review periods, she needs to pull up customer records and verify that complaints were properly documented, actioned, and resolved. She's looking for completeness, not creating content.

**Day-to-Day with Contact Notes:**
- During complaint reviews, she opens a customer's profile and reads through the notes timeline filtered by "Complaint" and "Escalation" types.
- She verifies that interactions have proper categorisation, timestamps, and authorship.
- She checks that follow-ups were completed and documented.

**Success Moment:** An escalated complaint reaches her desk. She can produce a clear, timestamped, tamper-proof record showing: when the complaint was received, who handled it, what actions were taken, and how it was resolved. No ambiguity.

### User Journey

**The "Informed Agent" Flow (Sarah - Core Usage Loop)**

```
Customer calls in
    → Sarah opens Single Customer View
    → Scans Notes Timeline for prior interactions
    → Handles the call with full context
    → Performs financial action (e.g., waive fee)
    → System prompts: "Add a note about this interaction?"
    → Sarah selects type, writes subject + body, submits
    → Note appears in timeline, linked to customer + account
    → Next agent who opens this customer sees the note
```

**The "Escalation Trail" Flow (Michael - Review Loop)**

```
Escalated complaint received
    → Michael opens customer profile
    → Reads notes timeline (filtered: Complaints)
    → Understands full history without asking team
    → Resolves escalation
    → Creates note documenting resolution + outcome
    → Marks any open follow-ups as completed
```

**The "Audit Proof" Flow (Pri - Compliance Loop)**

```
Complaint audit period
    → Pri opens customer record
    → Filters notes by type: Complaint, Escalation
    → Verifies: documented receipt, investigation, resolution
    → Confirms immutability (amendment chain, not edits)
    → Records audit finding: "Complaint properly handled"
```

---

## Success Metrics

### User Success

| Metric | Target | Measurement | Timeframe |
|:---|:---|:---|:---|
| **Notes per agent per day** | 30+ (matching call volume) | Count of notes created per user per day | From launch |
| **Post-action prompt conversion** | > 70% | % of financial actions (waive, repay) followed by a note within 5 minutes | From launch |
| **History check rate** | > 80% of returning customer interactions | % of ServicingView loads where the notes timeline is scrolled/expanded before an action is taken | Week 4+ |
| **Note quality** | > 90% with type + subject + body completed | % of notes with all required fields populated (not just a blank subject) | From launch |

### Business Objectives

| Objective | Target | How We'll Know |
|:---|:---|:---|
| **Complaint documentation coverage** | 100% aspiration, > 95% measured | Every interaction categorised as "Complaint" or "Escalation" has a corresponding contact note with subject, body, and resolution | From launch |
| **Follow-up accountability** | > 90% completion rate | Follow-ups marked as required are completed and documented within the assigned timeframe | Week 2+ |
| **Interaction continuity** | Qualitative improvement | Staff report (informal survey at Week 4) that they can pick up customer context from prior notes without asking the customer to repeat | Week 4 |
| **Complaint audit readiness** | Pass first internal review | When compliance pulls a complaint record, the notes timeline provides a complete, timestamped trail from receipt to resolution | First audit cycle |

### Key Performance Indicators

**Leading Indicators (predict success):**

| KPI | Signal | Red Flag |
|:---|:---|:---|
| **Daily active note creators** | > 90% of support staff create at least 1 note per shift | Staff not using the feature at all |
| **Prompt dismissal rate** | < 30% of post-action prompts dismissed without creating a note | > 50% dismissal = UX friction or lack of perceived value |
| **Average time to create note** | < 2 minutes | > 3 minutes = form too complex, needs simplification |
| **Amendment rate** | < 5% of notes receive amendments | > 10% = original notes are consistently incomplete or inaccurate |

**Lagging Indicators (confirm value):**

| KPI | Signal | Measurement |
|:---|:---|:---|
| **Repeat-call context availability** | Staff can find prior interaction context for returning customers | Spot-check: sample 20 returning customer interactions per week, verify notes exist from prior contact |
| **Complaint handling documentation** | Complete audit trail exists for 100% of escalated complaints | Compliance review of all escalated complaints |
| **Follow-up drop rate** | < 5% of assigned follow-ups are never completed | Count of overdue follow-ups with no completion or re-assignment |

**Evaluation Cadence:**
- **Week 1:** Monitor adoption (are people using it?) and prompt conversion (is the nudge working?)
- **Week 2:** Review note quality (are they useful?) and follow-up creation patterns
- **Week 4:** First informal team survey on continuity improvement + spot-check of returning customer interactions
- **Ongoing:** Monthly compliance review of complaint documentation coverage

---

## MVP Scope

### Core Features

**1. ContactNotes Payload Collection**
- New `contact-notes` collection with full field schema: customer (required), loanAccount (optional), application (optional), conversation (optional), noteType, subject, content (rich text / Lexical), contactDirection, priority, sentiment, createdBy (auto), amendsNote (self-referential), status (active/amended)
- All note types: phone_inbound, phone_outbound, email_inbound, email_outbound, sms, general_enquiry, complaint, escalation, internal_note, account_update, collections
- Indexes on customer, loanAccount, createdAt, amendsNote

**2. Notes Timeline on Single Customer View**
- Chronological feed of all notes for a customer, displayed within the ServicingView
- Collapsed by default, expandable to show full content
- Type filtering (e.g., show only "Complaint" notes for compliance review)
- Amendment indicator: visual badge on amended notes with "View original" link
- Newest-first ordering with date grouping

**3. "Add Note" Slide-Over Form**
- Triggered via "Add Note" button on the Single Customer View and within the Account Panel
- Pre-populates customer and loanAccount from current context
- Fields: noteType (required), subject (required), content/rich text (required), contactDirection, loanAccount, priority, sentiment
- Follows existing drawer/slide-over UX pattern (consistent with WaiveFee, RecordRepayment)

**4. Immutability & Amendment Chain**
- Notes are immutable after creation - no edits to substantive fields
- "Amend" action creates a new note with `amendsNote` pointing to the original
- Original note's status set to `amended` (only permitted mutation)
- UI displays the active version with "View history" to see the full chain

**5. Auto-Capture of Author**
- `createdBy` automatically set from the authenticated user session on note creation
- Displayed as author name + timestamp on each note in the timeline

### Out of Scope for MVP

| Feature | Rationale | Phase |
|:---|:---|:---|
| **Post-action prompt** | Layer on after core note-taking flow is validated. UX feature, not data model dependency. | Phase 2 (fast follow) |
| **Follow-up tracking** (date, assignee, completion) | Adds form complexity. Validate core adoption first, then add accountability layer. | Phase 2 (fast follow) |
| **Cross-customer note search** | "Show me all complaints from last 30 days" - requires dedicated search UI. Core value is per-customer timeline first. | Phase 2 |
| **Follow-up dashboard** | View all open follow-ups across customers. Depends on follow-up tracking fields. | Phase 2+ |
| **Follow-up assignment notifications** | Dashboard check sufficient for MVP per product owner direction. | Phase 2+ |
| **Complaint auto-escalation** | Just categorisation for now. Workflow triggers come after adoption. | Phase 3 |
| **Note templates / quick-fill** | Common interaction templates to speed up note creation. Optimisation after baseline usage established. | Phase 3 |
| **Sentiment/type analytics** | Trend analysis across notes. Requires cross-customer search foundation. | Phase 3 |
| **Phone/email system integration** | Auto-create notes from inbound calls or emails. Significant integration effort. | Phase 3+ |

### MVP Success Criteria

The MVP is successful when:

1. **Adoption:** > 90% of support staff create at least 1 note per shift within the first week
2. **Coverage:** Notes exist for the majority of customer interactions (trending toward 1:1 with call volume)
3. **Continuity:** By Week 4, staff report they can pick up customer context from prior notes on returning callers
4. **Complaint readiness:** When a complaint record is pulled, a timestamped, immutable trail exists from the notes timeline
5. **Form speed:** Average note creation takes under 2 minutes (validates form simplicity)

**Go/No-Go for Phase 2:**
- If adoption and coverage targets are met: proceed with post-action prompts + follow-up tracking
- If adoption is low (< 50%): investigate UX friction before adding more features
- If note quality is poor: simplify the form further before layering complexity

### Future Vision

**Phase 2: Prompted Accountability (Fast Follow)**
- Post-action prompts after financial actions nudge consistent documentation
- Follow-up tracking (date, assignee, completion) adds accountability layer
- Follow-up indicators visible on the dashboard for supervisors

**Phase 3: Operational Intelligence**
- Cross-customer note search enables compliance reporting and trend analysis
- Complaint auto-escalation workflows triggered by note type
- Note templates reduce creation time for common interaction patterns
- Sentiment analytics surface customer experience trends across the portfolio

**Long-Term:**
- Integration with phone systems (auto-log call events as note stubs)
- Email integration (link inbound/outbound emails as notes automatically)
- AI-assisted note summarisation (generate subject from body content)
- Customer-facing interaction history (expose a sanitised view to customer portal)
