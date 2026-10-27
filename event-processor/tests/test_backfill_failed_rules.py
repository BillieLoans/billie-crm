"""Back-fill of failed_rules from the S3 assessment files."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest

from billie_servicing.scripts import backfill_failed_rules as bf

if TYPE_CHECKING:
    from tests.conftest import MockPool

CONDUCT_URI = "s3://billie-files-prod/APP-1/CreditAssessment/account_conduct_1.json"
SVC_URI = "s3://billie-files-prod/APP-1/CreditAssessment/serviceability_1.json"
SVC_URI_2 = "s3://billie-files-prod/APP-2/CreditAssessment/serviceability_2.json"

FILES: dict[str, Any] = {
    CONDUCT_URI: {
        "application_number": "APP-1",
        "decision": "DECLINED",
        "account_conduct": {
            "rule_results": [
                {"rule_id": "ACCOUNT_CONDUCT_RULE_004", "result": "fail", "data_value": 3},
                {"rule_id": "ACCOUNT_CONDUCT_RULE_005", "result": "pass"},
                {"rule_id": "ACCOUNT_CONDUCT_RULE_006", "result": "fail", "data_value": 0.41},
                {"rule_id": "ACCOUNT_CONDUCT_RULE_026", "result": "fail", "info_only": True},
            ],
            "warnings": [],
        },
    },
    SVC_URI: {
        "application_number": "APP-1",
        "decision": "DECLINED",
        "rule_results": [{"rule_id": "SERVICEABILITY_RULE_001", "result": "fail"}],
    },
    SVC_URI_2: "not a json object",
}


async def fetch(uri: str) -> object:
    """A fetcher over the fixture files; unknown URIs raise like S3 would."""
    if uri not in FILES:
        raise FileNotFoundError(uri)
    return FILES[uri]


def _row(conversation_id: str, conduct: dict | None, svc: dict | None) -> dict[str, Any]:
    """A conversations row as asyncpg returns it (jsonb as text)."""
    return {
        "conversation_id": conversation_id,
        "assessments_account_conduct": json.dumps(conduct) if conduct else None,
        "assessments_serviceability": json.dumps(svc) if svc else None,
    }


@pytest.fixture
def candidates(mock_pool: MockPool) -> MockPool:
    """Three conversations: both components, one unreadable file, one with no location."""
    mock_pool.connection.set_fetch(
        [
            _row(
                "CONV-1",
                {"decision": "DECLINED", "s3Key": CONDUCT_URI, "file_location": CONDUCT_URI},
                {"decision": "DECLINED", "s3Key": SVC_URI},
            ),
            _row(
                "CONV-2",
                {"decision": "APPROVED", "s3Key": CONDUCT_URI},
                {
                    "decision": "DECLINED",
                    "s3Key": SVC_URI_2,
                },
            ),
            _row("CONV-3", {"decision": "DECLINED"}, None),
        ]
    )
    return mock_pool


def test_parse_s3_uri() -> None:
    assert bf.parse_s3_uri("s3://bucket/a/b.json") == ("bucket", "a/b.json")
    # The forms older events carried: virtual-hosted and path-style URLs.
    assert bf.parse_s3_uri("https://bucket.s3.ap-southeast-2.amazonaws.com/a/b%20c.json") == (
        "bucket",
        "a/b c.json",
    )
    assert bf.parse_s3_uri("https://s3.ap-southeast-2.amazonaws.com/bucket/a/b.json") == (
        "bucket",
        "a/b.json",
    )
    assert bf.parse_s3_uri("https://bucket.s3.amazonaws.com/a.json") == ("bucket", "a.json")
    for bad in ("bucket/a", "s3://bucket", "s3://bucket/../x", "https://example.com/a.json"):
        with pytest.raises(ValueError):
            bf.parse_s3_uri(bad)


def test_failed_rule_ids_match_the_live_rule() -> None:
    """Failed hard rules in order; info-only, passes, junk and duplicates left out."""
    results = FILES[CONDUCT_URI]["account_conduct"]["rule_results"] + [
        None,
        {"result": "fail"},
        {"rule_id": "ACCOUNT_CONDUCT_RULE_004", "result": "fail"},
    ]
    assert bf.failed_rule_ids(results) == ["ACCOUNT_CONDUCT_RULE_004", "ACCOUNT_CONDUCT_RULE_006"]
    assert bf.failed_rule_ids(None) == []


def test_rule_results_live_in_different_places_per_component() -> None:
    assert bf.rule_results_of("account_conduct", FILES[CONDUCT_URI]) is not None
    assert bf.rule_results_of("serviceability", FILES[SVC_URI]) is not None
    # An older layout is found wherever the list sits, one level down at most.
    assert bf.rule_results_of("account_conduct", FILES[SVC_URI]) == FILES[SVC_URI]["rule_results"]
    assert bf.rule_results_of("serviceability", {"assessment": {"rule_results": []}}) == []
    assert bf.rule_results_of("serviceability", {"rule_results": "not a list"}) is None
    assert bf.rule_results_of("serviceability", "junk") is None


async def test_dry_run_reads_files_and_writes_nothing(candidates: MockPool) -> None:
    summary = await bf.run(candidates, fetch, apply=False, limit=100)
    assert summary.conversations == 3
    # CONV-1 both results, CONV-2 serviceability only (conduct approved), CONV-3 conduct.
    assert summary.results == 4
    assert summary.fetched == 2
    assert summary.unreadable == 1
    assert summary.no_location == 1
    assert summary.written == 0
    assert summary.rules == {
        "ACCOUNT_CONDUCT_RULE_004": 1,
        "ACCOUNT_CONDUCT_RULE_006": 1,
        "SERVICEABILITY_RULE_001": 1,
    }
    assert candidates.jsonb_merges("conversations", "assessments_account_conduct") == []
    # The report says why a file could not be read, with the location.
    assert summary.errors == {"ValueError": 1}
    assert summary.samples == [f"{SVC_URI_2}: ValueError: no rule_results in the assessment file"]
    text = bf.report(summary, applied=False)
    assert "dry run" in text
    assert "ACCOUNT_CONDUCT_RULE_006 1" in text
    assert "why unreadable:          ValueError 1" in text
    assert f"e.g. {SVC_URI_2}: ValueError" in text


async def test_apply_merges_the_ids_only(candidates: MockPool) -> None:
    summary = await bf.run(candidates, fetch, apply=True, limit=100)
    assert summary.written == 2
    conduct = candidates.jsonb_merges("conversations", "assessments_account_conduct")
    svc = candidates.jsonb_merges("conversations", "assessments_serviceability")
    assert conduct == [{"failed_rules": ["ACCOUNT_CONDUCT_RULE_004", "ACCOUNT_CONDUCT_RULE_006"]}]
    assert svc == [{"failed_rules": ["SERVICEABILITY_RULE_001"]}]
    # Nothing from the file but the ids: no data values, no descriptions.
    merged = json.dumps(conduct + svc)
    assert "data_value" not in merged and "0.41" not in merged
    # Each write names its conversation and bumps the projection version.
    updates = [c for c in candidates.calls_against("conversations") if c.op == "UPDATE"]
    assert len(updates) == 2
    assert all(c.args[-1] == "CONV-1" for c in updates)
    assert all("version = COALESCE(version, 1) + 1" in c.sql for c in updates)


async def test_results_that_already_have_rules_are_skipped(mock_pool: MockPool) -> None:
    mock_pool.connection.set_fetch(
        [_row("CONV-9", {"decision": "DECLINED", "s3Key": CONDUCT_URI, "failed_rules": []}, None)]
    )
    summary = await bf.run(mock_pool, fetch, apply=True, limit=10)
    assert summary.results == 0
    assert summary.written == 0
