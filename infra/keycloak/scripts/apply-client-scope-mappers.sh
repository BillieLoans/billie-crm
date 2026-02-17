#!/usr/bin/env bash
# Add client scope mappers (User Attribute for customer_id, optional Audience) to a client's
# dedicated scope via Keycloak Admin API. Requires: curl, jq
#
# Usage:
#   KEYCLOAK_URL=... REALM=... CLIENT_ID=billie-app ADMIN_USER=... ADMIN_PASSWORD=... ./apply-client-scope-mappers.sh
#
# Optional env:
#   USER_ATTRIBUTE_NAME=customerId   # realm user profile attribute name (default: customerId)
#   TOKEN_CLAIM_NAME=customer_id     # claim name in tokens (default: customer_id)
#   ADD_AUDIENCE_MAPPER=true         # add Audience mapper for client (default: true)

set -e

KEYCLOAK_URL="${KEYCLOAK_URL:-}"
REALM="${REALM:-}"
CLIENT_ID="${CLIENT_ID:-}"
ADMIN_USER="${ADMIN_USER:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
USER_ATTRIBUTE_NAME="${USER_ATTRIBUTE_NAME:-customerId}"
TOKEN_CLAIM_NAME="${TOKEN_CLAIM_NAME:-customer_id}"
ADD_AUDIENCE_MAPPER="${ADD_AUDIENCE_MAPPER:-true}"

if [[ -z "$KEYCLOAK_URL" || -z "$REALM" || -z "$CLIENT_ID" || -z "$ADMIN_USER" || -z "$ADMIN_PASSWORD" ]]; then
    echo "Usage: KEYCLOAK_URL=... REALM=... CLIENT_ID=... ADMIN_USER=... ADMIN_PASSWORD=... $0"
    echo ""
    echo "  KEYCLOAK_URL       Keycloak base URL (e.g. https://billie-keycloak-nonprod.fly.dev)"
    echo "  REALM              Realm name (e.g. billie-customer-demo)"
    echo "  CLIENT_ID          Client ID (e.g. billie-app); script targets scope \${CLIENT_ID}-dedicated"
    echo "  ADMIN_USER         Admin console username"
    echo "  ADMIN_PASSWORD     Admin console password"
    echo ""
    echo "Optional: USER_ATTRIBUTE_NAME (default customerId), TOKEN_CLAIM_NAME (default customer_id), ADD_AUDIENCE_MAPPER (default true)"
    exit 1
fi

KEYCLOAK_URL="${KEYCLOAK_URL%/}"
DEDICATED_SCOPE_NAME="${CLIENT_ID}-dedicated"

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

# Dedicated scopes don't appear in GET /client-scopes; resolve via the client's assigned scopes.
echo "Looking up client '${CLIENT_ID}'..."
CLIENTS=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
    "${KEYCLOAK_URL}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}") || true
if ! echo "$CLIENTS" | jq -e . >/dev/null 2>&1; then
    echo "Failed to look up client. Response: $CLIENTS"
    exit 1
fi
CLIENT_UUID=$(echo "$CLIENTS" | jq -r '.[0].id // empty')
if [[ -z "$CLIENT_UUID" || "$CLIENT_UUID" == "null" ]]; then
    echo "Client '${CLIENT_ID}' not found in realm '${REALM}'."
    exit 1
fi

echo "Resolving dedicated scope '${DEDICATED_SCOPE_NAME}' (from client's assigned scopes)..."
DEFAULT_SCOPES=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
    "${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${CLIENT_UUID}/default-client-scopes") || true
OPTIONAL_SCOPES=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
    "${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${CLIENT_UUID}/optional-client-scopes") || true

SCOPE_ID=$(echo "$DEFAULT_SCOPES" | jq -r --arg name "$DEDICATED_SCOPE_NAME" '.[] | select(.name == $name) | .id' 2>/dev/null | head -1)
if [[ -z "$SCOPE_ID" || "$SCOPE_ID" == "null" ]]; then
    SCOPE_ID=$(echo "$OPTIONAL_SCOPES" | jq -r --arg name "$DEDICATED_SCOPE_NAME" '.[] | select(.name == $name) | .id' 2>/dev/null | head -1)
fi
if [[ -z "$SCOPE_ID" || "$SCOPE_ID" == "null" ]]; then
    echo "Dedicated scope '${DEDICATED_SCOPE_NAME}' not found. In Keycloak: Clients → ${CLIENT_ID} → Client scopes → ensure '${DEDICATED_SCOPE_NAME}' is assigned (Default or Optional)."
    exit 1
fi

echo "Fetching existing mappers..."
MAPPERS=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
    "${KEYCLOAK_URL}/admin/realms/${REALM}/client-scopes/${SCOPE_ID}/protocol-mappers/models") || true

if ! echo "$MAPPERS" | jq -e . >/dev/null 2>&1; then
    echo "Failed to list mappers. Response: $MAPPERS"
    exit 1
fi

# User Attribute mapper for customer_id
HAS_USER_ATTR=$(echo "$MAPPERS" | jq -r --arg name "$TOKEN_CLAIM_NAME" '.[] | select(.name == $name and .protocolMapper == "oidc-usermodel-attribute-mapper") | .id' | head -1)
if [[ -n "$HAS_USER_ATTR" && "$HAS_USER_ATTR" != "null" ]]; then
    echo "Mapper '${TOKEN_CLAIM_NAME}' (User Attribute) already exists. Skipping."
else
    echo "Adding User Attribute mapper: ${USER_ATTRIBUTE_NAME} -> ${TOKEN_CLAIM_NAME}"
    USER_ATTR_MAPPER=$(jq -n \
        --arg name "$TOKEN_CLAIM_NAME" \
        --arg userAttr "$USER_ATTRIBUTE_NAME" \
        --arg claimName "$TOKEN_CLAIM_NAME" \
        '{
          name: $name,
          protocol: "openid-connect",
          protocolMapper: "oidc-usermodel-attribute-mapper",
          config: {
            "user.attribute": $userAttr,
            "claim.name": $claimName,
            "jsonType.label": "String",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "userinfo.token.claim": "true",
            "token.introspection.claim": "true",
            "multivalued": "false"
          }
        }')
    HTTP_STATUS=$(curl -s -o /tmp/kc-mapper-response.json -w "%{http_code}" \
        -X POST \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$USER_ATTR_MAPPER" \
        "${KEYCLOAK_URL}/admin/realms/${REALM}/client-scopes/${SCOPE_ID}/protocol-mappers/models")
    if [[ "$HTTP_STATUS" -lt 200 || "$HTTP_STATUS" -ge 300 ]]; then
        echo "Failed to add User Attribute mapper (HTTP $HTTP_STATUS). Response:"
        cat /tmp/kc-mapper-response.json | jq . 2>/dev/null || cat /tmp/kc-mapper-response.json
        exit 1
    fi
fi

# Optional Audience mapper
if [[ "$ADD_AUDIENCE_MAPPER" == "true" || "$ADD_AUDIENCE_MAPPER" == "1" || "$ADD_AUDIENCE_MAPPER" == "yes" ]]; then
    AUDIENCE_MAPPER_NAME="${CLIENT_ID}-audience"
    HAS_AUDIENCE=$(echo "$MAPPERS" | jq -r --arg name "$AUDIENCE_MAPPER_NAME" '.[] | select(.name == $name and .protocolMapper == "oidc-audience-mapper") | .id' | head -1)
    if [[ -n "$HAS_AUDIENCE" && "$HAS_AUDIENCE" != "null" ]]; then
        echo "Audience mapper '${AUDIENCE_MAPPER_NAME}' already exists. Skipping."
    else
        echo "Adding Audience mapper for client '${CLIENT_ID}'"
        AUDIENCE_MAPPER=$(jq -n \
            --arg name "$AUDIENCE_MAPPER_NAME" \
            --arg clientId "$CLIENT_ID" \
            '{
              name: $name,
              protocol: "openid-connect",
              protocolMapper: "oidc-audience-mapper",
              config: {
                "included.client.audience": $clientId,
                "id.token.claim": "true",
                "access.token.claim": "true",
                "token.introspection.claim": "true"
              }
            }')
        HTTP_STATUS=$(curl -s -o /tmp/kc-mapper-response.json -w "%{http_code}" \
            -X POST \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$AUDIENCE_MAPPER" \
            "${KEYCLOAK_URL}/admin/realms/${REALM}/client-scopes/${SCOPE_ID}/protocol-mappers/models")
        if [[ "$HTTP_STATUS" -lt 200 || "$HTTP_STATUS" -ge 300 ]]; then
            echo "Failed to add Audience mapper (HTTP $HTTP_STATUS). Response:"
            cat /tmp/kc-mapper-response.json | jq . 2>/dev/null || cat /tmp/kc-mapper-response.json
            exit 1
        fi
    fi
fi

echo "Done. Client scope '${DEDICATED_SCOPE_NAME}' mappers are configured."
