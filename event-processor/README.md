# Billie Servicing Event Processor

Python daemon that consumes events from the Redis inbox stream and writes projections to MongoDB Payload collections.

## Features

- **Event SDK Integration**: Uses official Billie Event SDKs for typed event parsing
- **Transactional Guarantees**: At-least-once delivery with deduplication for exactly-once semantics
- **Pending Recovery**: Processes unacknowledged messages on startup
- **Dead Letter Queue**: Failed messages are moved to DLQ for manual review

## Events Handled

### Account Events (billie_accounts_events SDK)

| Event | Handler | Target Collection |
|-------|---------|-------------------|
| `account.created.v1` | `handle_account_created` | `loan-accounts` |
| `account.updated.v1` | `handle_account_updated` | `loan-accounts` |
| `account.status_changed.v1` | `handle_account_status_changed` | `loan-accounts` |
| `account.schedule.created.v1` | `handle_schedule_created` | `loan-accounts` |

### Customer Events (billie_customers_events SDK)

| Event | Handler | Target Collection |
|-------|---------|-------------------|
| `customer.changed.v1` | `handle_customer_changed` | `customers` |
| `customer.created.v1` | `handle_customer_changed` | `customers` |
| `customer.verified.v1` | `handle_customer_verified` | `customers` |

### Conversation Events (Manual Parsing)

| Event | Handler | Target Collection |
|-------|---------|-------------------|
| `conversation_started` | `handle_conversation_started` | `conversations` |
| `user_input` | `handle_utterance` | `conversations` |
| `assistant_response` | `handle_utterance` | `conversations` |
| `final_decision` | `handle_final_decision` | `conversations` |

## Installation

### Prerequisites

- Python 3.11+
- Poetry or pip
- Redis
- MongoDB
- GitHub token for SDK installation

### Install Dependencies

```bash
# Using Poetry
poetry install

# Or using pip (requires GITHUB_TOKEN)
export GITHUB_TOKEN=your_token
pip install -r requirements.txt
pip install git+https://${GITHUB_TOKEN}@github.com/BillieLoans/billie-event-sdks.git@accounts-v2.2.0#subdirectory=packages/accounts
pip install git+https://${GITHUB_TOKEN}@github.com/BillieLoans/billie-event-sdks.git@customers-v2.0.0#subdirectory=packages/customers
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6383` | Redis connection URL |
| `MONGODB_URL` | `mongodb://localhost:27017` | MongoDB connection URL |
| `DB_NAME` | `billie-servicing` | MongoDB database name |
| `MAX_RETRIES` | `3` | Max retries before DLQ |
| `DEDUP_TTL_SECONDS` | `86400` | Deduplication key TTL (24h) |
| `MAX_PAYLOAD_BYTES` | `262144` | Max event payload size (256 KB). Oversized events are rejected to DLQ. |
| `MAX_UTTERANCES` | `2000` | Max utterances per conversation document (oldest trimmed) |
| `MAX_NOTICEBOARD_ENTRIES` | `500` | Max noticeboard entries per conversation document (oldest trimmed) |
| `LOG_LEVEL` | `INFO` | Logging level |

## Running

```bash
# Using Poetry
poetry run billie-servicing

# Using Python directly
python -m billie_servicing.main

# Using Docker
docker-compose up event-processor
```

### AWS SSO in Docker

The Docker Compose config mounts only `~/.aws/config` (SSO profile definitions) and
`~/.aws/sso/` (cached SSO tokens) into the container — not `~/.aws/credentials`. This
prevents accidental exposure of long-lived access keys for other AWS accounts.

Before starting the container, authenticate via SSO on the host:

```bash
aws sso login --profile your-profile
docker-compose up
```

The cached SSO token is shared read-only with the container.

## Development

```bash
# Run tests (use requirements-dev.txt for test dependencies)
pip install -r requirements-dev.txt
pytest

# Run with coverage
pytest --cov=billie_servicing

# Type checking
poetry run mypy src

# Linting
poetry run ruff check src
```

## Architecture

```
inbox:billie-servicing (Redis Stream)
         │
         ▼
┌─────────────────────────────────┐
│     Event Processor (Daemon)    │
│                                 │
│  ┌───────────────────────────┐  │
│  │   Billie Event SDKs       │  │
│  │   • parse_account_message │  │
│  │   • parse_customer_message│  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │   Event Handlers          │  │
│  │   • Account handlers      │  │
│  │   • Customer handlers     │  │
│  │   • Conversation handlers │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│      MongoDB (Payload CMS)      │
│                                 │
│  • loan-accounts                │
│  • customers                    │
│  • conversations                │
└─────────────────────────────────┘
```

## Transactional Guarantees

1. **Consumer Groups**: Messages are assigned to consumers via Redis consumer groups
2. **Manual XACK**: Messages are only acknowledged after successful MongoDB write
3. **Deduplication**: Event IDs are tracked with TTL to prevent duplicate processing
4. **Pending Recovery**: On startup, unacknowledged messages are re-processed
5. **Dead Letter Queue**: Failed messages (after max retries) are moved to DLQ

