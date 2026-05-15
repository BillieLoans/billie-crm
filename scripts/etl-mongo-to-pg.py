"""One-off ETL: copy CRM-owned collections from Mongo to Postgres.

Most of billie-crm's data is event-sourced: customers, loan accounts,
conversations, applications, notifications, write-off requests rebuild
themselves from the Redis stream when the new processor starts up. The
three collections in this script are *not* event-sourced — Payload owns
them and writes directly:

    users         — Payload auth, password salt+hash preserved verbatim.
    contact_notes — staff-authored notes, Tiptap JSON content, amendments
                    flattened to self-referencing rows (amends_note_id).
    media         — file metadata for S3-backed uploads.

Usage (from project root, runs inside the billie-platform-crm container or
with host-mapped ports — both motor and asyncpg are installed there):

    python3 scripts/etl-mongo-to-pg.py \\
        --mongo "mongodb://host.docker.internal:27017/billie-servicing" \\
        --pg    "postgresql://billie_crm:billie_dev_password@host.docker.internal:5432/billie_crm" \\
        --collection all

    # or run them piecemeal:
    python3 scripts/etl-mongo-to-pg.py ... --collection users
    python3 scripts/etl-mongo-to-pg.py ... --collection media
    python3 scripts/etl-mongo-to-pg.py ... --collection contact_notes

Each collection is re-runnable (ON CONFLICT DO NOTHING on the natural key).
contact_notes requires users + customers (the latter rebuilt by the event
processor replay) to already exist; the script will skip notes whose FKs
can't be resolved and report the count.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any

import asyncpg
import motor.motor_asyncio


VALID_COLLECTIONS = {"users", "media", "contact_notes", "all"}


# ---------------------------------------------------------------------------
# Cross-database ID resolution
# ---------------------------------------------------------------------------


class IdResolver:
    """Map Mongo ObjectIds → Postgres UUIDs for cross-collection FKs.

    Mongo stores related rows as ObjectId refs (e.g. ``contact_notes.customer``
    points at a Mongo customer's ``_id``). Postgres uses Payload-generated
    UUIDs and the natural string keys (``customers.customer_id``,
    ``conversations.conversation_id``, etc). We bridge by looking up the
    Mongo doc, reading its natural key, and finding the pg row by that key.

    Results are cached per (collection, mongo_id) so a contact-notes ETL
    touching the same customer 50 times only does one lookup.
    """

    def __init__(self, mongo_db: Any, pg: asyncpg.Connection) -> None:
        self.mongo = mongo_db
        self.pg = pg
        self._cache: dict[tuple[str, Any], Any | None] = {}

    async def customer(self, mongo_id: Any) -> Any | None:
        return await self._resolve_via(
            "customer", mongo_id, "customers", "customerId",
            "SELECT id FROM customers WHERE customer_id = $1",
        )

    async def loan_account(self, mongo_id: Any) -> Any | None:
        return await self._resolve_via(
            "loan-accounts", mongo_id, "loan-accounts", "loanAccountId",
            "SELECT id FROM loan_accounts WHERE loan_account_id = $1",
        )

    async def application(self, mongo_id: Any) -> Any | None:
        return await self._resolve_via(
            "applications", mongo_id, "applications", "applicationNumber",
            "SELECT id FROM applications WHERE application_number = $1",
        )

    async def conversation(self, mongo_id: Any) -> Any | None:
        return await self._resolve_via(
            "conversations", mongo_id, "conversations", "conversationId",
            "SELECT id FROM conversations WHERE conversation_id = $1",
        )

    async def user(self, mongo_id: Any) -> Any | None:
        return await self._resolve_via(
            "user", mongo_id, "users", "email",
            "SELECT id FROM users WHERE email = $1",
        )

    async def _resolve_via(
        self,
        cache_key: str,
        mongo_id: Any,
        mongo_collection: str,
        natural_key_field: str,
        pg_sql: str,
    ) -> Any | None:
        if not mongo_id:
            return None
        ck = (cache_key, mongo_id)
        if ck in self._cache:
            return self._cache[ck]
        doc = await self.mongo[mongo_collection].find_one({"_id": mongo_id})
        natural = doc.get(natural_key_field) if doc else None
        pg_uuid = await self.pg.fetchval(pg_sql, natural) if natural else None
        self._cache[ck] = pg_uuid
        return pg_uuid


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


async def migrate_users(mongo_db: Any, pg: asyncpg.Connection) -> tuple[int, int]:
    """Copy Payload users 1:1. Password salt+hash preserved verbatim so
    existing credentials keep working post-cutover."""
    users = await mongo_db.users.find({}).to_list(length=None)
    print(f"[users] Found {len(users)} docs in Mongo")
    migrated = 0
    skipped = 0
    for u in users:
        email = u.get("email")
        if not email:
            continue
        status = await pg.execute(
            """
            INSERT INTO users
              (role, first_name, last_name, email, salt, hash,
               login_attempts, api_key, api_key_index, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (email) DO NOTHING
            """,
            u.get("role") or "readonly",
            u.get("firstName") or "",
            u.get("lastName") or "",
            email,
            u.get("salt"),
            u.get("hash"),
            u.get("loginAttempts") or 0,
            u.get("apiKey"),
            u.get("apiKeyIndex"),
            u.get("createdAt"),
            u.get("updatedAt"),
        )
        if status.endswith("0 0"):
            skipped += 1
            print(f"  - {email}: already exists, skipped")
        else:
            migrated += 1
            print(f"  - {email}: migrated ({u.get('role')})")
    return migrated, skipped


# ---------------------------------------------------------------------------
# Media
# ---------------------------------------------------------------------------


async def migrate_media(mongo_db: Any, pg: asyncpg.Connection) -> tuple[int, int]:
    """Copy upload metadata. The filename column carries a UNIQUE constraint
    so re-runs are idempotent. Files themselves live in S3 — those keys
    don't change."""
    docs = await mongo_db.media.find({}).to_list(length=None)
    print(f"[media] Found {len(docs)} docs in Mongo")
    migrated = 0
    skipped = 0
    for m in docs:
        filename = m.get("filename")
        if not filename:
            continue
        focal = m.get("focalPoint") or {}
        status = await pg.execute(
            """
            INSERT INTO media
              (alt, url, thumbnail_u_r_l, filename, mime_type, filesize,
               width, height, focal_x, focal_y, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (filename) DO NOTHING
            """,
            m.get("alt") or "",
            m.get("url"),
            m.get("thumbnailURL"),
            filename,
            m.get("mimeType"),
            m.get("filesize"),
            m.get("width"),
            m.get("height"),
            focal.get("x"),
            focal.get("y"),
            m.get("createdAt"),
            m.get("updatedAt"),
        )
        if status.endswith("0 0"):
            skipped += 1
        else:
            migrated += 1
    print(f"[media] migrated={migrated} skipped={skipped}")
    return migrated, skipped


# ---------------------------------------------------------------------------
# Contact notes (the gnarliest one — many FKs to resolve, amendments array)
# ---------------------------------------------------------------------------


_CONTACT_INSERT_SQL = """
INSERT INTO contact_notes
  (id, customer_id, loan_account_id, application_id, conversation_id,
   channel, topic, contact_direction, subject, content, priority, sentiment,
   created_by_id, amends_note_id, status, created_at, updated_at)
VALUES
  (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5,
   $6, $7, $8, $9, $10::jsonb, $11, $12,
   $13, $14, $15, $16, $17)
RETURNING id
"""


def _coerce_str(v: Any) -> str:
    return str(v) if v is not None else ""


async def migrate_contact_notes(
    mongo_db: Any, pg: asyncpg.Connection
) -> tuple[int, int]:
    """Port contact notes. Resolves Mongo ObjectId FKs → pg uuids via
    IdResolver. Amendments in the Mongo array are flattened into separate
    contact_notes rows with amends_note_id pointing back at the parent's
    new pg uuid (the pg schema models amendments as self-references,
    not embedded docs)."""
    docs = await mongo_db["contact-notes"].find({}).to_list(length=None)
    print(f"[contact_notes] Found {len(docs)} docs in Mongo")
    resolver = IdResolver(mongo_db, pg)

    migrated = 0
    skipped = 0

    for n in docs:
        mongo_oid = n.get("_id")

        customer_pg = await resolver.customer(n.get("customer"))
        if not customer_pg:
            skipped += 1
            print(f"  - skip {mongo_oid}: customer FK not resolvable")
            continue

        created_by_pg = await resolver.user(n.get("createdBy"))
        if not created_by_pg:
            skipped += 1
            print(f"  - skip {mongo_oid}: createdBy FK not resolvable (user not migrated?)")
            continue

        loan_account_pg = await resolver.loan_account(n.get("loanAccount"))
        application_pg = await resolver.application(n.get("application"))
        conversation_pg = await resolver.conversation(n.get("conversation"))

        # The note's content lands as jsonb. Tiptap stores either a string
        # (legacy) or a structured doc object; we json.dumps whatever we get.
        content = n.get("content")
        if content is None:
            content = {}

        new_pg_id = await pg.fetchval(
            _CONTACT_INSERT_SQL,
            None,  # let pg generate the uuid
            customer_pg,
            loan_account_pg,
            application_pg,
            conversation_pg,
            n.get("channel") or "internal",
            n.get("topic") or "internal_note",
            n.get("contactDirection"),
            _coerce_str(n.get("subject")) or "(no subject)",
            json.dumps(content),
            n.get("priority") or "normal",
            n.get("sentiment") or "neutral",
            created_by_pg,
            None,  # amends_note_id — only set on amendment rows below
            n.get("status") or "active",
            n.get("createdAt"),
            n.get("updatedAt"),
        )
        migrated += 1

        # Amendments → separate self-referencing rows.
        for amendment in n.get("amendments") or []:
            amend_created_by = await resolver.user(amendment.get("createdBy"))
            if not amend_created_by:
                amend_created_by = created_by_pg  # fall back to parent author
            amend_content = amendment.get("content") or amendment.get("body") or {}
            await pg.execute(
                _CONTACT_INSERT_SQL,
                None,
                customer_pg,
                loan_account_pg,
                application_pg,
                conversation_pg,
                n.get("channel") or "internal",
                n.get("topic") or "internal_note",
                n.get("contactDirection"),
                _coerce_str(amendment.get("subject") or n.get("subject")) or "(amendment)",
                json.dumps(amend_content),
                n.get("priority") or "normal",
                n.get("sentiment") or "neutral",
                amend_created_by,
                new_pg_id,  # amends_note_id = the parent note's new pg uuid
                "active",
                amendment.get("createdAt") or n.get("updatedAt"),
                amendment.get("createdAt") or n.get("updatedAt"),
            )
            migrated += 1

    print(f"[contact_notes] migrated={migrated} skipped={skipped}")
    return migrated, skipped


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


COLLECTION_RUNNERS = {
    "users": migrate_users,
    "media": migrate_media,
    "contact_notes": migrate_contact_notes,
}


async def main_async(mongo_uri: str, pg_uri: str, collection: str) -> int:
    mongo_client = motor.motor_asyncio.AsyncIOMotorClient(mongo_uri)
    db_name = mongo_uri.rsplit("/", 1)[-1].split("?")[0] or "billie-servicing"
    mongo_db = mongo_client[db_name]

    pg = await asyncpg.connect(dsn=pg_uri)
    try:
        targets = (
            list(COLLECTION_RUNNERS.keys())
            if collection == "all"
            else [collection]
        )
        # Migration order matters when 'all': users must land before
        # contact_notes (createdBy FK). Media is independent.
        targets.sort(key=lambda c: ("users", "media", "contact_notes").index(c))
        totals = {"migrated": 0, "skipped": 0}
        for c in targets:
            m, s = await COLLECTION_RUNNERS[c](mongo_db, pg)
            totals["migrated"] += m
            totals["skipped"] += s

        print()
        print(f"=== Done. migrated={totals['migrated']} skipped={totals['skipped']} ===")
    finally:
        await pg.close()
        mongo_client.close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mongo", required=True, help="Mongo connection URI")
    parser.add_argument("--pg", required=True, help="Postgres connection URI")
    parser.add_argument(
        "--collection",
        default="all",
        choices=sorted(VALID_COLLECTIONS),
        help="Which collection to migrate (default: all)",
    )
    args = parser.parse_args()
    return asyncio.run(main_async(args.mongo, args.pg, args.collection))


if __name__ == "__main__":
    sys.exit(main())
