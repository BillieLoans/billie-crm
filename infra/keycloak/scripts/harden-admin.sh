#!/usr/bin/env bash
# Keycloak admin security hardening.
# Removes the default 'admin' user from the master realm to prevent
# credential-based attacks (even if the account is disabled, it should be deleted).
#
# Requires: curl, jq
#
# Example:
#   ENV=demo ./harden-admin.sh
#   # or with explicit variables:
#   KEYCLOAK_URL=https://billie-keycloak-nonprod.fly.dev \
#   ADMIN_USER=rohan@billie.loans \
#   ADMIN_PASSWORD='...' \
#   ./harden-admin.sh

set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-}"
ADMIN_USER="${ADMIN_USER:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
ENV_NAME="${ENV:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  ENV=<env> ./harden-admin.sh
  # or with explicit variables:
  KEYCLOAK_URL=... ADMIN_USER=... ADMIN_PASSWORD=... ./harden-admin.sh

Required environment variables:
  KEYCLOAK_URL   Keycloak base URL (e.g. https://billie-keycloak-nonprod.fly.dev)
  ADMIN_USER     Keycloak admin username
  ADMIN_PASSWORD Keycloak admin password
  ENV            Target environment: nonprod|prod (optional if KEYCLOAK_URL is set)

Options:
  -h, --help     Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$ENV_NAME" ]]; then
        ENV_NAME="$1"
      else
        echo "Unknown argument: $1"
        usage
        exit 1
      fi
      shift
      ;;
  esac
done

# Accept environment as argument if provided
if [[ $# -gt 0 && -z "$ENV_NAME" ]]; then
  ENV_NAME="$1"
fi

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
ENV_NAME="${ENV:-${ENV_NAME:-}}"

if [[ -z "$KEYCLOAK_URL" || -z "$ADMIN_USER" || -z "$ADMIN_PASSWORD" ]]; then
  usage
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

echo "Authenticating to Keycloak master realm..."
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

echo "Checking for default 'admin' user in master realm..."
USER_SEARCH_RESP="$(curl -sS -w "\n%{http_code}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "${KEYCLOAK_URL}/admin/realms/master/users?username=admin&exact=true")"

HTTP_CODE="$(echo "$USER_SEARCH_RESP" | tail -n1)"
USER_DATA="$(echo "$USER_SEARCH_RESP" | head -n-1)"

if [[ "$HTTP_CODE" -lt 200 || "$HTTP_CODE" -ge 300 ]]; then
  echo "Failed to search for users (HTTP $HTTP_CODE):"
  echo "$USER_DATA"
  exit 1
fi

USER_COUNT="$(echo "$USER_DATA" | jq '. | length')"
if [[ "$USER_COUNT" -eq 0 ]]; then
  echo "✓ Default 'admin' user not found in master realm."
  echo "  No action needed - security hardening already applied."
  exit 0
fi

ADMIN_USER_ID="$(echo "$USER_DATA" | jq -r '.[0].id // empty')"
ADMIN_USERNAME="$(echo "$USER_DATA" | jq -r '.[0].username // empty')"

if [[ -z "$ADMIN_USER_ID" ]]; then
  echo "Found admin user but could not extract user ID."
  echo "Response: $USER_DATA"
  exit 1
fi

if [[ "$ADMIN_USERNAME" != "admin" ]]; then
  echo "Unexpected username found: $ADMIN_USERNAME (expected 'admin')"
  exit 1
fi

echo "Found default 'admin' user (ID: ${ADMIN_USER_ID})"
echo "Deleting default 'admin' user..."

DELETE_RESP="$(curl -sS -w "\n%{http_code}" \
  -X DELETE \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "${KEYCLOAK_URL}/admin/realms/master/users/${ADMIN_USER_ID}")"

DELETE_HTTP_CODE="$(echo "$DELETE_RESP" | tail -n1)"
DELETE_BODY="$(echo "$DELETE_RESP" | head -n-1)"

if [[ "$DELETE_HTTP_CODE" -lt 200 || "$DELETE_HTTP_CODE" -ge 300 ]]; then
  echo "Failed to delete admin user (HTTP $DELETE_HTTP_CODE):"
  if [[ -n "$DELETE_BODY" ]]; then
    echo "$DELETE_BODY"
  fi
  exit 1
fi

echo ""
echo "✓ Successfully deleted default 'admin' user from master realm."
echo "  Security hardening complete."
echo ""
echo "Keycloak: ${KEYCLOAK_URL}"
echo "User ID:  ${ADMIN_USER_ID}"
