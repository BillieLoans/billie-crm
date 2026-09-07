# CRM event-processor context

Read repository AGENTS.md and CLAUDE.md. Verified during the 2026-09-07 audit.

- Python asyncpg writes Payload-managed Postgres tables; handlers and migrations
  form a cross-language schema contract. MongoDB wording in old docs is stale.
- processor.py checks a Redis dedup key, commits a Postgres handler, then marks
  dedup and ACKs. The key uses transport stream/message identity. This is not an
  atomic inbox transaction or a guarantee of exactly-once effects.
- Conversation/noticeboard append handlers use fresh UUIDs. Replays can append
  duplicate logical events; upsert helpers do not make every handler idempotent.
- account.updated handling logs staleness but still applies balances. Do not add
  timestamp-based skipping as a substitute for a reliable source aggregate version.
- Utterance/noticeboard cap SQL currently orders ASC then deletes OFFSET N-1,
  removing the newest existing tail. Preserve this audit context until fixed;
  write boundary and replay tests for any retention change.
- Production declares multiple CRM machines with event processing enabled. Tests
  must cover concurrent processing, crashes between DB commit and Redis ACK, and
  newer events arriving before old pending work.

Audit evidence: billie-platform-services/docs/audit-2026-09-07/AUDIT.md (repository-relative after the repository name), F07/F10/F17.
Do not run the daemon or replay/reset tools against production during local tests.
