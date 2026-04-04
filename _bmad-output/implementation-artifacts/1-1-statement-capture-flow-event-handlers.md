# Story 1.1: Statement Capture Flow Event Handlers

Status: done

## Story

As the system,
I want to process statement capture flow events from the Redis stream,
So that conversation records include complete statement consent and retrieval data for the monitoring UI.

## Acceptance Criteria

1. **Given** a `statement_consent_initiated` event arrives on `inbox:billie-servicing`, **When** the event processor handles the event, **Then** the conversations document is upserted with `statementCapture.consentStatus` set to `initiated`, using the 3-field conversation ID fallback (`cid`, `conv`, `conversation_id`) and `safe_str()` for all string extraction.

2. **Given** a `statement_consent_complete` event arrives, **When** the event processor handles the event, **Then** `statementCapture.consentStatus` is updated to `complete`.

3. **Given** a `statement_consent_cancelled` event arrives, **When** the event processor handles the event, **Then** `statementCapture.consentStatus` is updated to `cancelled`.

4. **Given** a `basiq_job_created` event arrives, **When** the event processor handles the event, **Then** `statementCapture.basiqJobId` is stored from the event payload.

5. **Given** a `statement_retrieval_complete` event arrives, **When** the event processor handles the event, **Then** `statementCapture.retrievalComplete` is set to `true`.

6. **Given** an `affordability_report_complete` event arrives, **When** the event processor handles the event, **Then** `statementCapture.affordabilityReport` is stored as the event payload (with `strip_dollar_keys()` applied).

7. **Given** a `statement_checks_complete` event arrives, **When** the event processor handles the event, **Then** `statementCapture.checksComplete` is set to `true`.

8. **Given** any handler fails processing, **When** the failure count reaches 3, **Then** the event is moved to the DLQ following existing patterns (NFR14).

9. **Given** existing conversation event handlers, **When** the new handlers are deployed, **Then** existing handlers for accounts, customers, and write-offs continue to function unchanged (NFR13).

10. **Given** events arrive out of order (e.g., `statement_retrieval_complete` before `statement_consent_complete`), **When** the handler processes them, **Then** `upsert=True` ensures the document is created or updated without error, and no data is lost.

## Tasks / Subtasks

- [x] Task 1: Add 7 new handler functions to `conversation.py` (AC: #1-7)
  - [x] 1.1 `handle_statement_consent_initiated` — upsert `statementCapture.consentStatus: "initiated"`
  - [x] 1.2 `handle_statement_consent_complete` — upsert `statementCapture.consentStatus: "complete"`
  - [x] 1.3 `handle_statement_consent_cancelled` — upsert `statementCapture.consentStatus: "cancelled"`
  - [x] 1.4 `handle_basiq_job_created` — upsert `statementCapture.basiqJobId`
  - [x] 1.5 `handle_statement_retrieval_complete` — upsert `statementCapture.retrievalComplete: true`
  - [x] 1.6 `handle_affordability_report_complete` — upsert `statementCapture.affordabilityReport` (strip dollar keys)
  - [x] 1.7 `handle_statement_checks_complete` — upsert `statementCapture.checksComplete: true`
- [x] Task 2: Register all 7 new handlers in `main.py` `setup_handlers()` (AC: #9)
  - [x] 2.1 Add `processor.register_handler()` calls for all 7 event types
  - [x] 2.2 Add imports in `__init__.py` `__all__` list
- [x] Task 3: Write unit tests for all 7 handlers (AC: #1-7, #8, #10)
  - [x] 3.1 Test each handler creates/updates the correct field
  - [x] 3.2 Test out-of-order event handling (upsert creates doc if missing)
  - [x] 3.3 Test `safe_str()` is used for conversation ID extraction
  - [x] 3.4 Test `strip_dollar_keys()` is applied to affordability report payload
- [x] Task 4: Verify existing handlers still work (AC: #9)
  - [x] 4.1 Run existing test suite to confirm no regressions

## Dev Notes

### Handler Pattern (MUST FOLLOW)

Every handler MUST follow this exact structure from the existing `conversation.py`:

```python
async def handle_statement_consent_initiated(db: AsyncIOMotorDatabase, event: dict[str, Any]) -> None:
    """Handle statement_consent_initiated event."""
    conversation_id = safe_str(
        event.get("cid") or event.get("conv") or event.get("conversation_id"),
        "conversation_id"
    )
    log = logger.bind(conversation_id=conversation_id)
    log.info("Processing statement_consent_initiated")

    await db.conversations.update_one(
        {"conversationId": conversation_id},
        {
            "$set": {
                "statementCapture.consentStatus": "initiated",
                "updatedAt": datetime.utcnow(),
            },
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )
    log.info("statement_consent_initiated processed")
```

### Critical Rules

- **Always use 3-field fallback** for conversation ID: `event.get("cid") or event.get("conv") or event.get("conversation_id")`
- **Always use `safe_str()`** from `sanitize.py` for all string values used in query filters
- **Always use `strip_dollar_keys()`** for any nested dict/object stored in MongoDB (e.g., affordability report payload)
- **Always use `upsert=True`** — events may arrive before the conversation document exists
- **Always use `$set`** for scalar fields, `$setOnInsert` for `createdAt`
- **Always update `updatedAt`** with `datetime.utcnow()` in `$set`
- **Always bind structlog** with `conversation_id` before any log statements
- **Never break existing handlers** — new handlers are added alongside existing ones in the same file

### Event Type Names (External — DO NOT RENAME)

These event type strings come from the conversation engine and must match exactly:
```
statement_consent_initiated
statement_consent_complete
statement_consent_cancelled
basiq_job_created
statement_retrieval_complete
affordability_report_complete
statement_checks_complete
```

### MongoDB Document Shape (statementCapture subdocument)

```python
"statementCapture": {
    "consentStatus": str | None,       # "initiated", "complete", "cancelled"
    "basiqJobId": str | None,          # Basiq job identifier
    "retrievalComplete": bool,         # Default: false
    "affordabilityReport": dict | None,# Full report payload (stripped of $ keys)
    "checksComplete": bool,            # Default: false
}
```

All fields are optional — each handler sets only its own field(s). The upsert pattern means partial documents are valid.

### Files to Modify

| File | Change |
|:---|:---|
| `event-processor/src/billie_servicing/handlers/conversation.py` | Add 7 new handler functions at the end of the file |
| `event-processor/src/billie_servicing/handlers/__init__.py` | Add new handler imports to `__all__` list |
| `event-processor/src/billie_servicing/main.py` | Add 7 `processor.register_handler()` calls in `setup_handlers()` |

### Files to Create

| File | Purpose |
|:---|:---|
| `event-processor/tests/test_statement_handlers.py` | Unit tests for all 7 new handlers |

### Existing Test Pattern

Tests use `pytest` with `pytest-asyncio`. Mock MongoDB with `AsyncMock`. Example from existing tests:

```python
@pytest.mark.asyncio
async def test_handle_event(mock_db):
    event = {"cid": "conv-123", "payload": {...}}
    await handle_event_name(mock_db, event)
    mock_db.conversations.update_one.assert_called_once()
    call_args = mock_db.conversations.update_one.call_args
    assert call_args[0][0] == {"conversationId": "conv-123"}
```

### Project Structure Notes

- Event processor lives at `event-processor/src/billie_servicing/`
- Tests at `event-processor/tests/`
- All handlers in `handlers/` directory with barrel export in `__init__.py`
- Handler registration in `main.py` `setup_handlers()` function
- `sanitize.py` provides `safe_str()` and `strip_dollar_keys()`
- Config in `config.py` — streams, consumer group, DLQ settings
- Array caps: 2000 utterances, 500 noticeboard entries per conversation (defined in config)

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Communication Patterns — Event Handler Pattern]
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns — Event Type Naming]
- [Source: _bmad-output/planning-artifacts/architecture.md#Format Patterns — Conversation MongoDB Document Shape]
- [Source: _bmad-output/planning-artifacts/prd.md#Event Processing — FR25-FR29]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1]
- [Source: event-processor/src/billie_servicing/handlers/conversation.py — Existing handler pattern]
- [Source: event-processor/src/billie_servicing/handlers/sanitize.py — safe_str(), strip_dollar_keys()]
- [Source: event-processor/src/billie_servicing/main.py — setup_handlers() registration]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6

### Debug Log References

None — implementation was straightforward, no debugging required.

### Completion Notes List

- All 7 handlers follow the exact pattern from the story's Dev Notes
- `handle_basiq_job_created` extracts jobId from `event.payload.jobId` first, then `event.jobId`, then `event.job_id` as fallback
- `handle_affordability_report_complete` applies `strip_dollar_keys()` to `event.payload` when it's a dict, otherwise falls back to stripping the full event
- All handlers use `upsert=True`, 3-field conversation ID fallback, `safe_str()`, `$setOnInsert` for `createdAt`, and `$set` for `updatedAt`
- 25 unit tests, all passing; 92 total tests passing (no regressions)

### File List

- `event-processor/src/billie_servicing/handlers/conversation.py` — added 7 handler functions
- `event-processor/src/billie_servicing/handlers/__init__.py` — added imports and `__all__` entries
- `event-processor/src/billie_servicing/main.py` — added imports and `register_handler()` calls
- `event-processor/tests/test_statement_handlers.py` — created with 25 unit tests
