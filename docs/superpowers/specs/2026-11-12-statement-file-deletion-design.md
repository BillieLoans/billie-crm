# Statement file deletion — design

Date: 12 Nov 2026 · Status: draft for review

## Why

Billie needs a way to honour a customer's request to delete the bank-statement data
they gave us. Today there is no way to do it from the CRM; files sit in S3 forever.
The first real use will be Rohan deleting his own statements, so the feature must
work end-to-end in prod, not just in demo.

## What it does

Admins and supervisors can delete the statement files in S3:

- **for one application**, from the Statements section of the application
  (ConversationDetailView → AssessmentPanel → "Statements"), or
- **for every application a customer has**, from the foot of the Applications panel
  in the customer's servicing view (`src/components/ServicingView/ApplicationsPanel`).

Both buttons open the same stepped confirm flow. Each deletion is recorded in a
permanent CRM-owned log, and the application's Statements section shows that record
in place of the Files list.

The approved mockup is in
`.superpowers/brainstorm/31970-1794480584/content/delete-statements.html` (local,
gitignored). It is described in full below so the doc stands alone.

## Goals

- An approver can delete one application's statement files, or all of a customer's,
  in a few clicks with a deliberate confirm.
- Every file under the two statement prefixes (below) for that application is
  removed from S3, not just the four files the statements view links to.
- A lasting record shows who deleted what, when, and why.
- The result is honest: a partial failure is reported as a partial failure.

## Non-goals (decided, left for later)

These stay where they are for now. The review step says so, so staff know.

- The affordability report file, `{base}/{applicationNumber}/AffordabilityReports/{applicationNumber}_affordability.json`
  (category buckets in `data.groups` and metrics: aggregates, not the statement). Exact
  key only; see "What gets deleted". (13 Nov 2026: affordability report kept)
- The affordability report summary on the conversation (`statement_capture.affordabilityReport`).
- Bank account holder names (`conversations.statement_account_holders` and
  `statement_capture.accountHolders`) that drive search.
- Credit assessment records.
- Data held by the statement providers (TaleFin, Basiq).
- `{base}/{applicationNumber}/StatementCapture/`, where the old Basiq flow saved
  its step downloads (`statementProcessingAgent.py:862` in billieChat). Basiq is no
  longer used, so Rohan has ruled this folder out. Don't list or mention it.
- Any other S3 folder under the application (e.g. generated loan documents),
  Redis caches. (Backups were a non-goal until 13 Nov 2026; see "Backups" below.)
- Any change to billieChat or the Python event processor.

## Anti-goals (would make this a failure even if it "works")

- Telling staff the files are gone when some remain.
- Deleting another application's files through a loose prefix match
  (`APP-1` matching `APP-10…`).
- Touching anything outside the two statement prefixes.
- Letting anyone other than an admin or supervisor delete, through the UI or the API.

## What gets deleted

billieChat writes statement files to S3 with key
`{S3_BASE_FOLDER_CUSTOMER_DATA}/{applicationNumber}/{subfolder}/{file}`
(`shared/billie_shared/infra/s3_client.py` in billieChat). For each application the
CRM deletes every object under exactly these two prefixes, except one kept file
(13 Nov 2026: affordability report kept):

| Prefix | Deleted | Kept | Writer |
|---|---|---|---|
| `{base}/{applicationNumber}/statements/` | everything: raw provider statement files, TaleFin webhook bodies under `statements/talefin/events/` | nothing | billieChat backend webhooks (`routes/webhooks.py`, `routes/bankstatements.py`, `routes/talefin_webhooks.py`, `services/talefin/pull.py`) |
| `{base}/{applicationNumber}/AffordabilityReports/` | categorised transactions CSV (`{app}_categorized.csv`), accounts JSON (`{app}_accounts.json`), any Basiq-era `{jobId}.json`, anything else | `{app}_affordability.json` only | categoriser |

A key is kept if and only if it equals
`{base}/{applicationNumber}/AffordabilityReports/{applicationNumber}_affordability.json`,
an exact string match built the same way as the prefixes. A subfolder copy, a file
of the same name under `statements/`, and `{otherApp}_affordability.json` are all
deleted. The kept key is never counted, never gets a delete marker and is never
version-deleted.

Base folder and bucket by environment (from billieChat's fly tomls; the CRM's
`S3_BUCKET_NAME` already matches):

| Env | Bucket | Base folder |
|---|---|---|
| prod | `billie-files-prod-734836384687` | `customer` |
| demo | `billie-applications-nonprod` | `demo` |
| staging | `billie-applications-nonprod` | `customer` |

The CRM gets a new non-secret env var `S3_STATEMENT_BASE_FOLDER` in each
`infra/fly/fly.<env>.toml`, set to the value above. The prefix is built from config
plus `conversations.applicationNumber`. It is **not** derived from `fileLocations`,
because an application whose retrieval never completed has no `fileLocations` but may
still have raw files.

Prefix safety:
- `applicationNumber` must match a strict pattern (e.g. `^[A-Za-z0-9_-]+$`) or the
  request is rejected. No `/`, no `..`.
- The prefix always ends in `/`.
- Every listed key is re-checked to start with one of the two prefixes before it is
  passed to delete.

## The flow

### Entry points

**Application.** A "Delete statement files…" button (destructive styling) sits at
the foot of the Statements section. It is always in the same place, whether or not
files are listed. Only admins and supervisors see it. Once a deletion is logged for
that application, a note replaces the Files list:

> Statement files deleted 12 Nov 2026, 3:42 pm by Rohan Sharp
> 14 files removed · Reason: customer privacy request

The four file links are hidden once that note shows. The file route would 404
anyway.

**Customer.** "Delete statement files for all applications…" sits at the foot of
the Applications panel, under the list. Only admins and supervisors see it. The
server resolves scope by **exact match** on `conversations.customerIdString`, with
no limit. It does not reuse `useCustomerConversations`, which is a loose text search
capped at 20 results. Identity merges already re-point conversations to the
surviving customer id (`event-processor/src/billie_servicing/handlers/identity.py`),
so an exact match covers a merged customer.

### Step 1 of 2: Review

A drawer, consistent with the other servicing drawers. The server lists S3 under
both prefixes for each application in scope and shows:

- one row per application: application number and the number of files found, or
  "No files"
- the list of what is kept (the non-goals above, in plain words)
- **a warning, not a block** (Rohan's decision) on any application that is:
  - **still in progress** (the conversation is active, or statement retrieval or
    assessment hasn't finished). Deleting may break the assessment that's about to
    read these files.
  - **behind a funded loan** (a loan account exists for the application).
    Responsible-lending record-keeping may require keeping the statements behind a
    lending decision, so check before going ahead.

  The approver can still continue. The log row records which warnings were shown.
  The builder chooses the exact checks from the conversation status /
  `statementCapture` flags and the `loan_accounts` link.
- a required **Reason** text field (e.g. "Customer privacy request, ticket #1234")
- Continue is disabled until a reason is entered and at least one file was found.
  If nothing is found, say so plainly.

### Step 2 of 2: Confirm

- A warning panel: "N files across M applications will be deleted from Billie's
  storage now. Backup copies are erased after 180 days." (Changed 13 Nov 2026;
  see "Backups".)
- Type `DELETE` to enable the button.
- Buttons: Back, and "Delete N files" (destructive).

### Result

One line per application: "deleted ✓ (n files)", "nothing to delete", or "failed —
<reason>, k of n files remain". A partial result is never shown as success. A retry
from the same button picks up whatever remains.

Error summary, focus management, ARIA and keyboard behaviour follow
`docs/ux-standards.md` (stepped flow for irreversible actions, error summary, WCAG
2.2 AA).

## Server side

### API routes

Both routes require `hasApprovalAuthority(user)` and return 403 otherwise. The UI
hiding the button is not the control.

- `POST /api/statements/deletion/preview`, body `{ conversationIds: string[] }` or
  `{ customerIdString }`. It resolves conversations (customer scope means all the
  customer's conversations) and lists both prefixes per application. It returns
  `{ applications: [{ conversationId, applicationNumber, fileCount }] }`. The
  response does not need to include key names.
- `POST /api/statements/deletion`, same body plus `reason`. It **re-resolves and
  re-lists on the server** (never trusts the preview or the client), deletes, writes
  one log row per application, and returns the per-application result.

Use the existing rate-limit helper (`src/lib/utils/rateLimit.ts`). Exact paths and
shapes are the builder's call. Keep them under `src/app/api/` following the existing
route style (see `src/app/api/conversations/[conversationId]/statements/file/route.ts`).

### S3 client

Add to `src/server/s3-client.ts`:
- `listKeysUnderPrefix(prefix)`: `ListObjectsV2` with pagination.
- `deleteKeys(keys)`: `DeleteObjects` in batches of ≤1000. It returns per-key
  success and error from the response's `Errors` array. A 200 from DeleteObjects can
  still contain per-key failures.
- Always list with `ListObjectVersions` and delete each data `VersionId`. This works
  on unversioned buckets too, and on a versioned bucket a plain delete leaves the
  bytes in place. Since 13 Nov 2026 a plain delete (a delete marker) comes first, and
  delete markers are never deleted; see "Backups".

### Deletion log: new collection `statement-file-deletions`

This is CRM-owned and append-only. It is an exception to the read-only projection
rule, like `disbursement-access-log`, which is the pattern to copy
(`src/collections/DisbursementAccessLog.ts`). Access: `read` and `create` need
approval authority; `update` and `delete` are `() => false`. Hide it from non-admins
in the sidebar.

One row per application per deletion attempt:

| Field | Notes |
|---|---|
| `conversationId`, `applicationNumber`, `customerIdString` | indexed; denormalised so the row stays readable |
| `scope` | `application` \| `customer` (which button started it) |
| `actorId`, `actorEmail` | who pressed it |
| `reason` | required |
| `status` | `deleted` \| `partial` \| `failed` \| `nothing_found` |
| `filesFound`, `filesDeleted` | counts |
| `warnings` | which review-step warnings applied (`in_progress`, `funded_loan`) |
| `deletedKeys`, `failedKeys` | json arrays of S3 keys, as proof of what was removed (keys hold application numbers and file names, not statement content) |
| `occurredAt` | timestamp |

The Statements section reads the latest `deleted`/`partial` row for the conversation
to render the note, through a small read hook (React Query, added to the
`src/hooks/index.ts` barrel).

Schema change: commit a Payload migration (uuid ids; see the
`payload-migration-local-recipe` and uuid notes in team memory). Run
`pnpm generate:types` and `pnpm generate:importmap`.

Update `CLAUDE.md` "Data flow" to list `statement-file-deletions` among the CRM-owned
exceptions.

## IAM

The CRM signs in to AWS with long-lived access keys in Fly secrets, and those keys
belong to the CRM alone. Rohan confirmed this, so granting delete rights here
reaches no other service. If one nonprod user serves both demo (`demo`) and staging
(`customer`) in `billie-applications-nonprod`, the policy must cover both base
folders. The CRM's AWS identity (prod and nonprod) needs, scoped as tightly as
possible:

- `s3:ListBucket` on the bucket, with an `s3:prefix` condition on `{base}/*`
- `s3:DeleteObject` on `arn:aws:s3:::{bucket}/{base}/*/statements/*` and
  `arn:aws:s3:::{bucket}/{base}/*/AffordabilityReports/*`
- if versioned: `s3:ListBucketVersions` and `s3:DeleteObjectVersion` on the same
  resources

Rohan has said the IAM role can be updated. The policy change is applied outside this
repo; the builder writes out the exact policy JSON for Rohan to apply.

## Backups (13 Nov 2026)

Prod (`billie-files-prod-734836384687`) replicates to a backup bucket in another
account (`billie-replica-files-prod-342996267425`). S3 replicates delete markers but
never version-specific deletes, so deleting every version by `VersionId` left the
backup's copy in place forever.

Decision:

- For each key with a data version, the CRM first places a delete marker (a plain
  `DeleteObjects` entry with no `VersionId`), then deletes the data versions it
  listed, by `VersionId`. A key whose marker fails keeps all its versions and is
  reported as remaining. Delete markers are never deleted and never counted as
  files.
- The marker replicates and makes the backup's copy noncurrent. A backup lifecycle
  rule expires noncurrent versions 180 days after they become noncurrent (the 30-day
  Governance lock can only delay that). Erasure is immediate in Billie's bucket. In
  the backup it happens after 180 days once the marker has replicated; lifecycle runs
  asynchronously after the due date and can add a few days, so no deadline is
  promised.
- The confirm copy says so: files go from Billie's storage now; backup copies are
  erased after 180 days. The delete is no longer described as unrecoverable.
- The replication rule must have delete-marker replication enabled and no tag filter
  (Rohan to confirm). Urgent erasure from the backup and the first-deletion check are
  runbooks in `docs/statement-file-deletion.md`. IAM is unchanged.

## Open checks for the builder (do before building the delete path)

1. **Check the buckets' settings** on `billie-files-prod-734836384687` and
   `billie-applications-nonprod`:
   - **Object Lock or MFA-delete:** either would block deletion outright.
   - **Versioning:** the delete path is version-aware either way, but the IAM
     version permissions are needed only if versioning is on.
   - **Replication or backup:** note any. (Prod's replica is handled since 13 Nov 2026;
     see "Backups".)
2. Spot-check a real prod key to confirm the layout
   `customer/{applicationNumber}/statements/…` (e.g. from a `fileLocations` URI on a
   recent conversation).

## Testing

- Unit:
  - the prefix builder and validation (including the `APP-1` vs `APP-10` case)
  - the per-key result handling for DeleteObjects partial failures
  - route auth (`operations` and `readonly` get 403)
  - re-listing at delete time
  - log rows for each status

  Mock the S3 client.
- UI:
  - button visibility by role
  - the two steps, including Continue and Delete disabled states
  - the result rendering, partial failure included
  - the "deleted" note replacing Files

  Remember the `@payloadcms/ui` mock.
- Rollout: demo first on a test application, then prod on Rohan's own applications.
  Confirm with an S3 listing that both prefixes hold no data versions afterwards (a
  delete marker per key stays).

## Calls made by Claude (not discussed)

- Prefix comes from a new env var + `applicationNumber`, not from `fileLocations`.
- One log row per application; S3 keys are stored in the log.
- Reason is required; confirm is type-`DELETE`.
- Customer scope is an exact match on `customerIdString`, done on the server.
- Deletion is always version-aware.
- The delete button stays enabled after a deletion (the review step shows "No files"
  if nothing remains) rather than being disabled. This covers billieChat writing new
  files later.
- No billieChat or event-processor change; the Statements section reads the CRM log,
  not the projection.
