# Marketing cutover runbook — Apps Script retirement (C1)

**Goal:** all marketing sends flow through the platform (notificationService
pipeline); the legacy Google Apps Script sender is retired; its send history
is preserved on contact timelines.

## Pre-conditions (all shipped)

- Stream A end-to-end verified on demo (batches → invitations → dispatcher;
  consent + needs-review gates enforced platform-side).
- Stream B deployed (customer state projection → derived stages), so
  segmentation (win-back, applicant exclusion) is live-data driven.
- ClickSend inbound webhook live (replies land on timelines regardless of
  which system sent the outbound).

## Cutover order

1. **Freeze the Apps Script sender** (disable its trigger in the Apps Script
   console). From this moment the platform is the only sender.
2. **Export the send log** from the Sheet as CSV with headers:
   `timestamp, mobile, channel, subject, body` (extra columns ignored).
3. **Backfill** the history into contact timelines:

   ```bash
   # from event-processor/, with demo/prod DATABASE_URI + MARKETING_GRPC_ADDRESS
   python -m scripts.backfill_sendlog export.csv --dry-run   # counts + unmatched review
   python -m scripts.backfill_sendlog export.csv             # idempotent (row-hash keys)
   ```

   Rows whose mobile matches no contact are written to
   `export.unmatched.csv` — review these: genuinely unknown numbers can be
   ignored; known people missing from the contacts projection should be
   added via waitlist intake (or `import_waitlist`) and the importer re-run
   (idempotency keys make re-runs safe).
4. **Verify**: spot-check several contacts' timelines for
   `message_out · source_system=apps_script` interactions; compare row
   counts (`imported` vs sheet rows minus unmatched).
5. **Retire**: archive the Apps Script project + revoke its ClickSend/WhatsApp
   credentials. Record the retirement date below.

## Decision record

- **B1 (WhatsApp timing), decided 2026-07-08:** hold the phase-3 default —
  SMS/email first through the platform pipeline. Rationale: WhatsApp needs a
  Meta business account + pre-approved templates (external lead time Billie
  does not control) and is the largest single chunk of phase 3; nothing else
  in the cutover depends on it. **Parallel external task: start Meta template
  approval now** so phase 3 isn't gated on it. Replies to any legacy WhatsApp
  threads still surface via the inbound webhook path.
- Retirement date: _________ (fill at execution)

## Rollback

The Apps Script trigger can be re-enabled at any point before step 5; the
backfill is additive and idempotent, so no data cleanup is needed to roll
back. After step 5, rollback means re-issuing credentials — prefer fixing
forward through the platform pipeline.

## Deferred items (explicit — decided 8 Jul 2026 review passes)

| Item | Why deferred | Where it lands |
|---|---|---|
| Batch send-history persistence (per-batch invited/skipped counts on the projection, not just the toast) | Needs a batch-outcome event + alembic + CRM migration; interactions already record per-contact `message_out` | Phase 3, with the campaign-measurement work |
| Collections `stop_contact` ↔ marketing suppression bridge (customer-level suppression consulted for contact-addressed sends) | Cross-service design decision — suppression is keyed by customer_id in collections, contact_id in marketing; needs the collections owner | Raise with collections owner; candidate: dispatcher gate checks linked customer suppression |
| Grid keyboard navigation (j/k/Enter, per AccountsBrowser) | UX polish, mouse + name-link paths work | Next UI pass |
| XDEL stream sweep + subject-access export (full DSR) | Already-governed phase-3 scope (spec §10); projection + feedback + evidence redaction is DONE | Phase 3 |
| WhatsApp provider + templates | B1 decision — external Meta lead time | Phase 3 (start template approval now) |
