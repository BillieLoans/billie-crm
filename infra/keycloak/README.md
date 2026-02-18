# Keycloak Infrastructure

Keycloak identity provider for Billie, deployed on Fly.io with PostgreSQL.

## Environments

| Environment | App Name | Fly.io Config | Purpose |
|---|---|---|---|
| Non-Production | `billie-keycloak-nonprod` | `nonprod/fly.toml` | dev, demo, staging realms |
| Production | `billie-keycloak-prod` | `prod/fly.toml` | Production workloads |

Non-production hosts multiple realms (e.g. `billie-customer-dev`, `billie-customer-demo`) on one instance. Production gets its own dedicated instance.

| Setting | Non-Production | Production |
|---|---|---|
| Memory | 1GB | 1GB |
| CPUs | 1 shared | 2 shared |
| Auto-stop | Yes (saves costs) | No (always running) |
| Min machines | 0 | 1 |
| Log level | INFO | WARN |
| Health check interval | 30s | 15s |
| Hostname strict | Yes | Yes |

## Directory Structure

```
infra/keycloak/
├── Dockerfile                # Multi-stage Keycloak 26.0 image (postgres, health, metrics)
├── docker-entrypoint.sh      # Converts Fly DATABASE_URL to KC_DB_* format
├── deploy.sh                 # Deployment script (creates app + DB on first run)
├── README.md
├── config_files/
│   └── billie-customer-realm.json   # Realm export (clients, scopes, mappers, auth flows)
├── scripts/
│   ├── setup-realm-from-export.sh       # Import realm from JSON export
│   ├── harden-admin.sh                  # Delete default admin user (security hardening)
│   ├── apply-customer-id-attribute.sh   # Add customer_id to user profile
│   └── apply-client-scope-mappers.sh    # Add customer_id + audience mappers
├── .env.dev                  # Variables for dev realm import
├── .env.demo                 # Variables for demo realm import
├── .env.staging              # Variables for staging realm import
├── .env.prod                 # Variables for prod realm import
├── themes/billie/            # Custom Keycloak theme (login + email)
├── nonprod/fly.toml          # Non-production Fly.io config
└── prod/fly.toml             # Production Fly.io config
```

## Prerequisites

- [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) installed and authenticated (`fly auth login`)
- `curl` and `jq` installed (for realm setup and hardening scripts)
- A strong, unique admin password generated and ready (e.g. `openssl rand -base64 32`)

---

## Production Setup (Step by Step)

This is the complete procedure to stand up a new production Keycloak instance, from zero to hardened.

### Step 1: Create the Fly app and database

```bash
cd infra/keycloak
./deploy.sh prod
```

On first run, this will:
1. Create the `billie-keycloak-prod` Fly app
2. Create a `billie-keycloak-prod-db` PostgreSQL instance (10GB, `syd` region)
3. Print instructions for secrets and database attachment, then exit

### Step 2: Set bootstrap admin secrets

Generate a strong password and set secrets. **Do not use `admin` as the password.**

```bash
# Generate a secure password
ADMIN_PASS="$(openssl rand -base64 32)"
echo "Save this password securely: $ADMIN_PASS"

# Set secrets on the Fly app
fly secrets set KC_BOOTSTRAP_ADMIN_USERNAME=admin -a billie-keycloak-prod
fly secrets set KC_BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_PASS" -a billie-keycloak-prod
```

The bootstrap admin is the initial Keycloak user created in the `master` realm on first boot. You will use it to set up realms and then delete it in the hardening step.

### Step 3: Attach the database

```bash
fly postgres attach billie-keycloak-prod-db -a billie-keycloak-prod
```

This creates a `DATABASE_URL` secret on the app. The `docker-entrypoint.sh` converts it to Keycloak's `KC_DB_*` format at startup.

### Step 4: Deploy

```bash
./deploy.sh prod --skip-secrets
```

Wait for the deployment to complete. Keycloak takes 60-90 seconds to start (longer on first boot due to database migrations). Monitor with:

```bash
fly logs -a billie-keycloak-prod
```

Verify it's healthy:

```bash
curl -s https://billie-keycloak-prod.fly.dev/health/ready
# Expected: {"status":"UP"}
```

### Step 5: Create a dedicated admin user

Before deleting the bootstrap admin, create a proper admin user with a unique username.

1. Open `https://billie-keycloak-prod.fly.dev/admin`
2. Log in with the bootstrap credentials (`admin` / the password from step 2)
3. In the **master** realm, go to **Users** > **Add user**
4. Create a user with:
   - A **non-obvious username** (not `admin`, not `keycloak`, not your email)
   - A strong, unique password (set via **Credentials** tab, toggle off "Temporary")
   - **Realm roles**: assign `admin` role
5. Log out, then log back in with the new user to verify it works

### Step 6: Security hardening

Run the hardening script to delete the default `admin` user from the master realm:

```bash
cd infra/keycloak
KEYCLOAK_URL=https://billie-keycloak-prod.fly.dev \
ADMIN_USER=<your-new-admin-username> \
ADMIN_PASSWORD='<your-new-admin-password>' \
./scripts/harden-admin.sh
```

This finds and deletes the `admin` user. If it's already been removed, the script exits cleanly.

### Step 7: Import the production realm

Update `.env.prod` with your admin credentials:

```bash
# .env.prod
ENV=prod
KEYCLOAK_URL=https://billie-keycloak-prod.fly.dev
ADMIN_USER=<your-new-admin-username>
ADMIN_PASSWORD=<your-new-admin-password>
EXPORT_FILE=config_files/billie-customer-realm.json
REALM_BASE=billie-customer
APP_URL=https://billie-crm.fly.dev
```

> **Never commit real passwords to `.env.*` files.** Use `CHANGE_ME` as the placeholder and set the actual values locally or via a secrets manager.

Then import the realm:

```bash
cd infra/keycloak
ENV=prod ./scripts/setup-realm-from-export.sh
```

The script transforms the realm JSON for production:
- Renames the realm to `billie-customer-prod`
- Rewrites `billie-app` client URLs to the production app URL
- Imports via the Keycloak Admin API

Use `--dry-run` first to inspect the transformed JSON without touching the server:

```bash
ENV=prod ./scripts/setup-realm-from-export.sh --dry-run
```

Use `--replace-existing` to overwrite an existing realm:

```bash
ENV=prod ./scripts/setup-realm-from-export.sh --replace-existing
```

### Step 8: Verify realm configuration

After import, verify these settings in the admin console (`https://billie-keycloak-prod.fly.dev/admin`):

1. **Clients > billie-app > Settings:**
   - "Direct Access Grants Enabled" is **OFF** (password grant disabled)
   - "Standard Flow Enabled" is **ON** (authorization code flow)
   - "Client authentication" is **OFF** (public client for SPA)
   - `pkce.code.challenge.method` is **S256**

2. **Clients > billie-app > Settings > Access settings:**
   - "Valid redirect URIs" includes your production app URL(s)
   - "Web origins" includes your production app origin
   - "Valid post logout redirect URIs" includes your production app URL(s)

3. **Realm settings > Security defenses > Brute force detection:**
   - Enabled: **ON**
   - Max login failures: **5**
   - Wait increment: **60 seconds**
   - Max wait: **900 seconds** (15 minutes)

4. **Realm settings > Themes:**
   - Login theme: **billie**
   - Email theme: **billie**

5. **Realm settings > Events:**
   - User events: **ON**
   - Admin events: **ON** (with "Include representation" ON)

6. **Realm settings > General:**
   - User registration: **OFF**

### Step 9: Configure SMTP (email)

If you need password reset and email verification, configure SMTP:

1. **Realm settings > Email**
2. Set your SMTP server details (e.g. AWS SES)
3. Send a test email to verify

The realm export includes SMTP configuration, but passwords are masked (`**********`) and need to be re-entered manually.

### Step 10: Smoke test

1. Open your production app URL
2. Verify the login redirect goes to Keycloak with the Billie theme
3. Test login with a valid user
4. Verify the JWT token contains the expected claims (`customer_id`, audience)
5. Test password reset flow (if SMTP is configured)

---

## Security Hardening Checklist

Run through this checklist after every new instance setup or major configuration change.

| # | Item | How to verify | Script/Manual |
|---|---|---|---|
| 1 | **Bootstrap admin user deleted** from master realm | Admin console > master realm > Users: no user named `admin` | `scripts/harden-admin.sh` |
| 2 | **Password grant disabled** on `billie-app` client | Clients > billie-app > Settings: "Direct Access Grants" is OFF | Realm JSON (`directAccessGrantsEnabled: false`) |
| 3 | **Brute force detection enabled** | Realm settings > Security defenses > Brute force: ON, 5 failures, 60s wait | Realm JSON (`bruteForceProtected: true`) |
| 4 | **PKCE enforced** on `billie-app` client | Clients > billie-app > Advanced > Proof Key for Code Exchange: S256 | Realm JSON (`pkce.code.challenge.method: S256`) |
| 5 | **Self-registration disabled** | Realm settings > Login: "User registration" is OFF | Realm JSON (`registrationAllowed: false`) |
| 6 | **Admin events auditing enabled** | Realm settings > Events: Admin events ON, Include representation ON | Realm JSON (`adminEventsEnabled: true`) |
| 7 | **No credentials in git** | `.env.*` files contain `CHANGE_ME`, not real passwords | Manual review |
| 8 | **Admin console access restricted** (recommended) | Cannot reach `/admin` from outside allowed networks | Fly.io private networking or reverse proxy |
| 9 | **Strong admin password** | Bootstrap password is 32+ random characters, not `admin` | Fly secrets |
| 10 | **SMTP password re-entered** | Realm settings > Email > Test connection works | Manual (masked in exports) |

### Restricting admin console access (recommended)

The admin console at `/admin` is publicly accessible by default on Fly.io. For production, consider:

- **Fly.io private services**: Use `fly services update` or `[[services]]` in `fly.toml` to restrict the admin paths to internal Fly network only
- **VPN / WireGuard**: Access admin via `fly wireguard` private networking (`billie-keycloak-prod.internal:8080`)
- **IP allowlisting**: Use a reverse proxy (e.g. Fly middleware or Cloudflare Access) to restrict `/admin/*` and `/realms/master/*` to trusted IPs

---

## Realm Setup from Export

The primary way to configure realms is via `scripts/setup-realm-from-export.sh`, which imports a realm JSON export and transforms it for the target environment.

### What the script does

- Renames the realm to `<REALM_BASE>-<ENV>` (e.g. `billie-customer-prod`)
- Rewrites `billie-app` client URLs (rootUrl, adminUrl, baseUrl, redirectUris, webOrigins, post-logout URIs) to `APP_URL`
- Strips masked secrets (`**********`) so Keycloak generates new ones
- Removes version-specific fields that cause import errors across Keycloak versions

### Usage

Using environment files (recommended):

```bash
cd infra/keycloak
# Edit .env.prod with correct ADMIN_USER, ADMIN_PASSWORD, and APP_URL
ENV=prod ./scripts/setup-realm-from-export.sh
```

Using explicit variables:

```bash
cd infra/keycloak
KEYCLOAK_URL=https://billie-keycloak-prod.fly.dev \
ADMIN_USER=<admin-username> \
ADMIN_PASSWORD='<admin-password>' \
ENV=prod \
EXPORT_FILE=config_files/billie-customer-realm.json \
REALM_BASE=billie-customer \
APP_URL=https://billie-crm.fly.dev \
./scripts/setup-realm-from-export.sh
```

### Environment files

Each `.env.<env>` file provides defaults for the setup script:

| Variable | Description |
|---|---|
| `ENV` | Environment name (`dev`, `demo`, `staging`, `prod`) |
| `KEYCLOAK_URL` | Keycloak base URL |
| `ADMIN_USER` | Admin username (set to `CHANGE_ME` in git, override locally) |
| `ADMIN_PASSWORD` | Admin password (set to `CHANGE_ME` in git, override locally) |
| `EXPORT_FILE` | Path to realm export JSON (relative to `infra/keycloak/` or absolute) |
| `REALM_BASE` | Realm name prefix (target realm becomes `<REALM_BASE>-<ENV>`) |
| `APP_URL` | Application URL for client redirect URIs |

---

## Custom Theme (billie)

The `themes/billie/` directory provides a branded Login theme and Email theme, baked into the Docker image at build time.

After importing a realm, verify the theme is set:
1. **Realm settings > Themes**
2. Login theme: **billie**
3. Email theme: **billie**

The theme includes:
- Custom login page with Billie branding (logo, colors, typography)
- HTML email templates for password reset, email verification, and execute actions
- Plain text email fallbacks

---

## Custom User Attributes (Customer ID)

The `customer_id` attribute is configured in the realm JSON and imported automatically. It allows a Billie customer ID to be stored on each user and included in JWT tokens.

### Verify after import

1. **Realm settings > User profile**: `customer_id` attribute exists with admin-only edit permissions
2. **Clients > billie-app > Client scopes > Mappers**: `customer_id` mapper is present
3. **Test a token**: decode a JWT from the app and verify the `customer_id` claim is present

### Apply manually (if needed)

```bash
cd infra/keycloak
KEYCLOAK_URL=https://billie-keycloak-prod.fly.dev \
REALM=billie-customer-prod \
ADMIN_USER=<admin-username> \
ADMIN_PASSWORD='<admin-password>' \
./scripts/apply-customer-id-attribute.sh
```

Client scope mappers:

```bash
cd infra/keycloak
KEYCLOAK_URL=https://billie-keycloak-prod.fly.dev \
REALM=billie-customer-prod \
CLIENT_ID=billie-app \
ADMIN_USER=<admin-username> \
ADMIN_PASSWORD='<admin-password>' \
./scripts/apply-client-scope-mappers.sh
```

---

## Subsequent Deployments

For image updates (theme changes, Keycloak version bumps):

```bash
cd infra/keycloak
./deploy.sh prod --skip-secrets
```

Realm configuration changes should be made via the admin console or by re-importing the realm JSON. The Docker image does not contain realm configuration -- it is stored in the database.

---

## Managing Secrets

```bash
fly secrets list -a billie-keycloak-prod
fly secrets set SECRET_NAME=value -a billie-keycloak-prod
fly secrets unset SECRET_NAME -a billie-keycloak-prod
```

Expected secrets on a running instance:

| Secret | Source |
|---|---|
| `DATABASE_URL` | Created by `fly postgres attach` |
| `KC_BOOTSTRAP_ADMIN_USERNAME` | Set manually in step 2 |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` | Set manually in step 2 |

---

## Database Access

```bash
# Connect to database via psql
fly postgres connect -a billie-keycloak-prod-db

# Proxy database locally (for pgAdmin or other tools)
fly proxy 5432 -a billie-keycloak-prod-db
```

---

## Monitoring

```bash
fly logs -a billie-keycloak-prod        # View logs
fly status -a billie-keycloak-prod      # Check app status
fly ssh console -a billie-keycloak-prod # SSH into the machine
```

---

## Scaling

```bash
fly scale count 2 -a billie-keycloak-prod          # Add a second machine
fly scale vm shared-cpu-2x -a billie-keycloak-prod  # Increase VM size
```

---

## Troubleshooting

### Keycloak won't start

1. Check logs: `fly logs -a billie-keycloak-prod`
2. Verify database is attached: `fly secrets list -a billie-keycloak-prod` (look for `DATABASE_URL`)
3. Verify bootstrap secrets are set: look for `KC_BOOTSTRAP_ADMIN_USERNAME` and `KC_BOOTSTRAP_ADMIN_PASSWORD`
4. Check database status: `fly status -a billie-keycloak-prod-db`

### Health check failures

Keycloak takes 60-90 seconds to start (longer on first boot with database migrations). The production grace period is 60 seconds. If health checks keep failing:

- Check memory: Keycloak needs at least 512MB, 1GB recommended
- Check database connectivity: `fly postgres connect -a billie-keycloak-prod-db`

### "Invalid parameter: redirect_uri" on login

The application's callback URL is not registered in the Keycloak client.

1. Admin console > select your realm > **Clients** > **billie-app** > **Settings**
2. Add the exact callback URL to **Valid redirect URIs** (e.g. `https://billie-crm.fly.dev/*`)
3. Add the origin to **Web origins** (e.g. `https://billie-crm.fly.dev`)
4. Save

### Realm import fails

- Use `--dry-run` to inspect the transformed JSON first
- Check that your admin credentials are valid (the script authenticates to the master realm)
- If the realm already exists, use `--replace-existing` (this deletes and recreates it)
- Large realm imports can time out -- check Keycloak logs for errors
