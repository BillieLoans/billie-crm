# =============================================================================
# Billie CRM Fly.io Deployment Makefile
# =============================================================================
# Usage:
#   make -C infra/fly deploy ENV=dev
#   make -C infra/fly deploy ENV=prod CONFIRM=1 GITHUB_TOKEN="ghp_xxx"
#
# Required: ENV (dev|demo|staging|prod)
# Optional: CONFIRM=1 for prod, GITHUB_TOKEN for build, NO_CACHE=1 for full rebuild
# =============================================================================

SERVICE := billie-crm
VALID_ENVS := dev demo staging prod
PRIMARY_REGION := syd

FLY_ORG_PROD ?= billie-prod-865
FLY_ORG_NONPROD ?= billie-920

ifndef ENV
$(error ENV is not set. Usage: make -C infra/fly <target> ENV=dev|demo|staging|prod)
endif

ifeq ($(filter $(ENV),$(VALID_ENVS)),)
$(error Invalid ENV '$(ENV)'. Must be one of: $(VALID_ENVS))
endif

WORKTREE_ROOT := $(abspath $(CURDIR)/../..)
APP_DIR := $(WORKTREE_ROOT)
CONFIG_FILE := $(CURDIR)/fly.$(ENV).toml
SECRETS_DIR := $(CURDIR)/env
SECRETS_FILE := $(SECRETS_DIR)/.env.$(ENV)
SECRETS_EXAMPLE_FILE := $(SECRETS_DIR)/.env.$(ENV).example
APP_NAME := $(SERVICE)-$(ENV)
ORG_NAME := $(if $(filter $(ENV),prod),$(FLY_ORG_PROD),$(FLY_ORG_NONPROD))
IS_PROD := $(filter $(ENV),prod)
IMAGE_LABEL ?= $(ENV)-$(shell git -C "$(WORKTREE_ROOT)" rev-parse --short HEAD 2>/dev/null || echo manual)

define PROD_CHECK
	@if [ -n "$(IS_PROD)" ] && [ "$(CONFIRM)" != "1" ]; then \
		echo ""; \
		echo "PRODUCTION SAFETY CHECK FAILED"; \
		echo ""; \
		echo "You are attempting to run '$(1)' for production."; \
		echo "Re-run with CONFIRM=1 to continue."; \
		echo ""; \
		exit 1; \
	fi
endef

.PHONY: help info validate check-config check-secrets preflight init create-app allocate-ip ips secrets \
        secrets-list deploy deploy-local scale-count restart logs status scale ssh clean destroy \
        pg-migrate-create pg-migrate pg-wipe pg-etl pg-replay-reset verify-cutover

help:
	@echo ""
	@echo "Billie CRM Fly.io deployment"
	@echo ""
	@echo "Usage: make -C infra/fly <target> ENV=<environment>"
	@echo ""
	@echo "Environments: dev | demo | staging | prod (prod requires CONFIRM=1)"
	@echo ""
	@echo "Targets:"
	@echo "  info         Show resolved paths and app metadata"
	@echo "  validate     Validate Fly configuration"
	@echo "  create-app   Create Fly app in the correct org"
	@echo "  allocate-ip  Allocate ingress and egress IPs"
	@echo "  secrets      Import secrets from infra/fly/env/.env.<env>"
	@echo "  deploy       Deploy application (pass GITHUB_TOKEN for private SDKs)"
	@echo "  deploy-local Deploy with local Docker build"
	@echo "  scale-count  Set machine count (prod: 2 for HA; others: 1)"
	@echo "  restart      Restart application"
	@echo "  logs         Tail logs"
	@echo "  status       Show app status"
	@echo "  scale        Show scale configuration"
	@echo "  ssh          Open SSH console"
	@echo ""
	@echo "Postgres cutover (see cutover-postgres.md for the full runbook):"
	@echo "  pg-migrate-create  Generate a new migration from the current schema (local pg)"
	@echo "  pg-migrate         Apply migrations to the <env> Neon DB (from your laptop)"
	@echo "  pg-wipe            DROP SCHEMA public on the <env> Neon DB (when migrations are out of sync)"
	@echo "  pg-etl             Run mongo → pg ETL via the local dev container (needs MONGO_URI in env)"
	@echo "  pg-replay-reset    Destroy Redis consumer group + flush dedup keys for replay"
	@echo "  verify-cutover     Print pg row counts across every collection table"
	@echo ""
	@echo "Examples:"
	@echo "  make -C infra/fly deploy ENV=demo GITHUB_TOKEN=\"ghp_xxx\""
	@echo "  make -C infra/fly deploy ENV=prod CONFIRM=1 GITHUB_TOKEN=\"ghp_xxx\""
	@echo "  make -C infra/fly pg-migrate ENV=demo"
	@echo "  make -C infra/fly pg-etl ENV=demo COLLECTION=users"
	@echo "  make -C infra/fly pg-replay-reset ENV=prod CONFIRM=1"
	@echo ""

info:
	@echo ""
	@echo "Service:          $(SERVICE)"
	@echo "Environment:      $(ENV)"
	@echo "App Name:         $(APP_NAME)"
	@echo "Org Name:         $(ORG_NAME)"
	@echo "Image Label:      $(IMAGE_LABEL)"
	@echo "Primary Region:   $(PRIMARY_REGION)"
	@echo "Worktree Root:    $(WORKTREE_ROOT)"
	@echo "App Dir:          $(APP_DIR)"
	@echo "Config File:      $(CONFIG_FILE)"
	@echo "Secrets File:     $(SECRETS_FILE)"
	@echo "Secrets Template: $(SECRETS_EXAMPLE_FILE)"
	@echo ""

check-config:
	@if [ ! -f "$(CONFIG_FILE)" ]; then \
		echo "Missing config file: $(CONFIG_FILE)"; \
		exit 1; \
	fi

check-secrets:
	@if [ ! -f "$(SECRETS_FILE)" ]; then \
		echo "Missing secrets file: $(SECRETS_FILE)"; \
		echo "Copy and populate: $(SECRETS_EXAMPLE_FILE)"; \
		exit 1; \
	fi

validate: check-config
	@fly config validate -c "$(CONFIG_FILE)"

init:
	@echo ""
	@echo "Create local secret files from the templates in $(SECRETS_DIR)."
	@echo "Copy .env.<env>.example to .env.<env> and populate with values."
	@echo ""

create-app:
	$(call PROD_CHECK,create-app)
	@if fly apps list 2>/dev/null | awk '$$1 == "$(APP_NAME)" {found=1} END {exit found ? 0 : 1}'; then \
		echo "Fly app $(APP_NAME) already exists."; \
	else \
		fly apps create "$(APP_NAME)" --org "$(ORG_NAME)"; \
	fi

allocate-ip:
	$(call PROD_CHECK,allocate-ip)
	fly ips allocate-v4 --shared --app "$(APP_NAME)" || true
	fly ips allocate-v6 --app "$(APP_NAME)" || true
	fly ips allocate-egress --app "$(APP_NAME)" -r "$(PRIMARY_REGION)" || true
	fly ips list -a "$(APP_NAME)"

ips:
	fly ips list -a "$(APP_NAME)"

secrets: check-secrets
	$(call PROD_CHECK,secrets)
	@awk 'NF && $$1 !~ /^#/' "$(SECRETS_FILE)" | fly secrets import -a "$(APP_NAME)"

secrets-list:
	fly secrets list -a "$(APP_NAME)"

preflight:
	@echo "Running pre-deploy checks..."
	@cd "$(WORKTREE_ROOT)" && pnpm run typecheck
	@cd "$(WORKTREE_ROOT)" && pnpm run lint
	@echo "✓ Pre-deploy checks passed"

deploy: check-config preflight
	$(call PROD_CHECK,deploy)
	@echo ""
	@echo "Deploying $(SERVICE) to $(ENV)..."
	@echo ""
	@FLY_OPTS="--strategy rolling --image-label $(IMAGE_LABEL)"; \
	[ "$(NO_CACHE)" = "1" ] && FLY_OPTS="$$FLY_OPTS --no-cache"; \
	if [ -n "$(GITHUB_TOKEN)" ]; then \
		echo "Building with GITHUB_TOKEN (for private SDKs)"; \
		fly deploy "$(APP_DIR)" -c "$(CONFIG_FILE)" -a "$(APP_NAME)" --build-secret GITHUB_TOKEN="$(GITHUB_TOKEN)" $$FLY_OPTS; \
	else \
		echo "WARNING: GITHUB_TOKEN not set - private SDKs may not be installed"; \
		fly deploy "$(APP_DIR)" -c "$(CONFIG_FILE)" -a "$(APP_NAME)" $$FLY_OPTS; \
	fi
	@if [ -n "$(IS_PROD)" ]; then \
		echo "Ensuring prod scale: 2 machines (HA)"; \
		fly scale count 2 -a "$(APP_NAME)" --region $(PRIMARY_REGION); \
	fi
	@echo ""
	@echo "Deployment complete."
	@echo ""

deploy-local: check-config
	$(call PROD_CHECK,deploy-local)
	fly deploy "$(APP_DIR)" -c "$(CONFIG_FILE)" -a "$(APP_NAME)" --strategy rolling --image-label "$(IMAGE_LABEL)" --local-only

scale-count:
	$(call PROD_CHECK,scale-count)
	@if [ -n "$(IS_PROD)" ]; then \
		echo "Setting prod to 2 machines (HA)"; \
		fly scale count 2 -a "$(APP_NAME)" --region $(PRIMARY_REGION); \
	else \
		echo "Setting $(ENV) to 1 machine"; \
		fly scale count 1 -a "$(APP_NAME)" --region $(PRIMARY_REGION); \
	fi

restart:
	$(call PROD_CHECK,restart)
	fly apps restart "$(APP_NAME)"

logs:
	fly logs -a "$(APP_NAME)"

status:
	fly status -a "$(APP_NAME)"

scale:
	fly scale show -a "$(APP_NAME)"

ssh:
	$(call PROD_CHECK,ssh)
	fly ssh console -a "$(APP_NAME)"

clean:
	@echo "No generated artifacts to clean."

destroy:
	$(call PROD_CHECK,destroy)
	@echo "Type $(APP_NAME) to confirm destruction:"; \
	read confirm; \
	if [ "$$confirm" = "$(APP_NAME)" ]; then \
		fly apps destroy "$(APP_NAME)" -y; \
	else \
		echo "Confirmation failed. Aborting."; \
		exit 1; \
	fi

# =============================================================================
# Postgres cutover targets — see cutover-postgres.md for the full runbook.
#
# All targets run FROM YOUR LAPTOP against the env's Neon DSN, which they
# read out of infra/fly/env/.env.<env>. The deployed Fly container is NOT
# touched (no `fly ssh` inside these). Reasons:
#   - Neon DSNs are publicly reachable over TLS, so psql + pnpm both work
#     from anywhere.
#   - The deployed image often predates the cutover tooling (no pnpm on
#     the ssh PATH, no postgresql-client baked in), and bootstrapping the
#     new image is itself part of the cutover — chicken-and-egg.
#   - Redis IS on Fly's private network; pg-replay-reset documents using
#     `fly proxy` from the laptop or `fly ssh console` once the new image
#     is deployed.
#
# Required on your laptop:
#   - pnpm        (already required to dev this repo)
#   - psql        `brew install postgresql` / `apt install postgresql-client`
#   - redis-cli   `brew install redis` / `apt install redis-tools`
#   - flyctl      (already required to deploy)
# =============================================================================

# Pull DATABASE_URI out of the env file the same way `make secrets` will
# import it. Honours `DATABASE_URI=value` and `DATABASE_URI="value"`.
DSN_FROM_ENV = $(shell awk -F= '/^DATABASE_URI=/{sub(/^DATABASE_URI=/,""); gsub(/^"|"$$/,""); print; exit}' "$(SECRETS_FILE)" 2>/dev/null)
REDIS_FROM_ENV = $(shell awk -F= '/^REDIS_URL=/{sub(/^REDIS_URL=/,""); gsub(/^"|"$$/,""); print; exit}' "$(SECRETS_FILE)" 2>/dev/null)

# Generate a new Payload migration capturing schema drift. Run against a
# LOCAL Postgres that already has the previous migrations applied. The
# generated files go in src/migrations/ and are committed to git.
pg-migrate-create:
	@if [ -z "$$DATABASE_URI" ]; then \
		echo "Set DATABASE_URI to a local Postgres before running pg-migrate-create."; \
		exit 1; \
	fi
	@cd "$(WORKTREE_ROOT)" && pnpm payload migrate:create --name "$(or $(NAME),change)"

# Apply Payload migrations to the <env> Neon DB. Runs `pnpm payload
# migrate` from your laptop with DATABASE_URI sourced from .env.<env>.
pg-migrate: check-secrets
	$(call PROD_CHECK,pg-migrate)
	@DSN='$(DSN_FROM_ENV)'; \
	if [ -z "$$DSN" ]; then \
		echo "DATABASE_URI not found in $(SECRETS_FILE)"; \
		exit 1; \
	fi; \
	echo "Applying Payload migrations to $(ENV) Postgres…"; \
	cd "$(WORKTREE_ROOT)" && \
	DATABASE_URI="$$DSN" PAYLOAD_SECRET="cutover-migrate" pnpm payload migrate

# Print row counts for every projection + CRM-owned table. Reads
# DATABASE_URI from .env.<env> and runs psql locally.
verify-cutover: check-secrets
	@DSN='$(DSN_FROM_ENV)'; \
	if [ -z "$$DSN" ]; then \
		echo "DATABASE_URI not found in $(SECRETS_FILE)"; \
		exit 1; \
	fi; \
	echo "Counting rows on $(ENV) Postgres…"; \
	psql "$$DSN" -c "SELECT 'users' AS tbl, COUNT(*) FROM users UNION ALL \
SELECT 'customers', COUNT(*) FROM customers UNION ALL \
SELECT 'loan_accounts', COUNT(*) FROM loan_accounts UNION ALL \
SELECT 'schedule_payments', COUNT(*) FROM loan_accounts_repayment_schedule_payments UNION ALL \
SELECT 'conversations', COUNT(*) FROM conversations UNION ALL \
SELECT 'applications', COUNT(*) FROM applications UNION ALL \
SELECT 'notifications', COUNT(*) FROM notifications UNION ALL \
SELECT 'write_off_requests', COUNT(*) FROM write_off_requests UNION ALL \
SELECT 'contact_notes', COUNT(*) FROM contact_notes UNION ALL \
SELECT 'media', COUNT(*) FROM media ORDER BY tbl;"

# Wipe the public schema on the <env> Neon DB. Used when a previous
# pg-migrate left the schema half-applied or out of sync with the
# committed migration files. DESTRUCTIVE — gated by CONFIRM=1 on prod.
pg-wipe: check-secrets
	$(call PROD_CHECK,pg-wipe)
	@DSN='$(DSN_FROM_ENV)'; \
	if [ -z "$$DSN" ]; then \
		echo "DATABASE_URI not found in $(SECRETS_FILE)"; \
		exit 1; \
	fi; \
	echo "About to DROP SCHEMA public CASCADE on $(ENV) Postgres."; \
	echo "Press Ctrl+C now if this is not what you want, otherwise enter to continue."; \
	read _; \
	psql "$$DSN" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Destroy the Redis consumer group and flush dedup keys so the next
# event-processor start replays the stream from id=0. Run AFTER ETL is
# complete and BEFORE flipping the DATABASE_URI secret.
#
# Redis lives on Fly's private network, so we either:
#   - run from a laptop with `fly proxy` (REDIS_FORWARD=1 below), or
#   - shell into a deployed machine that has redis-cli (the new image
#     does; older ones don't — re-deploy first if needed).
#
# REDIS_FORWARD=1 spins up `fly proxy` for the duration of this target.
# Otherwise we use `fly ssh console` which expects redis-cli in the
# deployed image (post-9ed38e1).
pg-replay-reset: check-secrets
	$(call PROD_CHECK,pg-replay-reset)
	@if [ "$(REDIS_FORWARD)" = "1" ]; then \
		REDIS='$(REDIS_FROM_ENV)'; \
		if [ -z "$$REDIS" ]; then \
			echo "REDIS_URL not found in $(SECRETS_FILE)"; \
			exit 1; \
		fi; \
		echo "REDIS_FORWARD=1 — assuming you've started 'fly proxy' against the env's Redis"; \
		echo "and that redis-cli is available locally."; \
		echo "Run this in a separate terminal first:"; \
		echo "  fly proxy 6379:6379 -a <your-redis-app>"; \
		echo ""; \
		echo "Then re-run this with REDIS_URL pointed at localhost."; \
		exit 1; \
	fi
	@echo "Destroying consumer groups + flushing dedup keys on $(APP_NAME) (via fly ssh)…"
	@fly ssh console -a "$(APP_NAME)" -C "sh -lc '\
		set -e; \
		echo \"[reset] XGROUP DESTROY (external)\"; \
		redis-cli -u \"$$REDIS_URL\" XGROUP DESTROY inbox:billie-servicing billie-servicing-processor || true; \
		echo \"[reset] XGROUP DESTROY (internal)\"; \
		redis-cli -u \"$$REDIS_URL\" XGROUP DESTROY inbox:billie-servicing:internal billie-servicing-processor || true; \
		echo \"[reset] Deleting dedup keys\"; \
		redis-cli -u \"$$REDIS_URL\" --scan --pattern \"dedup:inbox:billie-servicing*\" | xargs -L 100 redis-cli -u \"$$REDIS_URL\" DEL >/dev/null 2>&1 || true; \
		echo \"[reset] Done.\"\
	'"

# Run the Mongo → Postgres ETL using the local dev container (which has
# motor + asyncpg in its Python). Reads DATABASE_URI from .env.<env> and
# expects MONGO_URI to be exported in the caller's shell (it's not in
# the Fly secrets template since Mongo is going away).
pg-etl: check-secrets
	$(call PROD_CHECK,pg-etl)
	@if [ -z "$$MONGO_URI" ]; then \
		echo "Export MONGO_URI in your shell first, e.g.:"; \
		echo "  export MONGO_URI=\"mongodb://host.docker.internal:27017/billie-servicing\""; \
		exit 1; \
	fi
	@DSN='$(DSN_FROM_ENV)'; \
	if [ -z "$$DSN" ]; then \
		echo "DATABASE_URI not found in $(SECRETS_FILE)"; \
		exit 1; \
	fi; \
	echo "Running ETL against $(ENV) Postgres for $(or $(COLLECTION),all)…"; \
	docker exec billie-platform-crm python3 /app/scripts/etl-mongo-to-pg.py \
		--mongo "$$MONGO_URI" \
		--pg "$$DSN" \
		--collection "$(or $(COLLECTION),all)"
