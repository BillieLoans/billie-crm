# Postgres Setup & Cutover Runbook

Two flows in here:

- **Greenfield environment setup** — standing up a brand-new env that has never had Mongo (fresh prod, fresh dev for a new business unit, etc.). Jump to [Greenfield environment setup](#greenfield-environment-setup) below.
- **Cutover from an existing Mongo-backed env to Postgres (Neon)** — the original migration playbook. Start at [Laptop prerequisites](#laptop-prerequisites-one-time-setup) and walk through steps 0–7.

**Everything in this runbook runs from your laptop.** Neon DSNs are publicly reachable over TLS, so `psql` + `pnpm payload migrate` work from anywhere. The only step that touches the deployed Fly container is `pg-replay-reset` (Redis is on Fly's private network) — and even that can be done via `fly proxy` from the laptop.

The deployed image is **not** required to have `pnpm`, `psql`, or `redis-cli` baked in. Older images work fine; new ones are nice-to-have for ad-hoc debugging.

---

## What gets cut over

Every domain projection (`customers`, `loan_accounts`, `conversations`, `applications`, `notifications`, `write_off_requests`) is rebuilt from scratch by replaying the Redis stream — no Mongo→pg ETL needed for those. Three collections are CRM-owned and need ETL: **`users`**, **`contact_notes`**, **`media`**.

Total downtime: **~5–10 minutes** for demo, **~10–20 minutes** for prod (most of which is the Redis stream replay).

---

## Greenfield environment setup

For a brand-new environment with no Mongo to migrate from. No ETL, no Redis replay, no downtime windows — just provision, configure, deploy, create the first admin user.

### G0. Laptop prerequisites

Same as the cutover flow — see [Laptop prerequisites](#laptop-prerequisites-one-time-setup) below.

### G1. Provision Neon (browser)

1. Create a project (or branch off an existing project for non-prod).
2. Create role `billie_crm` with a strong password.
3. Create database `billie_crm` owned by that role.
4. Copy the **pooled** connection string (host has `-pooler` in it).
5. Append `?sslmode=require` if not present. Production refuses to start without TLS.

### G2. Provision Redis

Fresh envs need a Redis instance too (event-processor reads/writes there). Use whichever managed Redis your other envs use — e.g. a new Redis Cloud database, or a Fly Upstash Redis app. Note the `rediss://` URL.

### G3. Write secrets into the Fly template

```bash
$EDITOR infra/fly/env/.env.<env>
```

Required keys:

```
DATABASE_URI=postgresql://billie_crm:<pwd>@ep-xxx-pooler.<region>.aws.neon.tech/billie_crm?sslmode=require
REDIS_URL=rediss://<user>:<pwd>@<host>:<port>
PAYLOAD_SECRET=<32-byte hex; openssl rand -hex 32>
# plus the env-specific values your other .env.<env> files have
# (NEXT_PUBLIC_APP_URL, AWS_*, LEDGER_SERVICE_URL, etc.)
```

### G4. Create the Fly app + push secrets

```bash
make -C infra/fly create-app   ENV=<env>   # one-shot
make -C infra/fly allocate-ip  ENV=<env>   # one-shot
make -C infra/fly secrets      ENV=<env>   # CONFIRM=1 for prod
```

### G5. Apply the schema BEFORE the first deploy

The deployed app boots with `push: false` in production and expects every table to exist. If you skip this, the first request fails with `relation "users" does not exist`.

```bash
make -C infra/fly pg-migrate    ENV=<env>   # CONFIRM=1 for prod
make -C infra/fly verify-cutover ENV=<env>   # should print all-zero counts
```

### G6. Deploy (with the SDK build secret!)

The Python event-processor depends on private GitHub-hosted SDKs. The Dockerfile only installs them when `GITHUB_TOKEN` is passed as a build secret — and **silently skips** the install if it's missing. That's the cause of the `ModuleNotFoundError: No module named 'billie_accounts_events'` you'll otherwise see at runtime.

```bash
make -C infra/fly deploy ENV=<env> CONFIRM=1 GITHUB_TOKEN="$GITHUB_TOKEN" NO_CACHE=1
```

`NO_CACHE=1` busts any stale BuildKit layer from a previous tokenless build attempt. Watch the build output for `Installing Billie SDKs from requirements.txt (with GITHUB_TOKEN)...` — that's the good path. `⚠️ GITHUB_TOKEN not set, skipping SDK install` means the deploy is still broken; rerun with the token set in your shell.

After the deploy, double-check via SSH:

```bash
fly ssh console -a billie-crm-<env> -C "ls /pip-packages | grep billie"
# expect: billie_accounts_events, billie_customers_events,
#         billie_notifications_events, billie_aging_events,
#         billie_ledger_events
```

### G7. Create the first admin user

```
https://crm-<env>.billie.loans/admin/create-first-user
```

Payload's UI guides you through it. From there the admin can invite further users via `/admin/collections/users`.

### G8. (Optional) Seed users from another environment

Two paths depending on the source:

**From an existing Mongo prod** (you're standing up the *new* prod alongside an old Mongo prod, before retiring the latter):

```bash
export MONGO_URI="mongodb+srv://<source>/billie-servicing"
make -C infra/fly pg-etl ENV=<env> CONFIRM=1 COLLECTION=users
```

The ETL preserves `salt` + `hash` verbatim, so existing passwords keep working.

**From another Postgres** (e.g. copying admin users from staging to prod):

```bash
pg_dump "<source Neon DSN>" --data-only --table users --column-inserts \
  | psql "<target Neon DSN>"
```

Either is idempotent on the `email` natural key.

### G9. Smoke test

- `/admin/login` — sign in with the admin you just created.
- `/admin/dashboard` — dashboard widgets render (money-flow widgets read from `loan_accounts` which will be empty on a new env, so values will be zero — that's correct).
- `/admin/collections/contact-notes/create` — create a contact note linked to no customer; should save (with whatever access controls you have, may need a customer first).

That's it — a fresh env is live on Postgres with no Mongo dependency.

---

## Cutover-from-Mongo flow

The rest of this document assumes you're migrating an *existing* Mongo-backed environment. Greenfield envs (above) don't need any of this.

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

The cutover is also when you deploy the new code (Postgres adapter + asyncpg-based event-processor). **The deploy MUST pass `GITHUB_TOKEN`** — the Dockerfile installs the Billie event SDKs from a private GitHub repo at build time, and skips them silently if the token isn't provided. Without the SDKs, the event-processor will crash at startup with `ModuleNotFoundError: No module named 'billie_accounts_events'`.

```bash
make -C infra/fly deploy ENV=<env> GITHUB_TOKEN="ghp_xxx"
# prod: add CONFIRM=1
```

Verify the build output includes `Installing Billie Event SDKs...` (not `GITHUB_TOKEN not set, skipping SDK install`). If you see the latter, redeploy with the token set.

Then scale machines back up:

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

> **Sanity check before declaring success.** If you see any of these, the deploy is broken and you should rollback:
> - `MongoDB configuration error (fatal — check DATABASE_URI)` → old image still running, redeploy.
> - `ModuleNotFoundError: No module named 'billie_accounts_events'` → SDKs not installed, redeploy with `GITHUB_TOKEN`.
> - `Event Processor failed to start (check if SDKs are installed)` → same; the start.sh fallback letting Next.js run alone is a tell-tale.

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
