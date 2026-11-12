# Statement file deletion: IAM policy and rollout

Admins and supervisors can delete a customer's bank-statement files from S3, for one application or for all of a customer's applications. The files leave Billie's bucket at once; the copies in the cross-account backup bucket are erased after 180 days, once the delete marker has replicated (see "Backups"). Design: `docs/superpowers/specs/2026-11-12-statement-file-deletion-design.md`.

## What gets deleted, and what is kept

For each application the CRM deletes every data version of every object under exactly two prefixes. It leaves delete markers in place, including the new one it adds to each key (see "How a delete runs"):

| Prefix | Contents |
|---|---|
| `{base}/{applicationNumber}/statements/` | raw provider statement files, TaleFin webhook bodies under `statements/talefin/events/` |
| `{base}/{applicationNumber}/AffordabilityReports/` | categorised transactions CSV, affordability JSON, accounts JSON |

| Env | Bucket | Base folder (`S3_STATEMENT_BASE_FOLDER`) |
|---|---|---|
| prod | `billie-files-prod-734836384687` | `customer` |
| demo | `billie-applications-nonprod` | `demo` |
| staging | `billie-applications-nonprod` | `customer` |

Kept (not deleted):

- the affordability report summary on the conversation (`statement_capture.affordabilityReport`)
- bank account holder names (`conversations.statement_account_holders` and `statement_capture.accountHolders`)
- credit assessment records
- data held by the statement providers (TaleFin, Basiq)
- any other S3 folder under the application, including `StatementCapture/`
- Redis caches

Every deletion is recorded in the append-only `statement-file-deletions` collection, which admins and supervisors can read: who, when, why, and the keys removed or failed.

## How a delete runs: marker first

For each application (`executeDeletion` in `src/server/statement-deletion.ts`):

1. List every version and delete marker under both prefixes, re-checking each key against the prefixes.
2. The **data versions** are the listed entries that are not delete markers. Every count staff see (`fileCount`, `filesFound`, `filesDeleted`) counts data versions only. No data versions means `nothing_found`.
3. **Place a delete marker** on each key that has a data version: `DeleteObjects` with `{ Key }` and no `VersionId`. If the marker is not placed for a key (an `Errors` entry, the key missing from the response, or the call throwing), that key's versions are **not** deleted, and the result carries a "Could not place delete marker" error.
4. **Delete the data versions** listed in step 1, by `VersionId`, for the keys whose marker was placed. Delete markers, old and new, are never deleted.
5. **Verify** by listing again. The data versions still listed are what remains; delete markers are ignored. That sets the status (`deleted`, `partial` or `failed`) and the counts. If the re-list fails, the outcome is an unverified `partial` with nothing counted as deleted.

Why the marker comes first: prod replicates to a backup bucket in another account. S3 replication carries **delete markers** (a delete with no `VersionId`) but **never** carries version-specific deletes. Deleting every version by `VersionId`, as the CRM did before, left the backup's copy current forever. The marker reaches the backup, makes its copy noncurrent, and the backup's lifecycle rule then erases it.

After a delete, `list-object-versions` on a prefix shows at least one delete marker per key (older markers are kept) and no data versions. That is the expected end state.

## Backups

- **Prod replication rule** (`billie-files-prod-734836384687` → `billie-replica-files-prod-342996267425`): must have `DeleteMarkerReplication: Enabled`, and must not be filtered by tag (a tag-filtered rule cannot replicate delete markers). **Rohan to confirm** with `aws s3api get-bucket-replication --bucket billie-files-prod-734836384687`. A legacy V1 rule (a top-level `Prefix`, no `Filter`) replicates delete markers by default and has no `DeleteMarkerReplication` element, so its absence is not a failure on such a rule. A bucket with replication configured cannot have versioning suspended, so the marker is always a real, replicable version there.
- **Backup lifecycle rule** (on `billie-replica-files-prod-342996267425`): noncurrent versions expire 180 days after they become noncurrent (`NoncurrentVersionExpiration: { NoncurrentDays: 180 }`), plus expired-delete-marker cleanup (`ExpiredObjectDeleteMarker: true`). The backup's 30-day Governance-mode Object Lock delays the expiry of a version until its lock ends.
- **When an erasure is complete:** at once in Billie's bucket. In the backup, after 180 days once the marker has replicated: lifecycle runs asynchronously after the due date and can add a few days, so there is no exact deadline.

### Urgent erasure runbook (backup bucket)

When a copy must leave the backup before 180 days, a backup-account admin does it by hand. It needs `s3:ListBucketVersions`, `s3:DeleteObjectVersion` and `s3:BypassGovernanceRetention` in the backup account.

```bash
# 1. List the key's versions (use the keys from the statement-file-deletions row)
aws s3api list-object-versions --bucket billie-replica-files-prod-342996267425 \
  --prefix customer/<applicationNumber>/statements/
aws s3api list-object-versions --bucket billie-replica-files-prod-342996267425 \
  --prefix customer/<applicationNumber>/AffordabilityReports/

# 2. Delete each data version by VersionId, bypassing the Governance lock
aws s3api delete-object --bucket billie-replica-files-prod-342996267425 \
  --key <key> --version-id <versionId> --bypass-governance-retention
```

Versions in Glacier Deep Archive can be deleted without restoring them first. Deleting them before their 180-day minimum storage duration incurs an early-deletion charge.

### Verify the first prod deletion

After the first prod deletion, list the versions of one deleted key in the backup bucket and confirm a delete marker arrived:

```bash
aws s3api list-object-versions --bucket billie-replica-files-prod-342996267425 \
  --prefix <one deleted key from the log row>
```

Expect a `DeleteMarkers` entry with `IsLatest: true` and the data version(s) under `Versions` with `IsLatest: false`. This also confirms the marker replicates even though the data versions in prod were deleted right after it. If no marker arrives, check the replication rule above before any further deletions.

## Bucket check

Status: **not yet run.** The machine this was written on has no AWS credentials. Rohan to run these (read-only) before the first deletion, for both buckets (`billie-files-prod-734836384687`, `billie-applications-nonprod`):

```bash
aws s3api get-bucket-versioning --bucket <bucket>
aws s3api get-object-lock-configuration --bucket <bucket>
aws s3api get-bucket-replication --bucket <bucket>
```

Key-layout spot check:

```bash
# prod: use a recent application number
aws s3api list-objects-v2 --bucket billie-files-prod-734836384687 \
  --prefix customer/<a recent application number>/ --max-keys 20
# demo
aws s3api list-objects-v2 --bucket billie-applications-nonprod \
  --prefix demo/<a recent application number>/ --max-keys 20
```

Expect `statements/` and `AffordabilityReports/` children. If the layout differs, stop and report.

What the results mean:

- Object Lock configured, or `MFADelete: Enabled` in the versioning output: deletion cannot work. Stop.
- Replication configured: check it against "Backups" above (delete-marker replication on, no tag filter).
- A bucket-policy explicit Deny on these actions overrides the IAM grant below. Check the bucket policy for one.
- Versioning on or off makes no difference to the permissions needed (see next section).

## IAM policy

Applies to the CRM's own IAM user in each account (its keys are Fly secrets used by the CRM alone).

The code places a delete marker with a plain delete (no `VersionId`), then deletes each data version by `VersionId`, including the literal `null` version on an unversioned bucket. IAM is unchanged by the marker step: `s3:DeleteObject` covers the marker, and `s3:DeleteObjectVersion` covers the version deletes. `s3:DeleteObjectVersion` and `s3:ListBucketVersions` are always required, not only when versioning is on. AWS authorises each key in a `DeleteObjects` call individually, against `s3:DeleteObject` or `s3:DeleteObjectVersion`; there is no separate permission for `DeleteObjects`.

### Demo (`billie-applications-nonprod`, base `demo`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListStatementPrefixes",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:ListBucketVersions"],
      "Resource": "arn:aws:s3:::billie-applications-nonprod",
      "Condition": { "StringLike": { "s3:prefix": ["demo/*"] } }
    },
    {
      "Sid": "DeleteStatementFiles",
      "Effect": "Allow",
      "Action": ["s3:DeleteObject", "s3:DeleteObjectVersion"],
      "Resource": [
        "arn:aws:s3:::billie-applications-nonprod/demo/*/statements/*",
        "arn:aws:s3:::billie-applications-nonprod/demo/*/AffordabilityReports/*"
      ]
    }
  ]
}
```

### Prod (`billie-files-prod-734836384687`, base `customer`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListStatementPrefixes",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:ListBucketVersions"],
      "Resource": "arn:aws:s3:::billie-files-prod-734836384687",
      "Condition": { "StringLike": { "s3:prefix": ["customer/*"] } }
    },
    {
      "Sid": "DeleteStatementFiles",
      "Effect": "Allow",
      "Action": ["s3:DeleteObject", "s3:DeleteObjectVersion"],
      "Resource": [
        "arn:aws:s3:::billie-files-prod-734836384687/customer/*/statements/*",
        "arn:aws:s3:::billie-files-prod-734836384687/customer/*/AffordabilityReports/*"
      ]
    }
  ]
}
```

Notes:

- If one nonprod IAM user also serves staging (base `customer` in the same nonprod bucket), add `"customer/*"` to the `s3:prefix` list and add the two `customer/...` delete ARNs (`.../customer/*/statements/*` and `.../customer/*/AffordabilityReports/*`).
- `*` in an S3 resource ARN also matches `/`. The grant is therefore any key with a `/statements/` or `/AffordabilityReports/` segment under the base, not only the direct children of an application folder. The application code checks prefixes more tightly.

## Rollout

1. Apply the IAM policies above (demo user first, prod user before step 6).
2. Deploy demo: `make -C infra/fly deploy ENV=demo`. `S3_STATEMENT_BASE_FOLDER` comes from `infra/fly/fly.demo.toml`. The deploy also applies the `statement_file_deletions` migration.
3. In demo, delete a test application's statement files from the CRM.
4. Verify both prefixes hold no data versions. A delete marker per key is expected and stays:
   ```bash
   aws s3api list-object-versions --bucket billie-applications-nonprod --prefix demo/<app>/statements/
   aws s3api list-object-versions --bucket billie-applications-nonprod --prefix demo/<app>/AffordabilityReports/
   ```
5. In the admin, open `statement-file-deletions` and check the log row (status `deleted`, counts and keys match).
6. Prod: confirm the replication rule and the backup lifecycle rule (see "Backups"), then `make -C infra/fly deploy ENV=prod CONFIRM=1`. Delete Rohan's own applications, then verify again with the same two commands against `billie-files-prod-734836384687` and prefix `customer/<app>/...`.
7. Prod backup: run "Verify the first prod deletion" above.

## Known gaps

- Backup copies: erased by the backup's lifecycle rule after 180 days (plus however long lifecycle takes to run), not at once. Use the urgent erasure runbook when that is too slow. Any backup other than the replica bucket (none known) is not touched.
- The non-goals listed under "What gets deleted, and what is kept": the affordability summary, account-holder names, assessment records, provider-held data, other S3 folders including `StatementCapture/`, and Redis.
