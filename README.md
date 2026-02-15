# Billie Servicing App

Internal staff application for managing customer loan accounts at Billie, a small amount lender in Australian financial services. Built on **Payload CMS v3** with a **Python event processor** using **Billie Event SDKs**.

## Features

- ✅ **View Loan Accounts** - Browse accounts with balances, status, repayment schedules
- ✅ **View Transactions** - Full transaction history from gRPC ledger service
- ✅ **Post Transactions** - Record payments, apply/waive fees, write-offs, adjustments
- ✅ **View Conversations** - Customer chat transcripts from loan applications
- ✅ **View Customer Details** - Personal info, address, verification status
- ✅ **Single Customer View** - Unified view of customer + accounts + conversations
- ✅ **Global Search** - Search customers, accounts, transactions

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        BILLIE SERVICING APP                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────┐              ┌─────────────────────────────┐   │
│  │   Payload CMS       │◄────────────►│        MongoDB              │   │
│  │   (Next.js)         │   Reads      │                             │   │
│  │                     │              │  • loan-accounts            │   │
│  │   • Staff UI        │              │  • customers                │   │
│  │   • API Routes      │              │  • conversations            │   │
│  │   • gRPC Client     │              │  • users                    │   │
│  └──────────┬──────────┘              └──────────▲──────────────────┘   │
│             │                                    │                       │
│             │ gRPC                               │ Writes                │
│             ▼                                    │                       │
│  ┌─────────────────────┐              ┌──────────┴──────────────────┐   │
│  │  Accounting Ledger  │              │  Python Event Processor     │   │
│  │  Service (External) │              │  (Billie SDKs)              │   │
│  └─────────────────────┘              │                             │   │
│                                       │  • account.created.v1       │   │
│                                       │  • account.schedule.created │   │
│                                       │  • customer.changed.v1      │   │
│                                       └──────────▲──────────────────┘   │
│                                                  │                       │
│                                       ┌──────────┴──────────────────┐   │
│                                       │  Redis (inbox:billie-srv)   │   │
│                                       └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Deployment to Fly.io

For cloud deployment to Fly.io, see **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

Quick deploy:
```bash
# To Deploy with new event SDKs (loaded from billlie github)
make deploy ENV=demo GITHUB_TOKEN="ghp_your_token_here" NO_CACHE=1

# To deploy with existing SDKs
make deploy ENV=demo GITHUB_TOKEN="ghp_your_token_here"
```
NO_CHACHE=1 forces the sdks to be re-downloaded from git. You only need it once to clear the bad cache, then you can stop using it.
First deploy after you started passing GITHUB_TOKEN: use
make deploy ENV=demo GITHUB_TOKEN="..." NO_CACHE=1
so the “install SDKs” layer actually runs and gets cached with the SDKs installed.
Later deploys: use
make deploy ENV=demo GITHUB_TOKEN="..."
with no NO_CACHE=1. The cache will be the “SDKs installed” layer, so it will keep using that.
If you’ve already done a successful deploy with NO_CACHE=1 and the event processor is running, you don’t need NO_CACHE=1 anymore.

## Quick Start (Local Development)

### Option 1: Docker Compose (Recommended)

Single-container setup running both the Next.js frontend (HTTPS) and Python event processor.

**Prerequisites:**
- Docker and Docker Compose installed
- MongoDB running on your host machine (port 27017)
- Redis running on your host machine (port 6379)
- SSL certificates in `certs/` directory

**1. Generate SSL Certificates:**

```bash
brew install mkcert
mkcert -install
mkdir -p certs && cd certs
mkcert localhost 127.0.0.1 ::1
mv localhost+2.pem localhost.pem
mv localhost+2-key.pem localhost-key.pem
cd ..
```

**2. Create .env file:**

```bash
cat > .env << 'EOF'
# Use host.docker.internal to connect to services on your Mac
DATABASE_URI=mongodb://host.docker.internal:27017/billie-servicing
REDIS_URL=redis://host.docker.internal:6379
LEDGER_SERVICE_URL=host.docker.internal:50051

# Payload CMS
PAYLOAD_SECRET=your-secret-key-change-in-production

# Required for building with Billie SDKs
GITHUB_TOKEN=your_github_token_here
EOF
```

**3. Build and start:**

```bash
docker compose up --build -d
```

**4. View logs:**

```bash
docker compose logs -f
```

**5. Access the app:**
- Admin Panel: https://localhost:3000/admin
- Frontend: https://localhost:3000

**Other Docker commands:**

```bash
# Rebuild after code changes
docker compose up --build -d

# Stop all services
docker compose down

# Shell into the container
docker compose exec billie-crm bash
```

See [DOCKER.md](DOCKER.md) for more details on the container architecture.

### Option 2: Local Development

**Prerequisites:**
- Node.js 18+ and pnpm
- MongoDB running on `localhost:27017`
- Redis running on `localhost:6383`

```bash
# 1. Create .env file
cat > .env << 'EOF'
PAYLOAD_SECRET=your-secret-key-change-in-production
DATABASE_URI=mongodb://localhost:27017/billie-servicing
REDIS_URL=redis://localhost:6383
LEDGER_SERVICE_URL=localhost:50051
EOF

# 2. Install dependencies
pnpm install

# 3. Generate Payload types
pnpm generate:types

# 4. Start development server
pnpm dev

# 5. Open http://localhost:3000/admin
```

## Project Structure

```
billie-crm/
├── src/
│   ├── app/
│   │   ├── (frontend)/
│   │   │   └── customer/[customerId]/   # Single Customer View UI
│   │   ├── (payload)/                   # Payload admin
│   │   └── api/
│   │       ├── ledger/                  # gRPC proxy routes
│   │       │   ├── transactions/
│   │       │   ├── balance/
│   │       │   ├── repayment/
│   │       │   ├── late-fee/
│   │       │   ├── waive-fee/
│   │       │   ├── write-off/
│   │       │   └── adjustment/
│   │       └── customer/[customerId]/   # Single Customer View API
│   ├── collections/
│   │   ├── LoanAccounts.ts              # Loan accounts with schedules
│   │   ├── Customers.ts                 # Customer profiles
│   │   ├── Conversations.ts             # Chat transcripts
│   │   └── Users.ts                     # Staff users
│   └── server/
│       └── grpc-client.ts               # AccountingLedgerService client
├── event-processor/                      # Python daemon
│   ├── src/billie_servicing/
│   │   ├── processor.py                 # Event processor with SDKs
│   │   ├── main.py                      # Entry point
│   │   └── handlers/
│   │       ├── account.py               # account.* events
│   │       ├── customer.py              # customer.* events
│   │       └── conversation.py          # chat events
│   ├── pyproject.toml
│   └── Dockerfile
├── proto/
│   └── accounting_ledger.proto          # gRPC service definition
└── docker-compose.yml
```

## Event Processing

### Billie Event SDKs

The Python event processor uses official Billie SDKs for typed event parsing:

```bash
# SDK Packages (from GitHub)
billie-accounts-events  # v2.2.0 - account.*, payment.* events
billie-customers-events # v2.0.0 - customer.*, application.* events
```

### Events Handled

| Event | SDK | Target Collection |
|-------|-----|-------------------|
| `account.created.v1` | billie_accounts_events | loan-accounts |
| `account.updated.v1` | billie_accounts_events | loan-accounts |
| `account.status_changed.v1` | billie_accounts_events | loan-accounts |
| `account.schedule.created.v1` | billie_accounts_events | loan-accounts |
| `customer.changed.v1` | billie_customers_events | customers |
| `customer.created.v1` | billie_customers_events | customers |
| `customer.verified.v1` | billie_customers_events | customers |
| `conversation_started` | - | conversations |
| `user_input` | - | conversations |
| `assistant_response` | - | conversations |

### Running the Event Processor

**With Docker:**
```bash
docker-compose up event-processor
```

**Standalone:**
```bash
cd event-processor
pip install -r requirements.txt

# Install Billie SDKs (requires GITHUB_TOKEN)
export GITHUB_TOKEN=your_token
pip install "git+https://${GITHUB_TOKEN}@github.com/BillieLoans/billie-event-sdks.git@accounts-v2.2.0#subdirectory=packages/accounts"
pip install "git+https://${GITHUB_TOKEN}@github.com/BillieLoans/billie-event-sdks.git@customers-v2.0.0#subdirectory=packages/customers"

# Run
python -m billie_servicing.main
```

## API Routes

### Ledger Read Operations

| Route | Method | Description |
|-------|--------|-------------|
| `/api/ledger/transactions?accountId=X` | GET | Get transactions |
| `/api/ledger/balance?accountId=X` | GET | Get current balance |
| `/api/ledger/statement?accountId=X&periodStart=Y&periodEnd=Z` | GET | Generate statement |

### Ledger Write Operations

| Route | Method | Description |
|-------|--------|-------------|
| `/api/ledger/repayment` | POST | Record repayment |
| `/api/ledger/late-fee` | POST | Apply late fee |
| `/api/ledger/waive-fee` | POST | Waive fees |
| `/api/ledger/write-off` | POST | Write off account |
| `/api/ledger/adjustment` | POST | Make adjustment |

### Customer Data

| Route | Method | Description |
|-------|--------|-------------|
| `/api/customer/[customerId]` | GET | Single Customer View data |

## Payload Collections

### LoanAccounts

- `loanAccountId`, `accountNumber`, `customerIdString`
- `loanTerms` (loanAmount, loanFee, totalPayable, openedDate)
- `balances` (currentBalance, totalOutstanding, totalPaid)
- `lastPayment` (date, amount)
- `accountStatus` (active, paid_off, in_arrears, written_off)
- `repaymentSchedule` with nested `payments[]` array

### Customers

- `customerId`, `firstName`, `lastName`, `fullName`
- `emailAddress`, `mobilePhoneNumber`, `dateOfBirth`
- `residentialAddress` (streetNumber, streetName, suburb, state, postcode)
- `identityVerified`, `ekycStatus`
- `staffFlag`, `investorFlag`, `founderFlag`

### Conversations

- `conversationId`, `applicationNumber`, `status`
- `utterances[]` array with chat messages
- `purpose`, `facts[]`

## Testing

```bash
# Run unit tests
pnpm exec vitest run tests/unit --config ./vitest.config.mts

# Run all tests
pnpm test

# Run e2e tests
pnpm test:e2e
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PAYLOAD_SECRET` | Payload CMS secret key | (required) |
| `DATABASE_URI` | MongoDB connection string | (required) |
| `REDIS_URL` | Redis connection string | `redis://localhost:6383` |
| `LEDGER_SERVICE_URL` | gRPC ledger service URL | `localhost:50051` |
| `GITHUB_TOKEN` | GitHub token for SDK installation | (required for event-processor) |

> **Note:** When running in Docker, use `host.docker.internal` instead of `localhost` to connect to services running on your host machine (e.g., `mongodb://host.docker.internal:27017/billie-servicing`).

## Documentation

- [Docker Setup](DOCKER.md)
- [Features Specification](Requirements/v2-servicing-app/FEATURES.md)
- [Architecture](Requirements/v2-servicing-app/ARCHITECTURE.md)
- [Data Model](Requirements/v2-servicing-app/DATA_MODEL.md)
- [Implementation Plan](Requirements/v2-servicing-app/IMPLEMENTATION_PLAN.md)
