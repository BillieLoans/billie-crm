#!/bin/bash
set -e

# Keycloak Deployment Script for Fly.io
# Usage: ./deploy.sh <environment> [--skip-secrets]
# Environment: nonprod | prod
# --skip-secrets: skip secrets check (use when deploying to existing instance with secrets already set)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV="${1:-}"
SKIP_SECRETS="${2:-}"

if [[ -z "$ENV" ]]; then
    echo "Usage: $0 <environment> [--skip-secrets]"
    echo "  environment: nonprod | prod"
    echo "  --skip-secrets: skip secrets verification (for existing instances)"
    exit 1
fi

if [[ "$ENV" != "nonprod" && "$ENV" != "prod" ]]; then
    echo "Error: Invalid environment '$ENV'. Must be 'nonprod' or 'prod'"
    exit 1
fi

APP_NAME="billie-keycloak-$ENV"
CONFIG_FILE="$SCRIPT_DIR/$ENV/fly.toml"

echo "=========================================="
echo "Deploying Keycloak to: $APP_NAME"
echo "Config file: $CONFIG_FILE"
echo "=========================================="

# Check if app exists
if ! fly apps list | grep -q "$APP_NAME"; then
    echo ""
    echo "App '$APP_NAME' does not exist. Creating..."
    fly apps create "$APP_NAME"
    
    echo ""
    echo "Creating Postgres database for $APP_NAME..."
    DB_NAME="$APP_NAME-db"
    
    if [[ "$ENV" == "prod" ]]; then
        # Production: larger database
        fly postgres create --name "$DB_NAME" --region syd --vm-size shared-cpu-1x --volume-size 10
    else
        # Non-prod: smaller database
        fly postgres create --name "$DB_NAME" --region syd --vm-size shared-cpu-1x --volume-size 1
    fi
    
    echo ""
    echo "=========================================="
    echo "IMPORTANT: Set secrets before deploying!"
    echo "=========================================="
    echo ""
    echo "Run these commands to set up secrets:"
    echo ""
    echo "  fly secrets set KC_BOOTSTRAP_ADMIN_USERNAME=admin -a $APP_NAME"
    echo "  fly secrets set KC_BOOTSTRAP_ADMIN_PASSWORD=<secure-password> -a $APP_NAME"
    echo ""
    echo "Then attach the database:"
    echo ""
    echo "  fly postgres attach $DB_NAME -a $APP_NAME"
    echo ""
    echo "After setting secrets, run this script again to deploy."
    exit 0
fi

# Check if secrets are set (unless --skip-secrets)
if [[ "$SKIP_SECRETS" != "--skip-secrets" ]]; then
    echo ""
    echo "Checking secrets..."
    SECRETS=$(fly secrets list -a "$APP_NAME" 2>/dev/null || echo "")

    if ! echo "$SECRETS" | grep -q "KC_BOOTSTRAP_ADMIN_USERNAME"; then
        echo ""
        echo "WARNING: KC_BOOTSTRAP_ADMIN_USERNAME secret not set!"
        echo "Run: fly secrets set KC_BOOTSTRAP_ADMIN_USERNAME=admin -a $APP_NAME"
        echo "Or use: $0 $ENV --skip-secrets to deploy without checking (existing instance)."
        exit 1
    fi

    if ! echo "$SECRETS" | grep -q "KC_BOOTSTRAP_ADMIN_PASSWORD"; then
        echo ""
        echo "WARNING: KC_BOOTSTRAP_ADMIN_PASSWORD secret not set!"
        echo "Run: fly secrets set KC_BOOTSTRAP_ADMIN_PASSWORD=<secure-password> -a $APP_NAME"
        echo "Or use: $0 $ENV --skip-secrets to deploy without checking (existing instance)."
        exit 1
    fi
else
    echo ""
    echo "Skipping secrets check (--skip-secrets)."
fi

# Deploy
echo ""
echo "Deploying..."
cd "$SCRIPT_DIR"
fly deploy --config "$CONFIG_FILE" --app "$APP_NAME"

echo ""
echo "=========================================="
echo "Deployment complete!"
echo "=========================================="
echo ""
echo "Keycloak URL: https://$APP_NAME.fly.dev"
echo "Admin Console: https://$APP_NAME.fly.dev/admin"
echo ""
echo "=========================================="
echo "SECURITY: Post-deployment hardening"
echo "=========================================="
echo ""
echo "Run the admin hardening script to remove default admin user:"
echo "  ENV=$ENV $SCRIPT_DIR/scripts/harden-admin.sh"
echo ""
