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
        secrets-list deploy deploy-local scale-count restart logs status scale ssh clean destroy

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
	@echo "Examples:"
	@echo "  make -C infra/fly deploy ENV=demo GITHUB_TOKEN=\"ghp_xxx\""
	@echo "  make -C infra/fly deploy ENV=prod CONFIRM=1 GITHUB_TOKEN=\"ghp_xxx\""
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
