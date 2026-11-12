# Statement File Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins and supervisors permanently delete an application's (or all of a customer's applications') statement files from S3, with a stepped confirm and a permanent CRM-owned log.

**Architecture:**
- **Pure helpers:** build and validate the two S3 prefixes per application.
- **Server service (`src/server/statement-deletion.ts`):**
  - resolves the scope (one conversation, or every conversation for a customer by exact `customerIdString`)
  - lists every object version under the prefixes and works out the warnings
  - deletes the listed versions and writes one append-only log row per application
- **API routes:** three thin routes over the service.
- **UI:** a shared drawer, opened from the Statements section and from the Applications panel. The Statements section renders the latest log row in place of the Files list.

**Tech Stack:** Payload CMS 3.85 (postgres adapter), Next.js 16 route handlers, `@aws-sdk/client-s3`, Zod v4, TanStack React Query, Vitest (jsdom) + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-12-statement-file-deletion-design.md`

## Global Constraints

- Prefixes deleted per application: exactly `{base}/{applicationNumber}/statements/` and `{base}/{applicationNumber}/AffordabilityReports/`. Nothing else, and never `StatementCapture/`.
- `{base}` comes from the new env var `S3_STATEMENT_BASE_FOLDER`: prod `customer`, demo `demo`. Bucket is the existing `S3_BUCKET_NAME`.
- `applicationNumber` must match `^[A-Za-z0-9_-]+$`, or that application is refused (no S3 call).
- Every prefix ends in `/`. Every listed key is re-checked to start with one of its application's prefixes before deletion.
- Deletion is always version-aware: `ListObjectVersions`, then `DeleteObjects` with `VersionId`, delete markers included, batches of ≤1000.
- Preview and delete need `hasApprovalAuthority` (admin or supervisor), otherwise 403. The "latest deletion" read needs `hasAnyRole`.
- The delete route re-resolves the scope and re-lists S3 itself. It never trusts the preview or client-supplied keys.
- A reason is required: trimmed, 1–500 characters.
- Log statuses: `deleted` | `partial` | `failed` | `nothing_found`. Warnings: `in_progress` | `funded_loan`. Warnings never block.
- Kept-data copy in the review step (verbatim): "Kept: the affordability summary, account-holder names and credit assessment records in the CRM, and anything held by TaleFin."
- Irreversible-warning copy (verbatim, with numbers): "{N} files across {M} applications will be permanently deleted. They can't be recovered." Pluralise both nouns ("1 file", "1 application"). M counts only applications with at least one file.
- Confirm word: `DELETE` (exact, case-sensitive).
- Warning copy (verbatim):
  - `in_progress`: "This application is still in progress. Deleting its statements may break the assessment that's about to read them."
  - `funded_loan`: "This application has a funded loan. Responsible-lending record-keeping may require keeping these statements — check before going ahead."
- Prettier: single quotes, no semicolons, trailing commas, 100 cols. Australian formatting via `src/lib/formatters.ts`.
- UI follows `docs/ux-standards.md`: a stepped flow for irreversible actions, an error summary, focus management, WCAG 2.2 AA.
- Component tests mock `@payloadcms/ui`: `vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user }) }))`.

## Review Focus

1. **Prefix collision.** An `APP-1` listing must never return `APP-10/...` keys. The trailing `/` plus the per-key re-check both guard this. Test it in Task 1 and Task 3.
2. **DeleteObjects partial failure.** The response is HTTP 200 with a non-empty `Errors` array. It must be logged and returned as `partial` (or `failed` if nothing was deleted), never `deleted`. Test in Task 2 and Task 3.
3. **More than 1000 versions or a paginated listing.** All pages are listed, and deletes are chunked at 1000. Test in Task 2.
4. **Customer with a conversation missing `applicationNumber`, or with a malformed one.** That application comes back `failed` with a reason, the rest proceed, and nothing is deleted for it. Test in Task 3.
5. **Operations or readonly user calling the API directly.** Preview and delete return 403 even though the UI hides the button. Test in Task 4.

**Order note:** Task 7 Step 1 (the bucket settings check) depends on nothing. Run it before Task 2: Object Lock or MFA-delete would make the delete path pointless.

---

### Task 1: Prefix helpers and env config

**Files:**
- Create: `src/lib/statement-deletion.ts`
- Modify: `infra/fly/fly.prod.toml` (next to `S3_BUCKET_NAME`, ~line 38), `infra/fly/fly.demo.toml` (~line 39)
- Test: `tests/unit/lib/statement-deletion.test.ts`

**Interfaces:**
- Produces (all from `@/lib/statement-deletion`):
  - `STATEMENT_SUBFOLDERS: readonly ['statements', 'AffordabilityReports']`
  - `isValidApplicationNumber(value: unknown): value is string`
  - `statementPrefixes(baseFolder: string, applicationNumber: string): string[]`: throws `Error` on an invalid number or an empty base; strips leading and trailing `/` from the base.
  - `isKeyWithinPrefixes(key: string, prefixes: string[]): boolean`
  - `type DeletionWarning = 'in_progress' | 'funded_loan'`
  - `type DeletionStatus = 'deleted' | 'partial' | 'failed' | 'nothing_found'`
  - `DELETION_WARNING_COPY: Record<DeletionWarning, string>`, `KEPT_DATA_COPY: string`, `CONFIRM_WORD = 'DELETE'`. All copy is verbatim from Global Constraints.

- [ ] **Step 1: Write the failing tests**

```ts
expect(statementPrefixes('customer', 'APP-1')).toEqual([
  'customer/APP-1/statements/',
  'customer/APP-1/AffordabilityReports/',
])
expect(statementPrefixes('/demo/', 'APP-1')[0]).toBe('demo/APP-1/statements/')
for (const bad of ['', 'APP/1', '../x', 'APP 1', 'a..b/c', null, 42])
  expect(isValidApplicationNumber(bad)).toBe(false)
expect(() => statementPrefixes('customer', 'APP/1')).toThrow()
expect(() => statementPrefixes('', 'APP-1')).toThrow()
const p = statementPrefixes('customer', 'APP-1')
expect(isKeyWithinPrefixes('customer/APP-1/statements/a.json', p)).toBe(true)
expect(isKeyWithinPrefixes('customer/APP-10/statements/a.json', p)).toBe(false)
expect(isKeyWithinPrefixes('customer/APP-1/StatementCapture/a.json', p)).toBe(false)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm exec vitest run tests/unit/lib/statement-deletion.test.ts --config ./vitest.config.mts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the module per the Interfaces block. Add `S3_STATEMENT_BASE_FOLDER="customer"` to `fly.prod.toml` and `S3_STATEMENT_BASE_FOLDER="demo"` to `fly.demo.toml`, each in the `[env]` block beside `S3_BUCKET_NAME`.**

- [ ] **Step 4: Run the test again; expect PASS.**

- [ ] **Step 5: Commit**: `feat(crm): statement deletion prefix helpers and base-folder config`

---

### Task 2: Version-aware S3 list and delete

**Files:**
- Modify: `src/server/s3-client.ts`
- Test: `tests/unit/server/s3-statement-delete.test.ts`

**Interfaces:**
- Produces (from `@/server/s3-client`):
  - `interface ObjectVersionRef { key: string; versionId?: string }`
  - `listObjectVersionsUnderPrefix(prefix: string): Promise<ObjectVersionRef[]>`: `ListObjectVersionsCommand` on `getBucketName()`, following `NextKeyMarker`/`NextVersionIdMarker` until `IsTruncated` is false. Includes both `Versions` and `DeleteMarkers`. Omits `versionId` when S3 returns `'null'`.
  - `deleteObjectVersions(refs: ObjectVersionRef[]): Promise<{ deleted: ObjectVersionRef[]; failed: Array<ObjectVersionRef & { message: string }> }>`: `DeleteObjectsCommand` in chunks of 1000 with `Quiet: false`. Maps `Deleted` and `Errors`. A thrown chunk marks every ref in that chunk failed with the error message, then continues with the next chunk.
  - `getStatementBaseFolder(): string`: reads `S3_STATEMENT_BASE_FOLDER` and throws `Error('S3_STATEMENT_BASE_FOLDER environment variable is not set')` if unset.

- [ ] **Step 1: Write the failing tests.** Use `vi.mock('@aws-sdk/client-s3')` with a fake `S3Client.prototype.send` that dispatches on the command class. Set `process.env.S3_BUCKET_NAME = 'b'`. Tests:
  - `lists all pages`: two truncated pages (one `Versions`, one `DeleteMarkers`) give 3 refs, and the second call carries the markers from the first.
  - `chunks deletes at 1000`: 2,500 refs produce 3 `DeleteObjectsCommand` calls of 1000, 1000 and 500.
  - `reports per-key errors from a 200 response`: `{ Deleted: [{Key:'a'}], Errors: [{Key:'b', Message:'AccessDenied'}] }` gives `deleted.length === 1`, and `failed[0]` equals `{ key: 'b', message: 'AccessDenied' }`.
  - `a thrown chunk fails only that chunk`.
  - `getStatementBaseFolder throws when unset`.

- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/server/s3-statement-delete.test.ts --config ./vitest.config.mts`; expect FAIL.

- [ ] **Step 3: Implement the three functions per Interfaces.** Import `ListObjectVersionsCommand` and `DeleteObjectsCommand` from `@aws-sdk/client-s3`.

- [ ] **Step 4: Run again; expect PASS.** Also run `tests/unit/server/s3-uri.test.ts`; it should still pass.

- [ ] **Step 5: Commit**: `feat(crm): version-aware S3 list and batch delete`

---

### Task 3: Deletion log collection and the deletion service

**Files:**
- Create: `src/collections/StatementFileDeletions.ts`
- Modify: `src/payload.config.ts` (import and append to `collections`, line ~191)
- Create: `src/migrations/<timestamp>_statement_file_deletions.ts` (+ `.json`, + `index.ts` entry)
- Regenerate: `src/payload-types.ts`, `src/app/(payload)/admin/importMap.js`
- Create: `src/server/statement-deletion.ts`
- Modify: `CLAUDE.md` ("Data flow": list `statement-file-deletions` beside the other CRM-owned exceptions)
- Test: `tests/unit/server/statement-deletion.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; Task 2 `listObjectVersionsUnderPrefix`, `deleteObjectVersions`, `getStatementBaseFolder`.
- Produces:
  - Collection slug `statement-file-deletions`. Copy `src/collections/DisbursementAccessLog.ts`:
    - access: `read`/`create` = `hasApprovalAuthority`; `update`/`delete` = `() => false`
    - `admin.hidden: hideFromNonAdmins`, group `Servicing`
    - fields (all `readOnly`):
      - `conversationId` (text, required, index)
      - `applicationNumber` (text, index)
      - `customerIdString` (text, index)
      - `scope` (select `application` | `customer`, required)
      - `actorId` (text, required)
      - `actorEmail`, `actorName` (text)
      - `reason` (textarea, required)
      - `status` (select of `DeletionStatus`, required)
      - `filesFound`, `filesDeleted` (number, required)
      - `warnings` (select, `hasMany`, options `DeletionWarning`)
      - `deletedKeys`, `failedKeys` (json)
      - `occurredAt` (date, required, index)
  - `type DeletionScope = { scope: 'application'; conversationId: string } | { scope: 'customer'; customerIdString: string }`
  - `interface ApplicationPreview { conversationId: string; applicationNumber: string | null; fileCount: number; warnings: DeletionWarning[]; error?: string }`
  - `previewDeletion(payload: Payload, scope: DeletionScope): Promise<ApplicationPreview[]>`
  - `interface ApplicationResult extends ApplicationPreview { status: DeletionStatus; filesDeleted: number; failedCount: number }`
  - `executeDeletion(payload: Payload, scope: DeletionScope, reason: string, actor: { id: string; email?: string; name?: string }): Promise<ApplicationResult[]>`
  - `latestDeletion(payload: Payload, conversationId: string): Promise<{ occurredAt: string; actorName: string | null; actorEmail: string | null; filesDeleted: number; reason: string; status: 'deleted' | 'partial' } | null>`: returns the newest row with status `deleted` or `partial`. Use `sort: ['-occurredAt']`, an array, never a comma string. Pass `overrideAccess: true`; the route does the auth.
- Rules the service implements:
  - **Scope resolution.** Uses `payload.find` on `conversations` with `overrideAccess: true`, `pagination: false`, and `select` limited to `conversationId`, `applicationNumber`, `customerIdString`, `status`, `statementCapture`. Application scope matches `conversationId` equals. Customer scope matches `customerIdString` equals, exactly.
  - **`in_progress` warning.** Raised when the conversation `status` is `active` or `paused`, or when `statementCapture.consentStatus === 'complete'` and `statementCapture.checksComplete !== true`.
  - **`funded_loan` warning.** Raised when a `loan-accounts` doc exists with `applicationNumber` equal to the application's number (`limit: 1`).
  - **Invalid or missing `applicationNumber`.** That application gets `error: 'Missing or invalid application number'` and `status: 'failed'`. It gets no S3 call, but a log row is still written.
  - **Filtering.** Every listed ref is filtered through `isKeyWithinPrefixes` before deletion. If anything is dropped, `console.error` it with the key.
  - **Status.** `nothing_found` when 0 refs are found, `deleted` when no failures, `failed` when 0 deleted and some failed, otherwise `partial`.
  - **Writing.** One `payload.create` on `statement-file-deletions` per application, with `overrideAccess: true`. `deletedKeys` and `failedKeys` hold the key strings.

- [ ] **Step 1: Write the failing service tests.** Mock `@/server/s3-client` and pass a fake `payload` with `find`/`create` spies. Tests:
  - `application scope lists both prefixes and logs one row`: asserts `listObjectVersionsUnderPrefix` was called with `customer/APP-1/statements/` and `customer/APP-1/AffordabilityReports/`, and that `create` received `status: 'deleted'`, `filesFound: 3`, `filesDeleted: 3`, `scope: 'application'`, plus the reason and actor.
  - `customer scope resolves by exact customerIdString`: the `find` where clause equals `{ customerIdString: { equals: 'CUS-1' } }` and `pagination: false`.
  - `drops keys outside the prefixes`: a listing that wrongly returns `customer/APP-10/statements/x` must not be passed to `deleteObjectVersions`.
  - `partial`: 2 deleted and 1 failed gives `status: 'partial'`, with `failedKeys` equal to the failed key.
  - `failed`: 0 deleted and 2 failed gives `failed`. `nothing_found`: 0 refs gives `nothing_found`, and `deleteObjectVersions` is not called.
  - `invalid application number`: `'APP/1'` gives `failed` with the error, no S3 calls, and a row still created. The other application in the same customer scope still gives `deleted`.
  - `warnings`:
    - `status: 'active'` gives `['in_progress']`
    - consent complete with `checksComplete` false gives `in_progress`
    - a `loan-accounts` hit gives `funded_loan`
    - a `declined` conversation with no loan gives `[]`
  - `latestDeletion ignores nothing_found and failed rows`.

- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/server/statement-deletion.test.ts --config ./vitest.config.mts`; expect FAIL.

- [ ] **Step 3: Implement the collection, register it in `payload.config.ts`, and implement the service per Interfaces and Rules.**

- [ ] **Step 4: Run the service test; expect PASS.**

- [ ] **Step 5: Generate the migration.** Follow the throwaway-Postgres recipe. Run it off this branch, which was created from current `main`. Steps: `docker run` Postgres on 5434, then `pnpm payload migrate`, then `pnpm payload migrate:create statement_file_deletions` (the name is positional), then `pnpm payload migrate`, then `docker rm -f`. Check that the generated SQL uses `uuid` ids, including the `payload_locked_documents_rels` column, and that `src/migrations/index.ts` still lists every migration from `main`. Then run `pnpm generate:types && pnpm generate:importmap`.

- [ ] **Step 6: Update `CLAUDE.md` Data flow, then run `pnpm exec tsc --noEmit -p .`; expect no new errors.**

- [ ] **Step 7: Commit**: `feat(crm): statement-file-deletions log and deletion service`

---

### Task 4: API routes

**Files:**
- Create: `src/lib/schemas/statement-deletion.ts`
- Create: `src/app/api/statements/deletion/preview/route.ts` (POST)
- Create: `src/app/api/statements/deletion/route.ts` (POST to delete, GET for the latest deletion)
- Modify: `src/lib/utils/rateLimit.ts` (add `STATEMENT_DELETION_RATE_LIMIT: RateLimitOptions = { limit: 10, windowMs: 60_000 }`)
- Test: `tests/unit/routes/statementDeletion.test.ts`

**Interfaces:**
- Consumes: Task 3 `previewDeletion`, `executeDeletion`, `latestDeletion`, `DeletionScope`.
- Produces:
  - `DeletionScopeSchema` (Zod discriminated union on `scope`; ids are trimmed, non-empty strings) and `DeletionRequestSchema = DeletionScopeSchema.and(z.object({ reason: z.string().trim().min(1).max(500) }))`.
  - `POST /api/statements/deletion/preview` with body `DeletionScope` returns `200 { applications: ApplicationPreview[] }`.
  - `POST /api/statements/deletion` with body `DeletionScope & { reason }` returns `200 { results: ApplicationResult[] }`.
  - `GET /api/statements/deletion?conversationId=…` returns `200 { deletion: ReturnType<latestDeletion> }`.
  - Errors use `{ error: { code, message } }`:
    - 400 `VALIDATION_ERROR`
    - 401/403 via `requireAuth(hasApprovalAuthority)` (GET uses `requireAuth(hasAnyRole)`)
    - 429 `RATE_LIMITED` on the two POSTs, keyed `statement-deletion:${user.id}`
    - 404 `NOT_FOUND` when the scope resolves to zero conversations
    - 500 `INTERNAL_ERROR` when `getStatementBaseFolder` throws or anything else does (log with `console.error`)
  - Actor passed to the service: `{ id: String(user.id), email: user.email, name: [firstName, lastName].filter(Boolean).join(' ') || undefined }`.

- [ ] **Step 1: Write the failing route tests.** Follow `tests/unit/routes/reapp-block-set.route.test.ts`: mock `next/server`, mock `@/lib/auth` applying the real predicate, and mock `@/server/statement-deletion`. Tests:
  - `operations` and `readonly` users get 403 on both POSTs, and the service is not called. A `supervisor` gets 200.
  - Missing reason, a reason that is only whitespace, a 501-char reason, an unknown `scope`, and an empty `conversationId` each give 400.
  - The delete route passes the parsed scope, the trimmed reason and the actor to `executeDeletion`. It ignores any `keys` field in the body.
  - The service returning `[]` gives 404.
  - GET as `readonly` gives 200 with `{ deletion: null }`. GET without `conversationId` gives 400.

- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/routes/statementDeletion.test.ts --config ./vitest.config.mts`; expect FAIL.

- [ ] **Step 3: Implement the schema, both routes and the rate-limit constant.**

- [ ] **Step 4: Run again; expect PASS.**

- [ ] **Step 5: Commit**: `feat(crm): statement deletion API routes`

---

### Task 5: Hooks and the deletion drawer

**Files:**
- Create: `src/hooks/queries/useStatementDeletion.ts`
- Create: `src/hooks/mutations/useDeleteStatementFiles.ts`
- Modify: `src/hooks/index.ts` (barrel)
- Create: `src/components/StatementDeletion/DeleteStatementFilesDrawer.tsx` + `DeleteStatementFilesDrawer.module.css`
- Create: `src/components/StatementDeletion/DeleteStatementFilesButton.tsx`
- Test: `tests/unit/components/DeleteStatementFilesDrawer.test.tsx`

**Interfaces:**
- Consumes: the Task 4 endpoints; Task 1 copy constants and `CONFIRM_WORD`.
- Produces:
  - `useStatementDeletion(conversationId: string | undefined)`: `useQuery` on key `['statement-deletion', conversationId]` against the GET; returns `deletion | null`.
  - `useStatementDeletionPreview(scope: DeletionScope | null)`: `useQuery` on key `['statement-deletion-preview', scope]`, `enabled: !!scope`, `staleTime: 0`, `retry: false`.
  - `useDeleteStatementFiles()`: `useMutation` that POSTs the delete. On settle, it invalidates `['statement-deletion']`, `['statement-deletion-preview']` and `['statement-file']`.
  - `DeleteStatementFilesDrawer({ isOpen, onClose, scope, title }: { isOpen: boolean; onClose: () => void; scope: DeletionScope; title: string })`, built on `ContextDrawer`. Steps:
    1. **Review.** One row per application: number, then "{n} files" or "No files", then each warning's copy and any `error`. Below the rows, `KEPT_DATA_COPY`. A required Reason textarea. Continue is disabled until the reason is trimmed non-empty and the total file count is above 0. If the total is 0, show "No statement files found."
    2. **Confirm.** The irreversible-warning copy with N and M; a "Type DELETE to confirm" input; Back; and a destructive "Delete {N} files" button, enabled only when the input `=== CONFIRM_WORD`.
    3. **Result.** One line per application: "Deleted ({n} files)", "Nothing to delete", or "Failed — {k} of {n} files remain" (plus `error` if present). If any application is not `deleted` or `nothing_found`, a heading reads "Some files could not be deleted" and a Retry button returns to step 1 with a fresh preview.

    On a request error, show an error summary (`role="alert"`) and move focus to it. Move focus to each step's heading when the step changes.
  - `DeleteStatementFilesButton({ scope, label, title }: { scope: DeletionScope; label: string; title: string })`: renders `null` unless `hasApprovalAuthority(useAuth().user)`. It is a destructive-styled button that opens the drawer.

- [ ] **Step 1: Write the failing component tests.** Mock `@payloadcms/ui` with a supervisor user and stub `fetch`. Tests:
  - The button renders nothing for an `operations` user and renders for a `supervisor`.
  - The Review step lists "APP-1 · 3 files" and "APP-2 · No files", plus the `funded_loan` copy for APP-1. Continue is disabled until the reason is filled.
  - Total 0 shows "No statement files found." and Continue stays disabled.
  - The Confirm step shows "3 files across 1 application will be permanently deleted. They can't be recovered."; the Delete button is disabled for `delete` and enabled for `DELETE`.
  - Submit POSTs `{ scope: 'customer', customerIdString: 'CUS-1', reason }`. The body has no `keys`.
  - A `partial` result shows "Some files could not be deleted", "Failed — 1 of 3 files remain", and a Retry button.
  - A 500 response renders `role="alert"` with the message.

- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/components/DeleteStatementFilesDrawer.test.tsx --config ./vitest.config.mts`; expect FAIL.

- [ ] **Step 3: Implement the hooks, the barrel export, the drawer and the button.** Reuse `messageFrom`-style error parsing as in `src/components/ServicingView/CancelLoanDrawer.tsx`.

- [ ] **Step 4: Run again; expect PASS.**

- [ ] **Step 5: Commit**: `feat(crm): statement deletion drawer and hooks`

---

### Task 6: Wire into the Statements section and the Applications panel

**Files:**
- Modify: `src/components/ConversationDetailView/AssessmentPanel/index.tsx` (Statements section, ~lines 496–540) and its `styles.module.css`
- Modify: `src/components/ServicingView/ApplicationsPanel/index.tsx` (foot of the panel) and its `styles.module.css`
- Test: `tests/unit/components/StatementDeletionPlacement.test.tsx`

**Interfaces:**
- Consumes: Task 5 `DeleteStatementFilesButton`, `useStatementDeletion`; `formatDateMedium` from `src/lib/formatters.ts`.
- Behaviour:
  - **Statements section.**
    - When `useStatementDeletion(conversationId)` returns a row, the Files block shows the note in place of the four file buttons: "Statement files deleted {date-time} by {actorName ?? actorEmail}" and "{filesDeleted} files removed · Reason: {reason}". If `status === 'partial'`, append " · some files could not be deleted".
    - Below the files or note, always render `<DeleteStatementFilesButton scope={{ scope: 'application', conversationId }} label="Delete statement files…" title="Delete statement files for {applicationNumber}" />`. It also renders when `sc` is empty: render it outside the `sc ? … : 'No statement capture data.'` branch, so its position is fixed.
  - **Applications panel.** Under the list, render `<DeleteStatementFilesButton scope={{ scope: 'customer', customerIdString }} label="Delete statement files for all applications…" title="Delete statement files for this customer" />` when `customerIdString` is set and the list is not loading.

- [ ] **Step 1: Write the failing tests:**
  - The Statements section with a deletion row shows the note and hides "Bank statement data →".
  - Without a row, it shows the file buttons.
  - The button is present for a supervisor in both states, and also when `statementCapture` is empty.
  - The Applications panel shows the customer button for a supervisor and not for `operations`.

- [ ] **Step 2: Run** `pnpm exec vitest run tests/unit/components/StatementDeletionPlacement.test.tsx --config ./vitest.config.mts`; expect FAIL.

- [ ] **Step 3: Implement the wiring.**

- [ ] **Step 4: Run again; expect PASS. Then run the full unit suite** `pnpm test:int` and read the summary line: the exit code is 1 even when everything passes. Then run `pnpm lint`.

- [ ] **Step 5: Commit**: `feat(crm): delete statement files from the application and customer views`

---

### Task 7: IAM policy and rollout notes

**Files:**
- Create: `docs/statement-file-deletion.md`

- [ ] **Step 1: Check the buckets' settings.**
  - Read-only AWS calls, if credentials allow: `aws s3api get-bucket-versioning`, `get-object-lock-configuration` and `get-bucket-replication` for `billie-files-prod-734836384687` and `billie-applications-nonprod`.
  - If they can't be run, record the commands for Rohan to run and say so.
  - Object Lock or MFA-delete enabled means **stop and report**; deletion cannot work.
  - Spot-check the key layout: `aws s3api list-objects-v2 --prefix customer/<a recent prod application number>/ --max-keys 20` should show `statements/` and `AffordabilityReports/` children. If the layout differs, stop and report.
- [ ] **Step 2: Write `docs/statement-file-deletion.md`:**
  - **What gets deleted and what is kept:** copy from the spec.
  - **Bucket check results.**
  - **IAM policy JSON**, one statement per action, for the CRM's own IAM user in each account:
    - `s3:ListBucket` and `s3:ListBucketVersions` on `arn:aws:s3:::{bucket}` with `"Condition": {"StringLike": {"s3:prefix": ["{base}/*"]}}`
    - `s3:DeleteObject` and `s3:DeleteObjectVersion` on `arn:aws:s3:::{bucket}/{base}/*/statements/*` and `arn:aws:s3:::{bucket}/{base}/*/AffordabilityReports/*`

    The nonprod policy lists both `demo` and `customer` bases if one user serves demo and staging.
  - **Rollout:**
    1. Apply IAM.
    2. Deploy to demo and delete a test application's files.
    3. Confirm both prefixes are empty with `aws s3api list-object-versions --prefix`.
    4. Deploy to prod and delete Rohan's own applications.
    5. Confirm empty again.
  - **Known gaps:** replication or backup, plus the spec's non-goals.
- [ ] **Step 3: Commit**: `docs: statement file deletion IAM policy and rollout`
