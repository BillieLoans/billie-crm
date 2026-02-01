#!/bin/bash
set -e

# Convert Fly's DATABASE_URL to Keycloak's KC_DB_* format
# DATABASE_URL format: postgres://user:password@host:port/database?sslmode=disable
# KC_DB_URL format: jdbc:postgresql://host:port/database?sslmode=disable

if [[ -n "$DATABASE_URL" && -z "$KC_DB_URL" ]]; then
    echo "Converting DATABASE_URL to Keycloak format..."
    
    # Parse DATABASE_URL using bash parameter expansion
    # Remove postgres:// prefix
    DB_URL="${DATABASE_URL#postgres://}"
    
    # Extract user:password
    USER_PASS="${DB_URL%%@*}"
    export KC_DB_USERNAME="${USER_PASS%%:*}"
    export KC_DB_PASSWORD="${USER_PASS#*:}"
    
    # Extract host:port/database
    HOST_PORT_DB="${DB_URL#*@}"
    
    # Remove query string if present
    HOST_PORT_DB="${HOST_PORT_DB%%\?*}"
    
    # Build JDBC URL - disable SSL for Fly internal connections (.flycast)
    # Fly's internal network doesn't support SSL, and connections are already secure
    export KC_DB_URL="jdbc:postgresql://${HOST_PORT_DB}?sslmode=disable"
    
    echo "Database configured: KC_DB_URL=$KC_DB_URL"
fi

# Execute Keycloak
exec /opt/keycloak/bin/kc.sh "$@"
