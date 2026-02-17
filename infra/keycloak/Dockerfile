FROM quay.io/keycloak/keycloak:26.0 as builder

# Configure build-time options
ENV KC_DB=postgres
ENV KC_HEALTH_ENABLED=true
ENV KC_METRICS_ENABLED=true
# Serve health/metrics on main port (8080) instead of management port (9000)
ENV KC_LEGACY_OBSERVABILITY_INTERFACE=true

# Enable preview features (build-time option)
ARG KC_FEATURES=""
ENV KC_FEATURES=${KC_FEATURES}

# Build the optimized Keycloak distribution
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.0

COPY --from=builder /opt/keycloak/ /opt/keycloak/

# Custom themes (Login + Email)
COPY themes/ /opt/keycloak/themes/

# Copy entrypoint script that converts DATABASE_URL to Keycloak format
COPY docker-entrypoint.sh /opt/keycloak/docker-entrypoint.sh

USER root
RUN chmod +x /opt/keycloak/docker-entrypoint.sh
USER keycloak

ENTRYPOINT ["/opt/keycloak/docker-entrypoint.sh"]
CMD ["start", "--optimized"]
