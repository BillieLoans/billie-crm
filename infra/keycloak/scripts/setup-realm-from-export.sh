#!/usr/bin/env bash
# One-shot Keycloak realm setup from a realm export JSON.
# - Applies environment naming (dev|demo|staging|prod) similar to Makefile conventions
# - Rewrites realm name and billie-app URLs for the target environment
# - Imports realm into target Keycloak (create or replace)
#
# Requires: curl, jq
#
# Example:
#   KEYCLOAK_URL=https://billie-keycloak-nonprod.fly.dev \
#   ADMIN_USER=admin \
#   ADMIN_PASSWORD='...' \
#   ENV=demo \
#   EXPORT_FILE=/Users/me/Downloads/realm-export-billie-customer.json \
#   ./setup-realm-from-export.sh --replace-existing

set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-}"
ADMIN_USER="${ADMIN_USER:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
ENV_NAME="${ENV:-}"
EXPORT_FILE="${EXPORT_FILE:-}"
APP_URL="${APP_URL:-}"
REALM_BASE="${REALM_BASE:-}"
REPLACE_EXISTING=false
DRY_RUN=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  KEYCLOAK_URL=... ADMIN_USER=... ADMIN_PASSWORD=... ENV=... EXPORT_FILE=... ./setup-realm-from-export.sh [options]

Required environment variables:
  KEYCLOAK_URL   Keycloak base URL (e.g. https://billie-keycloak-nonprod.fly.dev)
  ADMIN_USER     Keycloak admin username
  ADMIN_PASSWORD Keycloak admin password
  ENV            Target environment: dev|demo|staging|prod
  EXPORT_FILE    Absolute path to realm export JSON file

Optional environment variables:
  APP_URL        App URL used for billie-app client (default: https://billie-crm-${ENV}.fly.dev)
  REALM_BASE     Base realm prefix (default: inferred from export realm by stripping -dev|-demo|-staging|-prod)

Options:
  --replace-existing  Delete existing target realm first, then import
  --dry-run           Only generate transformed JSON; do not call Keycloak API
  -h, --help          Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --replace-existing)
      REPLACE_EXISTING=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

case "$ENV_NAME" in
  dev|demo|staging|prod) ;;
  *)
    if [[ -n "$ENV_NAME" ]]; then
      echo "Invalid ENV '$ENV_NAME'. Must be one of: dev|demo|staging|prod"
      exit 1
    fi
    ;;
esac

# Load per-environment variables from infra/keycloak/.env.<env> when present.
# This allows simple invocation with just ENV and optional flags.
if [[ -n "$ENV_NAME" ]]; then
  ENV_FILE="${KEYCLOAK_DIR}/.env.${ENV_NAME}"
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  fi
fi

# Re-read after loading env file
KEYCLOAK_URL="${KEYCLOAK_URL:-}"
ADMIN_USER="${ADMIN_USER:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
ENV_NAME="${ENV:-}"
EXPORT_FILE="${EXPORT_FILE:-}"
APP_URL="${APP_URL:-}"
REALM_BASE="${REALM_BASE:-}"

if [[ -z "$KEYCLOAK_URL" || -z "$ADMIN_USER" || -z "$ADMIN_PASSWORD" || -z "$ENV_NAME" || -z "$EXPORT_FILE" ]]; then
  usage
  exit 1
fi

case "$ENV_NAME" in
  dev|demo|staging|prod) ;;
  *)
    echo "Invalid ENV '$ENV_NAME'. Must be one of: dev|demo|staging|prod"
    exit 1
    ;;
esac

# Resolve relative export path against infra/keycloak directory
if [[ "$EXPORT_FILE" != /* ]]; then
  EXPORT_FILE="${KEYCLOAK_DIR}/${EXPORT_FILE}"
fi

if [[ ! -f "$EXPORT_FILE" ]]; then
  echo "Export file not found: $EXPORT_FILE"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not installed."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but not installed."
  exit 1
fi

KEYCLOAK_URL="${KEYCLOAK_URL%/}"

SOURCE_REALM="$(jq -r '.realm // empty' "$EXPORT_FILE")"
if [[ -z "$SOURCE_REALM" ]]; then
  echo "Could not read .realm from export JSON."
  exit 1
fi

if [[ -z "$REALM_BASE" ]]; then
  REALM_BASE="$(echo "$SOURCE_REALM" | sed -E 's/-(dev|demo|staging|prod)$//')"
fi
TARGET_REALM="${REALM_BASE}-${ENV_NAME}"

if [[ -z "$APP_URL" ]]; then
  APP_URL="https://billie-crm-${ENV_NAME}.fly.dev"
fi
APP_URL="${APP_URL%/}"

TMP_BASE="$(mktemp -t keycloak-realm-transformed)"
TMP_JSON="${TMP_BASE}.json"
mv "$TMP_BASE" "$TMP_JSON"
trap 'rm -f "$TMP_JSON"' EXIT

echo "Preparing transformed realm JSON..."
jq \
  --arg targetRealm "$TARGET_REALM" \
  --arg appUrl "$APP_URL" \
  '
  .realm = $targetRealm
  | .clients = ((.clients // []) | map(
      if .clientId == "billie-app" then
        .rootUrl = $appUrl
        | .adminUrl = $appUrl
        | .baseUrl = $appUrl
        | .redirectUris = [($appUrl + "/"), ($appUrl + "/*")]
        | .webOrigins = [$appUrl]
        | .attributes = ((.attributes // {}) + {"post.logout.redirect.uris": ($appUrl + "/*##" + $appUrl + "/")})
      else
        .
      end
    ))
  | .clients = ((.clients // []) | map(
      if (.secret? == "**********") then
        del(.secret)
      else
        .
      end
    ))
  | if (.smtpServer.password? == "**********") then .smtpServer.password = "" else . end
  | del(
      .keycloakVersion,
      .organizationsEnabled,
      .verifiableCredentialsEnabled,
      .adminPermissionsEnabled,
      .clientProfiles,
      .clientPolicies
    )
  ' \
  "$EXPORT_FILE" > "$TMP_JSON"

# Sanity-check transformed JSON before upload
if ! jq -e . "$TMP_JSON" >/dev/null 2>&1; then
  echo "Transformed JSON is invalid: $TMP_JSON"
  exit 1
fi

echo "Source realm: $SOURCE_REALM"
echo "Target realm: $TARGET_REALM"
echo "App URL:      $APP_URL"
echo "Output file:  $TMP_JSON"
echo "JSON size:    $(wc -c < "$TMP_JSON") bytes"

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "Dry run enabled. Transformed JSON generated only."
  exit 0
fi

echo "Getting admin token..."
TOKEN_RESP="$(curl -sS -X POST "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=admin-cli" \
  -d "username=${ADMIN_USER}" \
  -d "password=${ADMIN_PASSWORD}" \
  -d "grant_type=password")"

ACCESS_TOKEN="$(echo "$TOKEN_RESP" | jq -r '.access_token // empty')"
if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Failed to get admin token:"
  echo "$TOKEN_RESP"
  exit 1
fi

echo "Checking whether target realm exists..."
REALM_STATUS="$(curl -sS -o /tmp/keycloak-realm-check.json -w "%{http_code}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "${KEYCLOAK_URL}/admin/realms/${TARGET_REALM}")"

if [[ "$REALM_STATUS" == "200" ]]; then
  if [[ "$REPLACE_EXISTING" != "true" ]]; then
    echo "Realm '${TARGET_REALM}' already exists."
    echo "Re-run with --replace-existing to recreate it from export."
    exit 1
  fi
  echo "Deleting existing realm '${TARGET_REALM}'..."
  DELETE_STATUS="$(curl -sS -o /tmp/keycloak-realm-delete.json -w "%{http_code}" \
    -X DELETE \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    "${KEYCLOAK_URL}/admin/realms/${TARGET_REALM}")"
  if [[ "$DELETE_STATUS" -lt 200 || "$DELETE_STATUS" -ge 300 ]]; then
    echo "Failed to delete realm (HTTP $DELETE_STATUS):"
    cat /tmp/keycloak-realm-delete.json
    exit 1
  fi
elif [[ "$REALM_STATUS" != "404" ]]; then
  echo "Unexpected response checking realm (HTTP $REALM_STATUS):"
  cat /tmp/keycloak-realm-check.json
  exit 1
fi

echo "Importing realm '${TARGET_REALM}'..."
IMPORT_STATUS="$(curl -sS -o /tmp/keycloak-realm-import.json -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Expect:" \
  -H "Content-Type: application/json" \
  --http1.1 \
  --data-binary "@${TMP_JSON}" \
  "${KEYCLOAK_URL}/admin/realms")"

if [[ "$IMPORT_STATUS" -lt 200 || "$IMPORT_STATUS" -ge 300 ]]; then
  echo "Realm import failed (HTTP $IMPORT_STATUS):"
  cat /tmp/keycloak-realm-import.json
  exit 1
fi

echo ""
echo "Realm import successful."
echo "Realm: ${TARGET_REALM}"
echo "Keycloak: ${KEYCLOAK_URL}"
echo ""
echo "Next step: test login flow and verify billie-app redirect URIs for ${APP_URL}."
