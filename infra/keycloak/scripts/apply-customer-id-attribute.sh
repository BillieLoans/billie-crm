#!/usr/bin/env bash
# Apply the Customer ID custom attribute to a realm's user profile via Keycloak Admin API.
# Requires: curl, jq
#
# Usage:
#   KEYCLOAK_URL=https://your-keycloak.fly.dev REALM=your-realm ADMIN_USER=admin ADMIN_PASSWORD=secret ./apply-customer-id-attribute.sh

set -e

KEYCLOAK_URL="${KEYCLOAK_URL:-}"
REALM="${REALM:-}"
ADMIN_USER="${ADMIN_USER:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

if [[ -z "$KEYCLOAK_URL" || -z "$REALM" || -z "$ADMIN_USER" || -z "$ADMIN_PASSWORD" ]]; then
    echo "Usage: KEYCLOAK_URL=... REALM=... ADMIN_USER=... ADMIN_PASSWORD=... $0"
    echo ""
    echo "  KEYCLOAK_URL  Keycloak base URL (e.g. https://billie-keycloak-nonprod.fly.dev)"
    echo "  REALM         Realm to configure (e.g. your app realm name, not 'master')"
    echo "  ADMIN_USER    Admin console username"
    echo "  ADMIN_PASSWORD  Admin console password"
    exit 1
fi

# Trim trailing slash
KEYCLOAK_URL="${KEYCLOAK_URL%/}"

echo "Getting admin token..."
TOKEN_RESP=$(curl -s -X POST "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=admin-cli" \
    -d "username=${ADMIN_USER}" \
    -d "password=${ADMIN_PASSWORD}" \
    -d "grant_type=password") || true

ACCESS_TOKEN=$(echo "$TOKEN_RESP" | jq -r '.access_token // empty')
if [[ -z "$ACCESS_TOKEN" ]]; then
    echo "Failed to get token. Response: $TOKEN_RESP"
    exit 1
fi

echo "Fetching current user profile for realm '$REALM'..."
PROFILE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
    "${KEYCLOAK_URL}/admin/realms/${REALM}/users/profile") || true

if ! echo "$PROFILE" | jq -e . >/dev/null 2>&1; then
    echo "Failed to get user profile (realm may not exist or no access). Response: $PROFILE"
    exit 1
fi

# Check if customerId attribute already exists
if echo "$PROFILE" | jq -e '.attributes[] | select(.name == "customerId")' >/dev/null 2>&1; then
    echo "Attribute 'customerId' already present in user profile. Nothing to do."
    exit 0
fi

# Use an existing group (Keycloak rejects unknown groups). Prefer "personalInfo", else first group.
EXISTING_GROUP=$(echo "$PROFILE" | jq -r '(.groups[]? | select(.name == "personalInfo") | .name) // .groups[0].name // empty')
if [[ -z "$EXISTING_GROUP" ]]; then
    echo "No user profile groups found. Add a group (e.g. 'personalInfo') in Realm settings → User profile → Attribute groups, then re-run."
    exit 1
fi
echo "Using group: $EXISTING_GROUP"

# Ensure .attributes exists and is an array
PROFILE=$(echo "$PROFILE" | jq '.attributes //= (.attributes // [])')

# Add Customer ID attribute (admin view/edit, single value)
CUSTOMER_ID_ATTR=$(jq -n \
    --arg group "$EXISTING_GROUP" \
    '{name: "customerId", displayName: "Customer ID", group: $group, multivalued: false, permissions: {view: ["admin"], edit: ["admin"]}, validations: {}, annotations: {}}')

NEW_PROFILE=$(echo "$PROFILE" | jq --argjson attr "$CUSTOMER_ID_ATTR" '.attributes += [$attr]')

echo "Updating user profile (adding Customer ID attribute)..."
HTTP_STATUS=$(curl -s -o /tmp/keycloak-profile-response.json -w "%{http_code}" \
    -X PUT \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$NEW_PROFILE" \
    "${KEYCLOAK_URL}/admin/realms/${REALM}/users/profile")

if [[ "$HTTP_STATUS" -ge 200 && "$HTTP_STATUS" -lt 300 ]]; then
    echo "Done. Customer ID attribute is now in realm '$REALM' user profile."
else
    echo "PUT failed with HTTP $HTTP_STATUS. Response:"
    cat /tmp/keycloak-profile-response.json | jq . 2>/dev/null || cat /tmp/keycloak-profile-response.json
    exit 1
fi
