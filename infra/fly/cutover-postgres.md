# Postgres Cutover Runbook

Playbook for moving a deployed billie-crm environment from MongoDB to Postgres (Neon). The code on `main` is already on the Postgres branch.

**Everything in this runbook runs from your laptop.** Neon DSNs are publicly reachable over TLS, so `psql` + `pnpm payload migrate` work from anywhere. The only step that touches the deployed Fly container is `pg-replay-reset` (Redis is on Fly's private network) — and even that can be done via `fly proxy` from the laptop.

The deployed image is **not** required to have `pnpm`, `psql`, or `redis-cli` baked in. Older images work fine; new ones are nice-to-have for ad-hoc debugging.

---

## What gets cut over

Every domain projection (`customers`, `loan_accounts`, `conversations`, `applications`, `notifications`, `write_off_requests`) is rebuilt from scratch by replaying the Redis stream — no Mongo→pg ETL needed for those. Three collections are CRM-owned and need ETL: **`users`**, **`contact_notes`**, **`media`**.

Total downtime: **~5–10 minutes** for demo, **~10–20 minutes** for prod (most of which is the Redis stream replay).

---

## Laptop prerequisites (one-time setup)

```bash
# Postgres client
brew install postgresql       # macOS; or `apt install postgresql-client`

# Redis client (only needed for pg-replay-reset via fly proxy)
brew install redis            # or `apt install redis-tools`

# Already required for this repo
pnpm install                  # runs from the repo root
fly auth login                # flyctl auth

# Verify
psql --version
redis-cli --version
pnpm --version
fly version
```

You also need the local `billie-platform-crm` Docker container running — that's where the Python ETL executes (it has `motor` + `asyncpg` installed; your host doesn't need them).

```bash
docker compose up -d          # from the repo root
```

---

## 0. Pre-flight (do this the day before)

Idempotent. Safe to re-run.

### 0a. Provision Neon (browser)

Use the Neon UI:

1. Create a project (or branch off an existing project for non-prod envs).
2. Create role `billie_crm` with a password.
3. Create database `billie_crm` owned by that role.
4. Copy the **pooled** connection string (host has `-pooler` in it).
5. Append `?sslmode=require` if not already present. The processor refuses to start in production without TLS.

### 0b. Write the new DSN into the Fly secrets template

```bash
$EDITOR infra/fly/env/.env.<env>
#   DATABASE_URI=postgresql://billie_crm:<pwd>@ep-xxx-pooler.<region>.aws.neon.tech/billie_crm?sslmode=require
```

`make pg-migrate` and `make verify-cutover` read `DATABASE_URI` directly from this file — you don't need to export it in your shell.

### 0c. Apply the schema

```bash
make -C infra/fly pg-migrate ENV=<env>          # CONFIRM=1 for prod
```

This runs `pnpm payload migrate` from your laptop with `DATABASE_URI` pointed at the new Neon DB. Creates all 28 tables + every index + the three `afterSchemaInit` composite/compound indexes. Takes ~10 seconds on an empty DB.

> **If pg-migrate fails on a partial / out-of-sync schema** (e.g. someone ran `push:true` against the same DB by accident), wipe and retry:
> ```bash
> make -C infra/fly pg-wipe ENV=<env>      # DROP SCHEMA public CASCADE + recreate
> make -C infra/fly pg-migrate ENV=<env>
> ```

### 0d. Verify the schema is materialised

```bash
make -C infra/fly verify-cutover ENV=<env>
```

Should print ten rows, all counts `0`. If it errors with `relation "users" does not exist`, the migration in step 0c didn't run — fix that before proceeding.

---

## 1. Freeze writes

```bash
fly scale count 0 -a billie-crm-<env> --region syd
```

Watch `fly status -a billie-crm-<env>` until machines show `stopped`. Mongo is now the source of truth as of the moment you stopped traffic.

---

## 2. ETL the three CRM-owned collections

Runs the Python ETL inside the local `billie-platform-crm` Docker container (which has `motor` + `asyncpg`). Re-runnable.

```bash
# MONGO_URI must be exported — it's not in the Fly secrets template since
# Mongo is going away. Use whichever URL reaches your deployed Mongo
# from your laptop (typically `mongodb+srv://...` for Atlas, or a tunnel).
export MONGO_URI="mongodb://host.docker.internal:27017/billie-servicing"
# DATABASE_URI is read from .env.<env> automatically.

make -C infra/fly pg-etl ENV=<env>              # CONFIRM=1 for prod
# To migrate one collection at a time:
make -C infra/fly pg-etl ENV=<env> COLLECTION=users
make -C infra/fly pg-etl ENV=<env> COLLECTION=media
make -C infra/fly pg-etl ENV=<env> COLLECTION=contact_notes
```

Watch for two failure modes:

- **`UndefinedTableError: relation "users" does not exist`** → step 0c didn't run. Re-run `make pg-migrate ENV=<env>`.
- **Non-zero `skipped` count on `contact_notes`** → A `createdBy` FK couldn't resolve, usually because the referenced user wasn't in Mongo either. The script prints each skipped note's Mongo ObjectId; spot-check before continuing.

Estimated time: **30s–2min** depending on contact-notes volume.

---

## 3. Reset the Redis consumer group

Destroys the consumer group and dedup keys so the next event-processor start replays the stream from `id=0`.

Redis lives on Fly's private network — this is the **one** step that needs either `fly proxy` from your laptop or `fly ssh` into a deployed machine.

### Option A: via the deployed container (post-9ed38e1 images have `redis-cli`)

```bash
make -C infra/fly pg-replay-reset ENV=<env>     # CONFIRM=1 for prod
```

This `fly ssh`'s into the app and runs `redis-cli` there. Only works if the deployed image was built from `Dockerfile.demo` at or after commit `9ed38e1` (when `redis` was added to the base image).

### Option B: laptop with `fly proxy` (works for any image)

```bash
# In one terminal — forward the env's Redis to localhost:
fly proxy 6379:6379 -a <your-redis-app>

# In another terminal — run the reset against localhost:6379:
redis-cli -h localhost -p 6379 XGROUP DESTROY inbox:billie-servicing billie-servicing-processor
redis-cli -h localhost -p 6379 XGROUP DESTROY inbox:billie-servicing:internal billie-servicing-processor
redis-cli -h localhost -p 6379 --scan --pattern 'dedup:inbox:billie-servicing*' | xargs -L 100 redis-cli -h localhost -p 6379 DEL
```

After either path: both consumer groups are gone and dedup is clear. The processor on next start will recreate the groups at `id=0` and replay everything in the stream.

---

## 4. Flip the DATABASE_URI secret

The `.env.<env>` file already has the new Neon URL (from step 0b). Push it.

```bash
make -C infra/fly secrets ENV=<env>             # CONFIRM=1 for prod
```

Fly re-imports the secrets file. App machines pick up the new value on next start.

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

The replay takes 1–10 minutes depending on stream depth.

---

## 6. Verify

```bash
make -C infra/fly verify-cutover ENV=<env>
```

The verifier prints counts for every projection table plus the three ETL'd ones. Acceptable ranges:

- **users / contact_notes / media** — should match Mongo exactly (we ETL'd them).
- **write_off_requests** — should match Mongo (event-sourced; every event was in stream).
- **customers / loan_accounts / conversations / applications / notifications** — likely within ~5% of Mongo. Drift is expected when the Redis stream retention is shorter than the oldest Mongo doc.

A drift of 10%+ is suspicious. Compare a sample of records by natural key to look for missing IDs.

---

## 7. Smoke test in the admin UI

- `https://crm-<env>.billie.loans/admin/login` — sign in with existing creds.
- Dashboard renders; money-flow widgets show today's numbers.
- Customers list loads; open a customer with known history.
- Conversations monitor loads; paginate forward 2 pages.
- Open a known contact note; hit Amend — confirms `payload.db.updateOne` works.

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

- Decommission the Mongo cluster (`fly apps destroy billie-mongo-<env>` or equivalent).
- Remove any `MONGO_URI` references from local docs.
- Update the deploy README / wiki to point at Neon.
