# Deployment Guide - Fly.io

This guide covers deploying the Billie CRM application to Fly.io.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Configuration](#environment-configuration)
- [Secrets Management](#secrets-management)
- [Deployment Commands](#deployment-commands)
- [Infrastructure Services](#infrastructure-services)
- [Troubleshooting](#troubleshooting)

## Prerequisites

1. **Fly CLI** - Install from https://fly.io/docs/hands-on/install-flyctl/
2. **Fly.io Account** - Sign up at https://fly.io
3. **GitHub PAT** - Personal Access Token with `repo` scope for private SDK access

```bash
# Verify Fly CLI is installed
fly version

# Login to Fly.io
fly auth login
```

## Quick Start

```bash
# Deploy to demo environment
make deploy ENV=demo GITHUB_TOKEN="ghp_your_token_here"

# Deploy to other environments
make deploy ENV=dev GITHUB_TOKEN="ghp_your_token_here"
make deploy ENV=staging GITHUB_TOKEN="ghp_your_token_here"
make deploy ENV=prod GITHUB_TOKEN="ghp_your_token_here" CONFIRM=1
```

## Environment Configuration

### Config Files

Each environment has its own Fly.io configuration file:

| Environment | Config File | App Name |
|-------------|-------------|----------|
| Development | `fly.dev.toml` | `billie-crm-dev` |
| Demo | `fly.demo.toml` | `billie-crm-demo` |
| Staging | `fly.staging.toml` | `billie-crm-staging` |
| Production | `fly.prod.toml` | `billie-crm-prod` |

### Secrets Files

Secrets are stored in `.env.<environment>` files (not committed to git):

```
.env.dev      # Development secrets
.env.demo     # Demo secrets
.env.staging  # Staging secrets
.env.prod     # Production secrets
```

## Secrets Management

### Required Secrets

| Secret | Description |
|--------|-------------|
| `DATABASE_URI` | MongoDB Atlas connection string |
| `REDIS_URL` | Redis/Upstash connection string |
| `PAYLOAD_SECRET` | Payload CMS secret key |
| `GITHUB_TOKEN` | GitHub PAT for private SDK access |

### Setting Secrets

**Option 1: Import from file**
```bash
make secrets ENV=demo
```

**Option 2: Set individually**
```bash
fly secrets set DATABASE_URI="mongodb+srv://..." -a billie-crm-demo
fly secrets set REDIS_URL="redis://..." -a billie-crm-demo
fly secrets set PAYLOAD_SECRET="your-secret" -a billie-crm-demo
```

### GITHUB_TOKEN (Build Secret)

The `GITHUB_TOKEN` is required at **build time** to install private SDKs from the `billie-event-sdks` repository. It is passed as a build secret, NOT stored in Fly secrets.

```bash
# GITHUB_TOKEN must be passed during deploy
make deploy ENV=demo GITHUB_TOKEN="ghp_xxxxxxxxxxxx"

# Or directly with fly deploy
fly deploy -c fly.demo.toml -a billie-crm-demo --build-secret GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
```

**Creating a GitHub PAT:**
1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate new token (classic)
3. Select `repo` scope (for private repository access)
4. Copy the token (starts with `ghp_`)

## Deployment Commands

### Makefile Targets

```bash
# Show help
make help ENV=demo

# Deploy application
make deploy ENV=demo GITHUB_TOKEN="ghp_xxx"

# Import secrets from .env file
make secrets ENV=demo

# View application status
make status ENV=demo

# Tail logs
make logs ENV=demo

# Restart application
make restart ENV=demo

# List IP addresses
make ips ENV=demo

# SSH into machine
make ssh ENV=demo
```

### Production Safety

Production deployments require explicit confirmation:

```bash
# This will fail without CONFIRM=1
make deploy ENV=prod GITHUB_TOKEN="ghp_xxx"

# This will succeed
make deploy ENV=prod GITHUB_TOKEN="ghp_xxx" CONFIRM=1
```

## Infrastructure Services

### MongoDB Atlas

The application uses MongoDB Atlas for data storage:

1. Create account at https://www.mongodb.com/atlas
2. Create cluster in Sydney region (closest to Fly `syd`)
3. Create database user
4. Whitelist IPs (use `0.0.0.0/0` for dev, or Fly egress IP for prod)
5. Get connection string and set as `DATABASE_URI` secret

### Redis (Upstash)

Event streaming uses Upstash Redis:

1. Create database at https://upstash.com
2. Get connection string
3. Set as `REDIS_URL` secret

### Keycloak (Authentication)

Keycloak is deployed separately for authentication:

```bash
# Deploy Keycloak non-prod
cd infra/keycloak
./deploy.sh nonprod

# Deploy Keycloak prod
./deploy.sh prod
```

See `infra/keycloak/README.md` for detailed setup.

## Architecture

The demo/staging deployments run both services in one container:

```
┌─────────────────────────────────────────┐
│           Fly.io Machine                │
│                                         │
│  ┌─────────────────┐  ┌──────────────┐  │
│  │   Next.js App   │  │    Event     │  │
│  │   (Port 3000)   │  │  Processor   │  │
│  └─────────────────┘  └──────────────┘  │
│                                         │
└─────────────────────────────────────────┘
          │                    │
          ▼                    ▼
    ┌──────────┐         ┌──────────┐
    │ MongoDB  │         │  Redis   │
    │  Atlas   │         │ Upstash  │
    └──────────┘         └──────────┘
```

### Environment Variables

Non-sensitive configuration is in `fly.<env>.toml`:

```toml
[env]
  ENABLE_EVENT_PROCESSING = "true"  # Enable background worker
  LOG_LEVEL = "info"
  NEXT_PUBLIC_APP_URL = "https://billie-crm-demo.fly.dev"
  LEDGER_SERVICE_URL = "billie-ledger-demo.internal:50051"
```

## Troubleshooting

### Build Fails: "No module named 'billie_accounts_events'"

The Billie SDKs are installed at **build time** using a GitHub token. If the image was ever built without `GITHUB_TOKEN`, Docker may reuse a cached layer that skipped the SDK install. Fix it by forcing a full rebuild:

```bash
# Pass GITHUB_TOKEN and force rebuild so the SDK install step runs
make deploy ENV=demo GITHUB_TOKEN="ghp_your_actual_token" NO_CACHE=1
```

Without `NO_CACHE=1`, a previously cached layer (from a build without the token) can be reused and the SDKs will still be missing.

### App Crashes on Startup

Check logs for the specific error:

```bash
make logs ENV=demo
# or
fly logs -a billie-crm-demo
```

Common issues:
- Missing secrets (DATABASE_URI, REDIS_URL)
- Invalid MongoDB connection string
- Network connectivity to external services

### Health Check Failures

The app needs time to start. Check if it eventually passes:

```bash
fly status -a billie-crm-demo
```

If health checks keep failing, check:
1. Is the app listening on port 3000?
2. Is `/api/health` endpoint accessible?
3. Are there startup errors in logs?

### DNS Resolution Issues

If the app URL doesn't resolve:

```bash
# Check if IPs are allocated
fly ips list -a billie-crm-demo

# Allocate shared IPv4 if missing
fly ips allocate-v4 --shared -a billie-crm-demo
```

### Event Processor Not Starting

If event processor fails but web app works:
- Check if GITHUB_TOKEN was passed during build
- Verify Redis connection (REDIS_URL secret)
- Check Python dependencies in build logs

The web app will continue running even if the event processor fails.

## Useful Commands

```bash
# Check app status
fly status -a billie-crm-demo

# View all secrets
fly secrets list -a billie-crm-demo

# SSH into running machine
fly ssh console -a billie-crm-demo

# Scale machines
fly scale count 2 -a billie-crm-demo

# View machine specs
fly scale show -a billie-crm-demo

# Restart app
fly apps restart billie-crm-demo
```
