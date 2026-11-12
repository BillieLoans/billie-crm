# Statement file deletion: IAM policy and rollout

Admins and supervisors can permanently delete a customer's bank-statement files from S3, for one application or for all of a customer's applications. Design: `docs/superpowers/specs/2026-11-12-statement-file-deletion-design.md`.

## What gets deleted, and what is kept

For each application the CRM deletes every object (all versions and delete markers) under exactly two prefixes:

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
- backups, replicas and Redis caches

Every deletion is recorded in the append-only `statement-file-deletions` collection (admin only): who, when, why, and the keys removed or failed.

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
- Replication configured: copies survive in the replica bucket. Record it as a known gap (below).
- A bucket-policy explicit Deny on these actions overrides the IAM grant below. Check the bucket policy for one.
- Versioning on or off makes no difference to the permissions needed (see next section).

## IAM policy

Applies to the CRM's own IAM user in each account (its keys are Fly secrets used by the CRM alone).

The code always deletes by `VersionId`, including the literal `null` version on an unversioned bucket. So `s3:DeleteObjectVersion` and `s3:ListBucketVersions` are always required, not only when versioning is on. AWS authorises any version-specific delete against `s3:DeleteObjectVersion`; there is no separate permission for `DeleteObjects`, and each key is authorised individually.

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
4. Verify both prefixes are empty, with no versions or delete markers left:
   ```bash
   aws s3api list-object-versions --bucket billie-applications-nonprod --prefix demo/<app>/statements/
   aws s3api list-object-versions --bucket billie-applications-nonprod --prefix demo/<app>/AffordabilityReports/
   ```
5. In the admin, open `statement-file-deletions` and check the log row (status `deleted`, counts and keys match).
6. Prod: `make -C infra/fly deploy ENV=prod CONFIRM=1`. Delete Rohan's own applications, then verify again with the same two commands against `billie-files-prod-734836384687` and prefix `customer/<app>/...`.

## Known gaps

- Replication or backups: if the bucket check shows replication, or backups exist, copies outside these buckets are not touched.
- The non-goals listed under "What gets deleted, and what is kept": the affordability summary, account-holder names, assessment records, provider-held data, other S3 folders including `StatementCapture/`, and Redis.
