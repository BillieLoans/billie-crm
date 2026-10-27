"""Back-fill ``failed_rules`` onto credit assessment results from their S3 files.

billieChat's ``credit_assessment_accountConduct_result`` and
``credit_assessment_serviceability_result`` events carry ``failed_rules`` (the
ids of the rules that failed) from late October 2026. Earlier events carried
only the decision and the S3 location of the full assessment, which the CRM
stores on the conversation (``assessments_account_conduct.s3Key`` and
``assessments_serviceability.s3Key``). The rule results are in those files.

This script reads each DECLINED assessment result that has no ``failed_rules``
key, fetches its file from S3, and merges the failing rule ids into the stored
result, so the reporting views (``application.account_conduct_failed_rules``,
``serviceability_failed_rules``) and the decline reports cover history.

  # from event-processor/, with PYTHONPATH=src and a read-only AWS profile
  python3 -m billie_servicing.scripts.backfill_failed_rules --profile billie-prod-ro
  python3 -m billie_servicing.scripts.backfill_failed_rules --profile billie-prod-ro --apply

Ids only: nothing else from the file is stored. Safe to run more than once:
a result that already has ``failed_rules`` is not a candidate, and the write
merges one key with the same jsonb merge the live handler uses. A file that
cannot be read or parsed is counted and skipped, never written as empty.
Writes go through the event processor's own helper, so this stays the single
writer of the projection.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from collections import Counter
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from urllib.parse import unquote

from ..db import merge_jsonb

if TYPE_CHECKING:
    import asyncpg

Fetcher = Callable[[str], Awaitable[object]]
"""Reads the JSON document at an ``s3://bucket/key`` URI; raises on failure."""

COMPONENTS: dict[str, str] = {
    "assessments_account_conduct": "account_conduct",
    "assessments_serviceability": "serviceability",
}

CANDIDATES_SQL = """
SELECT conversation_id, assessments_account_conduct, assessments_serviceability
  FROM conversations
 WHERE (assessments_account_conduct->>'decision' = 'DECLINED'
        AND NOT (assessments_account_conduct ? 'failed_rules'))
    OR (assessments_serviceability->>'decision' = 'DECLINED'
        AND NOT (assessments_serviceability ? 'failed_rules'))
 ORDER BY updated_at DESC
 LIMIT $1
"""


@dataclass
class Summary:
    """What a run found and wrote."""

    conversations: int = 0
    results: int = 0
    fetched: int = 0
    unreadable: int = 0
    no_location: int = 0
    written: int = 0
    rules: Counter = field(default_factory=Counter)
    errors: Counter = field(default_factory=Counter)
    """Why files could not be read, by exception class."""
    samples: list[str] = field(default_factory=list)
    """The first few failures in full: location, class and message."""

    def failed(self, uri: str, exc: BaseException) -> None:
        """Count an unreadable file and keep the first five for the report."""
        self.unreadable += 1
        self.errors[type(exc).__name__] += 1
        if len(self.samples) < 5:
            self.samples.append(f"{uri}: {type(exc).__name__}: {exc}")


_S3_HOST = re.compile(r"^(?:(?P<bucket>[^.]+)\.)?s3[.-](?:[a-z0-9-]+\.)?amazonaws\.com$")


def parse_s3_uri(uri: str) -> tuple[str, str]:
    """Split an S3 location into bucket and key.

    Accepts ``s3://bucket/key`` (what billieChat records today), the
    virtual-hosted ``https://bucket.s3.region.amazonaws.com/key`` and the
    path-style ``https://s3.region.amazonaws.com/bucket/key`` forms.
    """
    uri = uri.strip()
    if uri.startswith("s3://"):
        bucket, _, key = uri[5:].partition("/")
    elif uri.startswith("https://"):
        host, _, path = uri[8:].partition("/")
        match = _S3_HOST.match(host)
        if not match:
            raise ValueError(f"not an S3 URL: {uri}")
        key = unquote(path)
        bucket = match.group("bucket") or ""
        if not bucket:
            bucket, _, key = key.partition("/")
    else:
        raise ValueError(f"not an S3 location: {uri}")
    if not bucket or not key or ".." in key:
        raise ValueError(f"malformed S3 location: {uri}")
    return bucket, key


def failed_rule_ids(rule_results: object) -> list[str]:
    """Ids of the rules that failed, in order, info-only rules left out.

    The same rule billieChat applies when it builds ``failed_rules`` live, so
    a back-filled result reads exactly as a live one would.
    """
    ids: list[str] = []
    for result in rule_results if isinstance(rule_results, list) else []:
        if not isinstance(result, dict) or result.get("info_only"):
            continue
        if result.get("result") != "fail":
            continue
        rule_id = result.get("rule_id")
        if isinstance(rule_id, str) and rule_id and rule_id not in ids:
            ids.append(rule_id)
    return ids


def rule_results_of(component: str, document: object) -> object | None:
    """Where an assessment file keeps its rule results.

    Today the account conduct file nests them under ``account_conduct`` and
    the serviceability file keeps them at the top; older files may differ, so
    the top level is tried first, then every object one level down.
    """
    if not isinstance(document, dict):
        return None
    preferred = document.get("account_conduct") if component == "account_conduct" else document
    if isinstance(preferred, dict) and isinstance(preferred.get("rule_results"), list):
        return preferred["rule_results"]
    if isinstance(document.get("rule_results"), list):
        return document["rule_results"]
    for value in document.values():
        if isinstance(value, dict) and isinstance(value.get("rule_results"), list):
            return value["rule_results"]
    return None


def _as_dict(value: object) -> dict[str, Any] | None:
    """A jsonb column as asyncpg hands it over: a dict, or JSON text."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except ValueError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def location_of(result: dict[str, Any]) -> str | None:
    """The S3 URI of a stored assessment result."""
    for key in ("s3Key", "file_location"):
        value = result.get(key)
        if isinstance(value, str) and value:
            return value
    return None


class S3Fetcher:
    """Reads JSON documents from S3 through boto3, with an optional profile."""

    def __init__(self, profile: str | None) -> None:
        import boto3  # noqa: PLC0415 — only needed when fetching for real

        session = boto3.Session(profile_name=profile) if profile else boto3.Session()
        self._client = session.client("s3")

    async def __call__(self, uri: str) -> object:
        bucket, key = parse_s3_uri(uri)
        response = await asyncio.to_thread(self._client.get_object, Bucket=bucket, Key=key)
        return json.loads(response["Body"].read().decode("utf-8"))


async def run(
    pool: asyncpg.Pool,
    fetch: Fetcher,
    *,
    apply: bool,
    limit: int,
) -> Summary:
    """Find the results without ``failed_rules``, read their files and, with
    ``apply``, merge the ids in."""
    summary = Summary()
    rows = await pool.fetch(CANDIDATES_SQL, limit)
    for row in rows:
        summary.conversations += 1
        conversation_id = row["conversation_id"]
        for column, component in COMPONENTS.items():
            result = _as_dict(row[column])
            if not result or result.get("decision") != "DECLINED" or "failed_rules" in result:
                continue
            summary.results += 1
            uri = location_of(result)
            if uri is None:
                summary.no_location += 1
                continue
            try:
                document = await fetch(uri)
                rule_results = rule_results_of(component, document)
                if rule_results is None:
                    raise ValueError("no rule_results in the assessment file")
            except Exception as exc:  # noqa: BLE001 — one bad file must not stop the run
                summary.failed(uri, exc)
                continue
            summary.fetched += 1
            ids = failed_rule_ids(rule_results)
            for rule_id in ids:
                summary.rules[rule_id] += 1
            if not apply:
                continue
            await merge_jsonb(
                pool,
                "conversations",
                column=column,
                key_column="conversation_id",
                key_value=conversation_id,
                patch={"failed_rules": ids},
                bump_version=True,
            )
            summary.written += 1
    return summary


def report(summary: Summary, *, applied: bool) -> str:
    """Human-readable summary of a run."""
    top = ", ".join(f"{k} {v}" for k, v in summary.rules.most_common(10)) or "none"
    lines = [
        f"conversations checked:   {summary.conversations}",
        f"results without rules:   {summary.results}",
        f"files read:              {summary.fetched}",
        f"files unreadable:        {summary.unreadable}",
        f"results with no location:{summary.no_location:>2}",
        f"rules found (top 10):    {top}",
    ]
    if summary.errors:
        why = ", ".join(f"{k} {v}" for k, v in summary.errors.most_common())
        lines.append(f"why unreadable:          {why}")
        lines.extend(f"  e.g. {sample}" for sample in summary.samples)
    if applied:
        lines.append(f"results written:         {summary.written}")
    else:
        lines.append("dry run: nothing written; pass --apply to write")
    return "\n".join(lines)


async def _main(args: argparse.Namespace) -> Summary:
    import asyncpg  # noqa: PLC0415 — the processor's driver, imported late like the other scripts

    pool = await asyncpg.create_pool(args.database_uri, min_size=1, max_size=2)
    try:
        return await run(pool, S3Fetcher(args.profile), apply=args.apply, limit=args.limit)
    finally:
        await pool.close()


def main() -> None:
    """Command-line entry point."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true", help="write failed_rules to conversations")
    parser.add_argument(
        "--database-uri",
        default=os.environ.get("DATABASE_URI"),
        help="defaults to $DATABASE_URI",
    )
    parser.add_argument("--profile", default=None, help="AWS profile that can read the bucket")
    parser.add_argument(
        "--limit", type=int, default=5000, help="most recent conversations to check (default 5000)"
    )
    args = parser.parse_args()
    if not args.database_uri:
        parser.error("needs --database-uri or $DATABASE_URI")
    summary = asyncio.run(_main(args))
    print(report(summary, applied=args.apply))


if __name__ == "__main__":
    main()
