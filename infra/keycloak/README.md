# Keycloak Infrastructure

This directory contains the Fly.io deployment configuration for Keycloak instances.

## Environments

| Environment | App Name | Purpose |
|-------------|----------|---------|
| Non-Production | `billie-keycloak-nonprod` | Development, staging, testing |
| Production | `billie-keycloak-prod` | Production workloads |

## Directory Structure

```
infra/keycloak/
├── Dockerfile          # Shared Keycloak Docker image
├── deploy.sh           # Deployment script
├── README.md           # This file
├── nonprod/
│   └── fly.toml        # Non-production Fly.io config
└── prod/
    └── fly.toml        # Production Fly.io config
```

## Prerequisites

1. Install the Fly CLI: https://fly.io/docs/hands-on/install-flyctl/
2. Authenticate: `fly auth login`

## Deployment

### First-Time Setup

1. **Deploy non-production:**
   ```bash
   cd infra/keycloak
   ./deploy.sh nonprod
   ```

2. **Set secrets (prompted by the script):**
   ```bash
   fly secrets set KC_BOOTSTRAP_ADMIN_USERNAME=admin -a billie-keycloak-nonprod
   fly secrets set KC_BOOTSTRAP_ADMIN_PASSWORD=<secure-password> -a billie-keycloak-nonprod
   ```

3. **Attach the database:**
   ```bash
   fly postgres attach billie-keycloak-nonprod-db -a billie-keycloak-nonprod
   ```

4. **Run deploy again:**
   ```bash
   ./deploy.sh nonprod
   ```

5. **Repeat for production** when ready.

### Subsequent Deployments

```bash
./deploy.sh nonprod  # Deploy to non-production
./deploy.sh prod     # Deploy to production
```

## Configuration Differences

| Setting | Non-Production | Production |
|---------|---------------|------------|
| Memory | 512MB | 1GB |
| CPUs | 1 | 2 |
| Auto-stop | Yes (saves costs) | No (always running) |
| Min machines | 0 | 1 |
| Log level | INFO | WARN |
| Health check interval | 30s | 15s |

## URLs

After deployment:

- **Non-Production:**
  - App: https://billie-keycloak-nonprod.fly.dev
  - Admin: https://billie-keycloak-nonprod.fly.dev/admin

- **Production:**
  - App: https://billie-keycloak-prod.fly.dev
  - Admin: https://billie-keycloak-prod.fly.dev/admin

## Managing Secrets

```bash
# List secrets
fly secrets list -a billie-keycloak-nonprod

# Set a secret
fly secrets set SECRET_NAME=value -a billie-keycloak-nonprod

# Unset a secret
fly secrets unset SECRET_NAME -a billie-keycloak-nonprod
```

## Database Access

```bash
# Connect to database
fly postgres connect -a billie-keycloak-nonprod-db

# Proxy database locally (for tools like pgAdmin)
fly proxy 5432 -a billie-keycloak-nonprod-db
```

## Monitoring

```bash
# View logs
fly logs -a billie-keycloak-nonprod

# Check app status
fly status -a billie-keycloak-nonprod

# SSH into the machine
fly ssh console -a billie-keycloak-nonprod
```

## Scaling

```bash
# Scale non-prod (manual)
fly scale count 1 -a billie-keycloak-nonprod

# Scale prod (increase machines)
fly scale count 2 -a billie-keycloak-prod

# Adjust VM size
fly scale vm shared-cpu-2x -a billie-keycloak-prod
```

## Troubleshooting

### Keycloak won't start

1. Check logs: `fly logs -a billie-keycloak-nonprod`
2. Verify database is attached: `fly postgres list`
3. Verify secrets are set: `fly secrets list -a billie-keycloak-nonprod`

### Database connection issues

1. Check database status: `fly status -a billie-keycloak-nonprod-db`
2. Verify the `DATABASE_URL` secret exists (created by `fly postgres attach`)

### Health check failures

Keycloak can take 60-90 seconds to start. The health check grace period is set to 60s.
If issues persist, check memory usage - Keycloak needs at least 512MB.
