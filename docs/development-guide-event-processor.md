# Development Guide: Event Processor

## Overview

The Event Processor is a Python asyncio daemon that consumes domain events from Redis Streams and maintains MongoDB read models (projections) for the Billie CRM web application. It is the **only** process that writes domain data to MongoDB -- the web app treats these collections as read-only.

## Prerequisites

- **Python** 3.11+ (`pyproject.toml` targets `py311`)
- **pip** or **Poetry** (both are supported)
- **MongoDB** (local instance or Docker)
- **Redis** (local instance or Docker)
- **GITHUB_TOKEN** environment variable with read access to `BillieLoans/billie-event-sdks` (required to install private Billie Event SDKs from GitHub)

## Installation

### With pip (recommended for local development)

```bash
cd event-processor

# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate  # macOS/Linux

# Set GitHub token for private SDK access
export GITHUB_TOKEN=your_token

# Install runtime dependencies
pip install -r requirements.txt

# Install dev dependencies (includes pytest, ruff, pytest-cov)
pip install -r requirements-dev.txt
```

### With Poetry

```bash
cd event-processor

# Poetry will handle venv creation
export GITHUB_TOKEN=your_token
poetry install
```

### Dependencies

**Runtime** (`requirements.txt`):
| Package | Version | Purpose |
|---------|---------|---------|
| redis | 5.2.1 | Async Redis client for stream consumption |
| motor | 3.7.1 | Async MongoDB driver |
| pydantic | 2.10.0 | Data validation and settings |
| pydantic-settings | 2.11.0 | Environment-based configuration |
| structlog | 25.5.0 | Structured logging |

Plus private Billie Event SDKs installed from `github.com/BillieLoans/billie-event-sdks`:
- `billie-accounts-events` (tag: `accounts-v2.7.0`)
- `billie-customers-events` (tag: `customers-v2.0.0`)
- `billie-ledger-events` (tag: `ledger-v1.1.0`)

**Dev** (`requirements-dev.txt`):
| Package | Version | Purpose |
|---------|---------|---------|
| pytest | 8.3.4 | Test framework |
| pytest-asyncio | 0.24.0 | Async test support |
| pytest-cov | 4.1.0 | Coverage reporting |

## Running

```bash
cd event-processor
python -m billie_servicing.main
```

On startup, the processor:
1. Connects to Redis (with retry and exponential backoff)
2. Connects to MongoDB (with retry; fatal error on bad URI)
3. Creates consumer groups on both streams (if they don't exist)
4. Replays any pending (un-ACKed) messages from previous runs
5. Begins listening for new events on both streams

Graceful shutdown via `SIGTERM` or `SIGINT` (Ctrl+C).

## Configuration

All configuration is via environment variables, managed by Pydantic Settings in `src/billie_servicing/config.py`.

### Connection settings

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6383` | Redis connection URL |
| `DATABASE_URI` | `mongodb://localhost:27017/billie-servicing` | MongoDB connection string |
| `DB_NAME` | `billie-servicing` | MongoDB database name |

### Stream settings

| Variable | Default | Description |
|----------|---------|-------------|
| `INBOX_STREAM` | `inbox:billie-servicing` | External event stream (from upstream services) |
| `INTERNAL_STREAM` | `inbox:billie-servicing:internal` | CRM-originated event stream (from the web app) |
| `CONSUMER_GROUP` | `billie-servicing-processor` | Redis consumer group name |
| `DLQ_STREAM` | `dlq:billie-servicing` | Dead letter queue stream (capped at 10,000 entries) |

### Processing settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_RETRIES` | `3` | Max delivery attempts before moving to DLQ |
| `DEDUP_TTL_SECONDS` | `86400` (24h) | TTL for deduplication keys in Redis |
| `BATCH_SIZE` | `10` | Messages read per XREADGROUP call |
| `BLOCK_TIMEOUT_MS` | `1000` | XREADGROUP block timeout in milliseconds |
| `MAX_PAYLOAD_BYTES` | `262144` (256 KB) | Maximum event payload size; oversized events go to DLQ |
| `MAX_UTTERANCES` | `2000` | Cap on utterances array per conversation document |
| `MAX_NOTICEBOARD_ENTRIES` | `500` | Cap on noticeboard array per conversation document |

### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | Log level |

### Production TLS enforcement

When `NODE_ENV=production`, the processor validates that:
- Redis URL uses `rediss://` (TLS)
- MongoDB URI uses `mongodb+srv://` or includes `tls=true`

## Testing

```bash
cd event-processor

# Run all tests
pytest

# Run with verbose output (default via pytest.ini addopts)
pytest -v

# Run with coverage
pytest --cov=billie_servicing

# Lint
ruff check .

# Type check
mypy src/
```

### Test configuration

Configured in `pytest.ini`:
- `asyncio_mode = auto` (async test functions are automatically detected)
- `testpaths = tests`
- Default addopts: `-v --tb=short`

### Test files

| File | Covers |
|------|--------|
| `test_handlers.py` | Account, customer, and conversation event handlers |
| `test_writeoff_handlers.py` | Write-off event handlers (requested, approved, rejected, cancelled) |
| `test_processor_connect.py` | Processor connection and initialization |
| `test_payload_size.py` | Payload size limit enforcement |
| `test_sanitize.py` | Input sanitization (`safe_str`, `strip_dollar_keys`) |

### Mock patterns

Tests use a `MockDatabase`/`MockCollection` pattern defined in `tests/conftest.py`:

- `MockCollection` provides `AsyncMock` implementations of `find_one`, `update_one`, and `insert_one`
- `MockDatabase` supports both attribute access (`db.customers`) and dict access (`db["loan-accounts"]`)
- No real MongoDB or Redis connections are needed for unit tests

## Architecture

### Entry point and handler registration

`main.py` registers **19 event handlers** across four domains, then calls `processor.start()`:

| Domain | Handlers | Event types |
|--------|----------|-------------|
| Account | 5 | `account.created.v1`, `account.updated.v1`, `account.status_changed.v1`, `account.schedule.created.v1`, `account.schedule.updated.v1` |
| Customer | 4 (2 unique handlers) | `customer.changed.v1`, `customer.created.v1`, `customer.updated.v1` (all use `handle_customer_changed`), `customer.verified.v1` |
| Conversation | 7 | `conversation_started`, `user_input`, `assistant_response`, `applicationDetail_changed`, `identityRisk_assessment`, `serviceability_assessment_results`, `fraudCheck_assessment`, `noticeboard_updated`, `final_decision`, `conversation_summary` |
| Write-off | 4 | `writeoff.requested.v1`, `writeoff.approved.v1`, `writeoff.rejected.v1`, `writeoff.cancelled.v1` |

### Processing pipeline

```
Redis XREADGROUP
    -> Payload size check (reject > 256 KB)
    -> Dedup via SET NX with 24h TTL
    -> Parse event (SDK parser for account/customer, raw dict for chat/writeoff)
    -> Dispatch to registered handler
    -> Handler writes to MongoDB
    -> XACK (only after successful write)
```

Event parsing uses the appropriate Billie Event SDK:
- `account.*` and `payment.*` events: `billie_accounts_events.parser.parse_account_message`
- `customer.*` and `application.*` events: `billie_customers_events.parser.parse_customer_message`
- Chat and write-off events: passed through as raw dicts

### Transactional guarantees

- **At-least-once delivery**: Consumer groups with manual XACK (ACK only after successful MongoDB write)
- **Exactly-once semantics**: Deduplication via `SET NX` with configurable TTL
- **No message loss**: Pending messages (`XPENDING`) are recovered on startup and after reconnection
- **Dead letter queue**: Messages that fail after `max_retries` (default: 3) attempts are moved to `dlq:billie-servicing`

### Error handling (4 layers)

1. **NOGROUP recovery**: If Redis lost persistence and consumer groups are gone, re-create them and replay backlog
2. **Connection error reconnection**: On `RedisConnectionError`, `RedisTimeoutError`, or `OSError`, reconnect with exponential backoff (1s to 30s), then re-create groups and replay pending messages
3. **Graceful cancellation**: `asyncio.CancelledError` stops the processing loop cleanly
4. **Generic catch-all**: Unexpected errors are logged; a 1-second pause prevents tight error loops

### Security: Input sanitization

The `handlers/sanitize.py` module provides two functions to prevent NoSQL injection:

- **`safe_str(value, field_name)`**: Validates that values used in MongoDB query filters are primitive types (strings). Rejects dicts and lists that MongoDB would interpret as query operators (e.g., `{"$ne": null}`). Returns empty string for `None`.
- **`strip_dollar_keys(data)`**: Recursively removes keys starting with `$` from dicts before they are stored in MongoDB. Prevents operator injection in stored documents.

### Envelope sanitization

The processor sanitizes broker message envelopes before passing them to SDKs (`sanitize_envelope` in `processor.py`). This handles type mismatches from the broker:
- `c_seq` / `seq`: coerced from empty string to `0`
- `rec`: parsed from JSON string to list
- `dat`: parsed from JSON string to dict

## Code Conventions

### Linting and formatting

- **Ruff** for linting (`line-length = 100`, `target-version = "py311"`)
  - Enabled rule sets: `E`, `F`, `W`, `I`, `N`, `UP`, `ANN`, `B`, `C4`, `SIM`
  - Ignored: `ANN101` (self type annotation), `ANN102` (cls type annotation)
- **mypy** in strict mode (`python_version = "3.11"`)

### Naming and field mapping

Python code uses `snake_case`. MongoDB documents use `camelCase` field names (for compatibility with the Payload CMS web app, which reads these documents). Handlers are responsible for mapping between the two conventions when writing to MongoDB.

### Project structure

```
event-processor/
  src/
    billie_servicing/
      __init__.py
      config.py              # Pydantic Settings configuration
      main.py                # Entry point, handler registration
      processor.py           # Core event processing loop
      handlers/
        __init__.py           # Barrel exports
        account.py            # Account event handlers (5)
        customer.py           # Customer event handlers (2 unique)
        conversation.py       # Conversation/chat event handlers (7)
        writeoff.py           # Write-off event handlers (4)
        sanitize.py           # NoSQL injection prevention
  tests/
    conftest.py              # Fixtures, MockDatabase/MockCollection
    test_handlers.py
    test_writeoff_handlers.py
    test_processor_connect.py
    test_payload_size.py
    test_sanitize.py
  requirements.txt           # Pinned runtime dependencies
  requirements-dev.txt       # Dev/test dependencies (includes runtime)
  pyproject.toml             # Poetry config, tool settings (ruff, mypy, pytest)
  pytest.ini                 # Pytest configuration
  Dockerfile                 # Production container image
```
