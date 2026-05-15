"""One-off ETL: copy Payload `users` from Mongo to Postgres.

Migrates password salt+hash verbatim so existing credentials keep working —
Payload reads `salt`/`hash` columns identically on both adapters.

Skipped on conflict (email is the natural key). Re-runnable safely.

Usage (from project root, inside the billie-platform-crm container or with
host-mapped ports):

    python3 scripts/migrate-users-mongo-to-pg.py \\
        --mongo "mongodb://host.docker.internal:27017/billie-servicing" \\
        --pg    "postgresql://billie_crm:billie_dev_password@host.docker.internal:5432/billie_crm"
"""

from __future__ import annotations

import argparse
import asyncio
import sys

import asyncpg
import motor.motor_asyncio


async def migrate(mongo_uri: str, pg_uri: str) -> None:
    mongo_client = motor.motor_asyncio.AsyncIOMotorClient(mongo_uri)
    db_name = mongo_uri.rsplit("/", 1)[-1].split("?")[0] or "billie-servicing"
    mongo_db = mongo_client[db_name]

    pg = await asyncpg.connect(dsn=pg_uri)
    try:
        users = await mongo_db.users.find({}).to_list(length=None)
        print(f"Found {len(users)} users in Mongo")

        migrated = 0
        skipped = 0
        for u in users:
            email = u.get("email")
            if not email:
                print(f"  - skipping doc {u.get('_id')} (no email)")
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

        print(f"\nDone. Migrated={migrated} Skipped={skipped}")
    finally:
        await pg.close()
        mongo_client.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mongo", required=True, help="Mongo connection URI")
    parser.add_argument("--pg", required=True, help="Postgres connection URI")
    args = parser.parse_args()
    asyncio.run(migrate(args.mongo, args.pg))
    return 0


if __name__ == "__main__":
    sys.exit(main())
