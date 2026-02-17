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
├── scripts/           # Optional automation
│   ├── setup-realm-from-export.sh       # One-shot realm setup from exported JSON
│   ├── apply-customer-id-attribute.sh   # Add Customer ID to realm user profile
│   └── apply-client-scope-mappers.sh    # Add customer_id + optional Audience mappers to client scope
├── .env.dev           # Setup variables for dev realm import
├── .env.demo          # Setup variables for demo realm import
├── .env.staging       # Setup variables for staging realm import
├── .env.prod          # Setup variables for prod realm import
├── themes/             # Custom Keycloak themes
│   └── billie/         # Billie theme (Login + Email)
│       ├── login/      # Login page theme
│       └── email/      # Email templates (password reset, verification, etc.)
├── nonprod/
│   └── fly.toml        # Non-production Fly.io config
└── prod/
    └── fly.toml        # Production Fly.io config
```

## Custom theme (billie)

The **billie** theme provides a custom Login theme and Email theme. After deployment, in the Keycloak Admin Console:

1. Go to **Realm settings** → **Themes**.
2. Set **Login theme** and **Email theme** to **billie**.
3. Save.

## One-shot setup from realm export (recommended)

Use `scripts/setup-realm-from-export.sh` to bootstrap a full realm in one command from a JSON export (clients, scopes, mappers, user profile, themes refs, etc), with environment naming aligned to the project Makefile (`dev|demo|staging|prod`).

The script:

- infers a realm base from export (or uses `REALM_BASE`) and sets target realm to `<base>-<ENV>`
- rewrites `billie-app` URLs to target app URL (defaults to `https://billie-crm-<ENV>.fly.dev`)
- imports the realm via Keycloak Admin API
- optionally replaces an existing realm when `--replace-existing` is passed
- strips a few export fields that are known to be incompatible across nearby Keycloak versions (e.g. export 26.2.x -> server 26.0.x)

Example using your export file:

```bash
cd infra/keycloak
KEYCLOAK_URL=https://billie-keycloak-nonprod.fly.dev \
ADMIN_USER=admin \
ADMIN_PASSWORD='your-admin-password' \
ENV=demo \
EXPORT_FILE="/Users/rohansharp/Downloads/realm-export-billie-customer.json" \
./scripts/setup-realm-from-export.sh --replace-existing
```

Using per-environment files (recommended):

1. Update `infra/keycloak/.env.<env>` with the correct values (especially `ADMIN_PASSWORD` and `EXPORT_FILE`).
2. Run:

```bash
cd infra/keycloak
ENV=demo ./scripts/setup-realm-from-export.sh --replace-existing
```

Optional variables:

- `APP_URL` (default: `https://billie-crm-${ENV}.fly.dev`)
- `REALM_BASE` (default: inferred by stripping `-dev|-demo|-staging|-prod` from exported realm name)

Safety:

- Use `--dry-run` to generate transformed JSON only (no API calls)
- Existing realms are not overwritten unless `--replace-existing` is set

## Custom user attributes (Customer ID)

The **Customer ID** field on users is a **realm user profile** attribute. This is realm configuration (stored in the Keycloak database), so it is **not** part of the Docker image. You configure it per realm on the server.

### Option 1: Manual setup in Admin Console

1. Log in to the Keycloak Admin Console (e.g. `https://billie-keycloak-nonprod.fly.dev/admin`).
2. Select the realm where you want the attribute (e.g. your application realm, not `master`).
3. Go to **Realm settings** → **User profile** tab.
4. Open the **Attributes** sub-tab (or **JSON Editor** to paste config).
5. Add a new attribute:
   - **Attribute name:** `customerId` (internal key; use this when setting user attributes via API).
   - **Display name:** `Customer ID`.
   - Ensure it is in an attribute group so it appears in the user details (e.g. **General** or **Attributes**).
   - Set **Permissions** so admins can view and edit (e.g. view: `admin`, edit: `admin`).
6. Save.

The Customer ID field will then appear under the **Details** tab when editing a user, and you can set values per user.

### Option 2: Apply via script (repeatable / automation)

A script is provided to add the Customer ID attribute to a realm’s user profile via the Keycloak Admin API. Use this to keep the same config across environments or to automate after deploy.

From the repo root:

```bash
cd infra/keycloak
KEYCLOAK_URL=https://billie-keycloak-nonprod.fly.dev \
REALM=your-realm-name \
ADMIN_USER=admin \
ADMIN_PASSWORD='your-admin-password' \
./scripts/apply-customer-id-attribute.sh
```

- `KEYCLOAK_URL`: Keycloak base URL (no trailing slash).
- `REALM`: Realm to configure (e.g. your app realm, not `master`).
- `ADMIN_USER` / `ADMIN_PASSWORD`: Admin console credentials (same as `KC_BOOTSTRAP_ADMIN_*`).

The script fetches the current user profile, adds the `customerId` attribute if missing, and updates the realm. Requires `curl` and `jq`.

### Exporting from your local Keycloak (optional)

If your local Keycloak already has the Customer ID attribute configured, you can export the realm and use it on the server:

1. **Export realm** (local): Admin Console → Realm settings → **Action** → **Partial export** (or **Export**). Enable **Export groups and roles** and **Export clients** if needed. Download the JSON.
2. **Import on server**: Admin Console on Fly → **Create realm** → **Browse** and upload the JSON, or use the Admin API/CLI to create/update the realm from the file.

The user profile (including Customer ID) is part of the realm export, so the attribute will be present in the imported realm.

## Client scope mappers (e.g. Customer ID in tokens)

To have **Customer ID** (and other custom claims) available in ID tokens, access tokens, and the UserInfo endpoint, configure **client scope mappers** on the client’s dedicated scope.

### 1. Ensure the dedicated client scope is assigned

1. **Clients** → select your app client (e.g. **billie-app**) → **Client scopes** tab.
2. Under **Assigned client scopes**, ensure the client’s **dedicated** scope (e.g. **billie-app-dedicated**) is listed.
3. Set its **Assigned type** to **Default** so it is always included in tokens for this client.

### 2. Add a User Attribute mapper for Customer ID

1. **Client scopes** (left sidebar) → open the **dedicated** scope (e.g. **billie-app-dedicated**) → **Mappers** tab.
2. **Add mapper** → **By configuration** → **User Attribute**.
3. Configure:
   - **Name:** `customer_id`
   - **User Attribute:** `customerId` (must match the realm user profile attribute name)
   - **Token Claim Name:** `customer_id` (claim name in tokens)
   - **Claim JSON Type:** String
   - **Add to ID token:** On
   - **Add to access token:** On
   - **Add to userinfo:** On
   - **Add to token introspection:** On (if you use introspection)
   - **Multivalued:** Off
4. Save.

After this, tokens issued for that client will include a `customer_id` claim when the user has the attribute set.

### 3. Optional: Audience mapper

If your app expects an `aud` claim (e.g. for API validation), add an **Audience** mapper to the same dedicated scope:

1. **Add mapper** → **By configuration** → **Audience**.
2. **Name:** e.g. `billie-app-audience`
3. **Included Client Audience:** your client ID (e.g. `billie-app`)
4. Turn **Add to ID token** and **Add to access token** (and optionally token introspection) **On**.
5. Save.

### Note on attribute name

The **User Attribute** field in the mapper must match the **attribute name** in the realm user profile (e.g. `customerId` or `customer_id`—use whatever you set when adding the attribute). The **Token Claim Name** can differ (e.g. `customer_id` in tokens) depending on your app’s expectations.

### Option 2: Apply via script (repeatable / automation)

A script adds the User Attribute mapper (and optionally the Audience mapper) to the client’s **dedicated** scope (`{CLIENT_ID}-dedicated`). The client must already exist (Keycloak creates the dedicated scope when you create the client).

```bash
cd infra/keycloak
KEYCLOAK_URL=https://billie-keycloak-nonprod.fly.dev \
REALM=billie-customer-demo \
CLIENT_ID=billie-app \
ADMIN_USER=admin \
ADMIN_PASSWORD='your-admin-password' \
./scripts/apply-client-scope-mappers.sh
```

Optional env vars:

- `USER_ATTRIBUTE_NAME` — realm user profile attribute (default: `customerId`)
- `TOKEN_CLAIM_NAME` — claim name in tokens (default: `customer_id`)
- `ADD_AUDIENCE_MAPPER` — set to `false` to skip the Audience mapper (default: `true`)

Requires `curl` and `jq`. Run after creating the client in Keycloak; the script is idempotent (skips mappers that already exist).

## Post-deploy checklist (new realm or client)

When setting up a new realm or client on the server, use this as a quick checklist:

| Item | Where |
|------|--------|
| **Themes** | Realm settings → Themes → Login & Email → **billie** |
| **Customer ID user profile attribute** | Realm settings → User profile → add `customerId` (or run `scripts/apply-customer-id-attribute.sh`) |
| **Valid redirect URIs** | Clients → [your client] → Settings → add app callback URL(s) to avoid “Invalid parameter: redirect_uri” |
| **Client scope mappers** | Clients → [your client] → Client scopes → dedicated scope → Mappers (or run `scripts/apply-client-scope-mappers.sh` with `CLIENT_ID=your-client`) |
| **Web origins** (if SPA) | Clients → [your client] → Settings → **Web origins**: add app origin(s), e.g. `https://billie-crm-demo.fly.dev` or `+` to allow all redirect URIs’ origins |

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

For an existing instance where secrets are already set, you can skip the secrets check:

```bash
./deploy.sh nonprod --skip-secrets
./deploy.sh prod --skip-secrets
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

### Invalid parameter: redirect_uri (on login redirect from application)

This error appears when the application redirects users to Keycloak for login and the **callback URL** the application sends is not allowed for the Keycloak client.

**Fix:** Register the application’s callback URL in Keycloak:

1. Log in to the Keycloak Admin Console (e.g. `https://billie-keycloak-nonprod.fly.dev/admin`).
2. Select the **realm** your application uses (e.g. `billie-customer-demo`).
3. Go to **Clients** → open the **client** your app uses (the one that sends the login request).
4. Open the **Settings** (or **Credentials** / **Client details**) tab.
5. In **Valid redirect URIs**, add the **exact** URL(s) your application uses as the OAuth/OIDC callback, for example:
   - Production: `https://billie-crm-demo.fly.dev/*` or a specific path like `https://billie-crm-demo.fly.dev/api/auth/callback/keycloak`
   - Local: `http://localhost:3000/*` or `http://localhost:3000/api/auth/callback/keycloak`
   - Use a wildcard like `https://your-app.fly.dev/*` to allow any path on that origin.
6. If your app uses post-logout redirects, add the same URLs to **Valid post logout redirect URIs**.
7. Save.

The value must match exactly what the application sends (including scheme, host, port, and path). If you’re unsure, check the app’s auth config for the callback URL or look at the browser address bar when the error appears—the `redirect_uri` may be in the query string.

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
