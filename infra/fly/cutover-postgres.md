# Postgres Cutover Runbook

This is the playbook for moving a deployed billie-crm environment from MongoDB to Postgres (Neon). It assumes the code on `main` is already on the Postgres branch — Phases 1–4 + 6 in `~/.claude/plans/ok-plan-out-this-lovely-flute.md`.

Run this in order. Each step has a single `make` target and a single visible side-effect; if anything looks wrong, **stop** and fall back to "Rollback" at the bottom.

## What gets cut over

Every domain projection (`customers`, `loan_accounts`, `conversations`, `applications`, `notifications`, `write_off_requests`) is rebuilt from scratch by replaying the Redis stream — no Mongo→pg ETL needed for those. Three collections are CRM-owned and need ETL: **`users`**, **`contact_notes`**, **`media`**.

Total downtime: **~5–10 minutes** for demo, **~10–20 minutes** for prod (most of which is the Redis stream replay).

---

## 0. Pre-flight (do this the day before)

Done once per environment. Idempotent — safe to re-run.

```bash
# Provision the Neon database. We don't script this — use the Neon UI:
#   1. Create a project (or branch off an existing project)
#   2. Create role `billie_crm` with a password
#   3. Create database `billie_crm` owned by that role
#   4. Note the pooled connection string (host has `-pooler` in it).
#      It MUST include sslmode=require — the processor refuses to start
#      otherwise in production.

# Update the Fly secrets template with the new DSN
$EDITOR infra/fly/env/.env.<env>
#   → DATABASE_URI=postgresql://billie_crm:<pwd>@ep-xxx-pooler.<region>.aws.neon.tech/billie_crm?sslmode=require

# Apply the schema before cutover (push:false in prod — uses migration files).
make -C infra/fly pg-migrate ENV=<env>   # for prod add CONFIRM=1
#   → fly ssh into the app, runs `pnpm payload migrate`
#   → creates all 28 tables + indexes + afterSchemaInit composite uniques
#   → takes ~10 seconds on an empty Neon DB

# Sanity check
make -C infra/fly verify-cutover ENV=<env>
#   → prints pg row counts. All zeros at this stage — that's expected.
```

If the `pg-migrate` step fails on a partial schema (e.g. you ran `push:true` against the same DB by accident), wipe and retry: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` via psql, then re-run.

---

## 1. Freeze writes

```bash
# Demo or prod, scale the app to 0 so nothing new writes to Mongo.
fly scale count 0 -a billie-crm-<env> --region syd
```

Watch `fly status` until both machines show `stopped`. Mongo is now the source of truth as of the moment you stopped traffic.

---

## 2. ETL the three CRM-owned collections

This pulls from Mongo and lands in Neon. Re-runnable.

```bash
# Run from a machine that can reach both Mongo and Neon. Easiest is the
# stopped Fly app machine — `fly machine start` one of them in maintenance
# mode (no public traffic) and `fly ssh console`.

# Inside the machine:
python3 /app/scripts/etl-mongo-to-pg.py \
    --mongo "$MONGO_URI" \
    --pg    "$DATABASE_URI" \
    --collection all
```

Expected output: a per-collection migrated/skipped count. Investigate any non-zero `skipped` count on `contact_notes` (usually means a `createdBy` FK couldn't resolve — typically because the matching user wasn't in Mongo either).

Estimated time: **30s–2min** depending on contact-notes volume.

---

## 3. Reset the Redis consumer group

This is what triggers projection rebuild — destroying the consumer group makes the next processor start from `id=0` of each stream.

```bash
make -C infra/fly pg-replay-reset ENV=<env>   # CONFIRM=1 for prod
```

What it runs (inside `fly ssh`):

```
XGROUP DESTROY inbox:billie-servicing billie-servicing-processor
XGROUP DESTROY inbox:billie-servicing:internal billie-servicing-processor
# plus delete all dedup:inbox:billie-servicing:* keys
```

After this, both consumer groups are gone and dedup is clear. The processor on next start will recreate the groups at `id=0` and replay everything in the stream.

---

## 4. Flip the DATABASE_URI secret

The `.env.<env>` file already has the new Neon URL (from step 0). Push it.

```bash
make -C infra/fly secrets ENV=<env>   # CONFIRM=1 for prod
```

Fly re-imports the secrets. App machines pick it up on next start.

---

## 5. Bring the app back

```bash
fly scale count 1 -a billie-crm-<env> --region syd
# prod: 2 for HA
fly scale count 2 -a billie-crm-prod --region syd
```

Watch logs:

```bash
make -C infra/fly logs ENV=<env>
```

Expected sequence (within ~30s):

1. `Connecting to Redis...` → `Connected to Redis ✓`
2. `Connecting to Postgres...` → `Connected to Postgres ✓`
3. `Setting up consumer groups...` (recreates the groups we destroyed)
4. `Processing any pending messages...` (none — we cleared them)
5. `Event processor started`
6. `📥 [external] Received event: ...` for each event in the stream (8k+ on prod)

The replay takes 1–10 minutes depending on stream depth. Watch the row counts climb in step 6 below.

---

## 6. Verify

```bash
# Print pg row counts side-by-side with whatever you captured from Mongo
# pre-cutover (e.g. `mongoexport --quiet --collection X | wc -l`).
make -C infra/fly verify-cutover ENV=<env>
```

The verifier prints counts for every projection table plus the three ETL'd ones. Acceptable ranges:

- **users / contact_notes / media** — should match Mongo exactly (we ETL'd them)
- **write_off_requests** — should match Mongo (event-sourced, but every event was in stream)
- **customers / loan_accounts / conversations / applications / notifications** — likely within ~5% of Mongo. Drift is expected when the Redis stream retention is shorter than the oldest Mongo doc.

A drift of 10%+ is suspicious. Compare a sample of records by natural key to look for missing IDs.

---

## 7. Smoke test in the admin UI

- `https://crm-<env>.billie.loans/admin/login` — sign in with existing creds
- Dashboard renders, money-flow widgets have today's numbers
- Customers list loads, open a customer with known history
- Conversations monitor loads, paginate forward 2 pages
- Open a known contact note, hit Amend — confirms `payload.db.updateOne` works

---

## Rollback

If anything above goes wrong, flip back:

```bash
# 1. Edit infra/fly/env/.env.<env>: set DATABASE_URI back to the Mongo URL
$EDITOR infra/fly/env/.env.<env>

# 2. Push the secrets again
make -C infra/fly secrets ENV=<env>

# 3. Restart
make -C infra/fly restart ENV=<env>
```

Both DBs persist independently — the cutover is non-destructive on the Mongo side. Don't drop the Mongo cluster until you've had 1 week of stable Postgres operation.

---

## After 1 week of green

- Decommission the Mongo cluster (`fly apps destroy billie-mongo-<env>` or equivalent, depending on how it was hosted).
- Remove the `MONGO_URI` env var entry from `infra/fly/env/.env.<env>`.
- Update the deploy README / wiki to point at Neon.
