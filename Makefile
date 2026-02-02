# =============================================================================
# Fly.io Deployment Makefile
# =============================================================================
# Usage:
#   make deploy ENV=dev
#   make deploy ENV=prod CONFIRM=1
#
# Required environment variables:
#   ENV - Target environment (dev|demo|staging|prod)
#
# Optional environment variables:
#   CONFIRM - Required for production operations (set to 1)
#   FLY_API_TOKEN - Fly.io API token (for CI/CD)
# =============================================================================

# Service configuration
SERVICE := billie-crm
PRIMARY_REGION := syd

# =============================================================================
# Validation and derived variables
# =============================================================================

# Valid environments
VALID_ENVS := dev demo staging prod

# Validate ENV is set
ifndef ENV
$(error ENV is not set. Usage: make <target> ENV=dev|demo|staging|prod)
endif

# Validate ENV is valid
ifeq ($(filter $(ENV),$(VALID_ENVS)),)
$(error Invalid ENV '$(ENV)'. Must be one of: $(VALID_ENVS))
endif

# Derive app name from service and environment
APP_NAME := $(SERVICE)-$(ENV)

# Config file for this environment
CONFIG_FILE := fly.$(ENV).toml

# Secrets file for this environment
SECRETS_FILE := .env.$(ENV)

# Production safety check
PROD_ENVS := prod
IS_PROD := $(filter $(ENV),$(PROD_ENVS))

define PROD_CHECK
	@if [ -n "$(IS_PROD)" ] && [ "$(CONFIRM)" != "1" ]; then \
		echo ""; \
		echo "⛔ PRODUCTION SAFETY CHECK FAILED"; \
		echo ""; \
		echo "You are attempting to run '$(1)' on PRODUCTION environment."; \
		echo ""; \
		echo "To proceed, re-run with CONFIRM=1:"; \
		echo "  make $(1) ENV=$(ENV) CONFIRM=1"; \
		echo ""; \
		exit 1; \
	fi
endef

# =============================================================================
# Phony targets
# =============================================================================

.PHONY: help init create-app allocate-ip ips secrets deploy restart logs status \
        check-config check-secrets validate info clean

# =============================================================================
# Default target
# =============================================================================

help:
	@echo ""
	@echo "Fly.io Deployment Makefile for $(SERVICE)"
	@echo ""
	@echo "Usage: make <target> ENV=<environment>"
	@echo ""
	@echo "Environments:"
	@echo "  dev      Development environment"
	@echo "  demo     Demo/preview environment"
	@echo "  staging  Pre-production environment"
	@echo "  prod     Production environment (requires CONFIRM=1)"
	@echo ""
	@echo "Targets:"
	@echo "  init         Generate missing configuration files"
	@echo "  create-app   Create Fly app if it doesn't exist"
	@echo "  allocate-ip  Allocate fixed egress IP address"
	@echo "  ips          List allocated IP addresses"
	@echo "  secrets      Import secrets from .env.<env>"
	@echo "  deploy       Deploy application"
	@echo "  restart      Restart application"
	@echo "  logs         Tail application logs"
	@echo "  status       Show application status"
	@echo "  info         Show current configuration"
	@echo "  validate     Validate configuration files"
	@echo ""
	@echo "Examples:"
	@echo "  make deploy ENV=dev"
	@echo "  make logs ENV=staging"
	@echo "  make deploy ENV=prod CONFIRM=1"
	@echo ""

# =============================================================================
# Information targets
# =============================================================================

info:
	@echo ""
	@echo "Current Configuration"
	@echo "====================="
	@echo "Service:      $(SERVICE)"
	@echo "Environment:  $(ENV)"
	@echo "App Name:     $(APP_NAME)"
	@echo "Config File:  $(CONFIG_FILE)"
	@echo "Secrets File: $(SECRETS_FILE)"
	@echo ""

# =============================================================================
# Validation targets
# =============================================================================

check-config:
	@if [ ! -f "$(CONFIG_FILE)" ]; then \
		echo "❌ Configuration file not found: $(CONFIG_FILE)"; \
		echo "   Run 'make init ENV=$(ENV)' to generate it."; \
		exit 1; \
	fi
	@echo "✅ Configuration file exists: $(CONFIG_FILE)"

check-secrets:
	@if [ ! -f "$(SECRETS_FILE)" ]; then \
		echo "⚠️  Secrets file not found: $(SECRETS_FILE)"; \
		echo "   Copy from $(SECRETS_FILE).example and populate with values."; \
		exit 1; \
	fi
	@echo "✅ Secrets file exists: $(SECRETS_FILE)"

validate: check-config
	@echo "Validating $(CONFIG_FILE)..."
	@fly config validate -c $(CONFIG_FILE) 2>/dev/null || \
		(echo "❌ Configuration validation failed"; exit 1)
	@echo "✅ Configuration is valid"

# =============================================================================
# Initialisation targets
# =============================================================================

init:
	@echo ""
	@echo "Initialising configuration for $(ENV) environment..."
	@echo ""
	@if [ -f "$(CONFIG_FILE)" ]; then \
		echo "ℹ️  $(CONFIG_FILE) already exists, skipping."; \
	else \
		echo "⚠️  $(CONFIG_FILE) not found."; \
		echo "   Please copy from templates or create manually."; \
	fi
	@if [ -f "$(SECRETS_FILE).example" ]; then \
		echo "✅ $(SECRETS_FILE).example exists"; \
	else \
		echo "⚠️  $(SECRETS_FILE).example not found."; \
		echo "   Please create it to document required secrets."; \
	fi
	@echo ""

# =============================================================================
# App management targets
# =============================================================================

create-app:
	$(call PROD_CHECK,create-app)
	@echo ""
	@echo "Creating Fly app: $(APP_NAME)"
	@echo ""
	@if fly apps list 2>/dev/null | grep -q "^$(APP_NAME)\s"; then \
		echo "ℹ️  App $(APP_NAME) already exists."; \
	else \
		echo "Creating app $(APP_NAME)..."; \
		fly apps create $(APP_NAME) --org billie-920 || \
			(echo "❌ Failed to create app"; exit 1); \
		echo "✅ App $(APP_NAME) created successfully."; \
	fi
	@echo ""

# =============================================================================
# IP address management
# =============================================================================

allocate-ip:
	$(call PROD_CHECK,allocate-ip)
	@echo ""
	@echo "Allocating fixed egress IP for $(APP_NAME) in region $(PRIMARY_REGION)"
	@echo ""
	fly ips allocate-v4 --app $(APP_NAME) || true
	fly ips allocate-v6 --app $(APP_NAME) || true
	fly ips allocate-egress --app $(APP_NAME) -r $(PRIMARY_REGION) || \
		(echo "❌ Failed to allocate egress IP"; exit 1)
	@echo ""
	@echo "✅ Egress IP allocated successfully."
	@echo ""
	@echo "Current IPs for $(APP_NAME):"
	@fly ips list -a $(APP_NAME)
	@echo ""

ips:
	@echo ""
	@echo "IP addresses for $(APP_NAME):"
	@fly ips list -a $(APP_NAME)
	@echo ""

# =============================================================================
# Secrets management
# =============================================================================

secrets: check-secrets
	$(call PROD_CHECK,secrets)
	@echo ""
	@echo "Importing secrets for $(APP_NAME) from $(SECRETS_FILE)"
	@echo ""
	@# Filter out comments and empty lines, then import
	@grep -v '^\s*#' "$(SECRETS_FILE)" | grep -v '^\s*$$' | \
		fly secrets import -a $(APP_NAME) || \
		(echo "❌ Failed to import secrets"; exit 1)
	@echo ""
	@echo "✅ Secrets imported successfully."
	@echo ""
	@echo "Current secrets for $(APP_NAME):"
	@fly secrets list -a $(APP_NAME)
	@echo ""

secrets-list:
	@echo ""
	@echo "Secrets for $(APP_NAME):"
	@fly secrets list -a $(APP_NAME)
	@echo ""

# =============================================================================
# Deployment targets
# =============================================================================

deploy: check-config
	$(call PROD_CHECK,deploy)
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════"
	@echo "  Deploying $(SERVICE) to $(ENV)"
	@echo "═══════════════════════════════════════════════════════════════"
	@echo ""
	@echo "App Name:    $(APP_NAME)"
	@echo "Config:      $(CONFIG_FILE)"
	@echo ""
	@if [ -n "$(GITHUB_TOKEN)" ]; then \
		echo "Building with GITHUB_TOKEN (for private SDKs)"; \
		fly deploy -c $(CONFIG_FILE) -a $(APP_NAME) --build-secret GITHUB_TOKEN="$(GITHUB_TOKEN)"; \
	else \
		echo "⚠️  GITHUB_TOKEN not set - private SDKs will not be installed"; \
		fly deploy -c $(CONFIG_FILE) -a $(APP_NAME); \
	fi
	@echo ""
	@echo "═══════════════════════════════════════════════════════════════"
	@echo "  ✅ Deployment complete"
	@echo "═══════════════════════════════════════════════════════════════"
	@echo ""

deploy-local: check-config
	$(call PROD_CHECK,deploy-local)
	@echo ""
	@echo "Deploying $(APP_NAME) with local build..."
	@echo ""
	fly deploy -c $(CONFIG_FILE) -a $(APP_NAME) --local-only
	@echo ""
	@echo "✅ Local deployment complete."
	@echo ""

# =============================================================================
# Operations targets
# =============================================================================

restart:
	$(call PROD_CHECK,restart)
	@echo ""
	@echo "Restarting $(APP_NAME)..."
	@echo ""
	fly apps restart $(APP_NAME)
	@echo ""
	@echo "✅ Restart initiated."
	@echo ""

logs:
	@echo ""
	@echo "Tailing logs for $(APP_NAME)..."
	@echo "(Press Ctrl+C to stop)"
	@echo ""
	fly logs -a $(APP_NAME)

status:
	@echo ""
	@echo "Status for $(APP_NAME)"
	@echo "======================"
	@echo ""
	@fly status -a $(APP_NAME) 2>/dev/null || \
		echo "❌ App $(APP_NAME) not found or not accessible."
	@echo ""

scale:
	@echo ""
	@echo "Scale information for $(APP_NAME)"
	@echo "=================================="
	@echo ""
	@fly scale show -a $(APP_NAME) 2>/dev/null || \
		echo "❌ App $(APP_NAME) not found or not accessible."
	@echo ""

ssh:
	$(call PROD_CHECK,ssh)
	@echo ""
	@echo "Opening SSH session to $(APP_NAME)..."
	@echo ""
	fly ssh console -a $(APP_NAME)

# =============================================================================
# Cleanup targets
# =============================================================================

clean:
	@echo ""
	@echo "Cleaning up local artifacts..."
	@echo ""
	@rm -f .env.*.tmp
	@echo "✅ Cleanup complete."
	@echo ""

# =============================================================================
# Destroy (dangerous!)
# =============================================================================

destroy:
	$(call PROD_CHECK,destroy)
	@echo ""
	@echo "⚠️  WARNING: This will DESTROY the app $(APP_NAME)"
	@echo ""
	@read -p "Type the app name to confirm: " confirm && \
		if [ "$$confirm" = "$(APP_NAME)" ]; then \
			fly apps destroy $(APP_NAME) -y; \
			echo "✅ App $(APP_NAME) destroyed."; \
		else \
			echo "❌ Confirmation failed. Aborting."; \
			exit 1; \
		fi
