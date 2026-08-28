#!/usr/bin/env bash
# Fetch a Billie CRM in-app issue report (record + screenshot) via the CRM's
# own admin REST API. Works for prod and demo. See SKILL.md in this directory.
#
# Usage:
#   fetch-issue.sh <issue-url>                    # env + id derived from URL
#   fetch-issue.sh <issue-uuid> <prod|demo>
#   fetch-issue.sh list <prod|demo>               # latest 20 reports
#   ...append an output dir as the last arg to control where files land
#
# Auth (one-time setup — see SKILL.md):
#   - Payload admin API key in the macOS Keychain:
#       service "billie-crm-issue-api-key-<env>", account "billie-crm"
#   - Prod only: a Cloudflare Access session via `cloudflared access login`
#
# The API key and CF token are written to a chmod-600 temp header file and
# passed to curl with -H @file — secret values never appear in output.
set -euo pipefail

die() {
  echo "ERROR: $1" >&2
  exit "${2:-1}"
}

PROD_BASE="https://crm.billie.loans"
DEMO_BASE="https://demo.crm.billie.loans"

# --- Parse arguments ---------------------------------------------------------
[ $# -ge 1 ] || die "usage: fetch-issue.sh <issue-url | issue-uuid | list> [prod|demo] [outdir]"

MODE="fetch"
ISSUE_ID=""
ENV_NAME=""
OUTDIR=""

case "$1" in
  list)
    MODE="list"
    ENV_NAME="${2:-}"
    OUTDIR="${3:-}"
    ;;
  api)
    # Ad-hoc authenticated GET against any CRM API path, for chasing the data
    # behind an issue (e.g. api prod /api/customer/XXXX). Read-only.
    MODE="api"
    ENV_NAME="${2:-}"
    API_PATH="${3:-}"
    [ -n "$API_PATH" ] || die "usage: fetch-issue.sh api <prod|demo> </api/...>"
    OUTDIR="${4:-}"
    ;;
  http*://*)
    case "$1" in
      *demo.crm.billie.loans*) ENV_NAME="demo" ;;
      *crm.billie.loans*) ENV_NAME="prod" ;;
      *) die "unrecognised host in URL: $1" ;;
    esac
    ISSUE_ID=$(echo "$1" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
    [ -n "$ISSUE_ID" ] || die "no issue UUID found in URL: $1"
    OUTDIR="${2:-}"
    ;;
  *)
    ISSUE_ID="$1"
    ENV_NAME="${2:-}"
    OUTDIR="${3:-}"
    ;;
esac

case "$ENV_NAME" in
  prod) BASE="$PROD_BASE" ;;
  demo) BASE="$DEMO_BASE" ;;
  *) die "environment must be 'prod' or 'demo' (got '${ENV_NAME:-<none>}'). Pass it as the second arg, or provide a full issue URL." ;;
esac

if [ -z "$OUTDIR" ]; then
  OUTDIR=$(mktemp -d "${TMPDIR:-/tmp}/billie-crm-issue.XXXXXX")
fi
mkdir -p "$OUTDIR"

# --- Build auth headers ------------------------------------------------------
API_KEY=$(security find-generic-password -a billie-crm -s "billie-crm-issue-api-key-$ENV_NAME" -w 2>/dev/null) || {
  cat >&2 <<EOF
No API key in Keychain for '$ENV_NAME'.
One-time setup (run in your own terminal, NOT via Claude, so the key stays out
of the transcript):
  1. In the CRM ($BASE/admin), open your user under Users, tick
     'Enable API Key', save, and copy the generated key.
  2. security add-generic-password -a billie-crm -s billie-crm-issue-api-key-$ENV_NAME -w
     (it prompts for the secret; paste the key)
EOF
  exit 2
}

HDR=$(mktemp "${TMPDIR:-/tmp}/billie-crm-hdr.XXXXXX")
trap 'rm -f "$HDR"' EXIT
chmod 600 "$HDR"
printf 'Authorization: users API-Key %s\n' "$API_KEY" > "$HDR"

if [ "$ENV_NAME" = "prod" ]; then
  CF_TOKEN=$(cloudflared access token -app="$PROD_BASE" 2>/dev/null) || {
    cat >&2 <<EOF
No valid Cloudflare Access session for $PROD_BASE.
Run:  cloudflared access login $PROD_BASE
(opens a browser for the usual Access SSO, then re-run this script)
EOF
    exit 3
  }
  printf 'cf-access-token: %s\n' "$CF_TOKEN" >> "$HDR"
fi

# --- Helpers -----------------------------------------------------------------
api_get() {
  # $1 = path, $2 = output file. Prints HTTP status; body lands in $2.
  curl -sS -H @"$HDR" -o "$2" -w '%{http_code}' "$BASE$1"
}

explain_http() {
  case "$1" in
    401|403) echo "HTTP $1 — API key rejected, or its user is not an admin (issues are admin-read-only). Regenerate the key and update the Keychain item." >&2 ;;
    404) echo "HTTP $1 — no issue with that id in $ENV_NAME. Wrong environment?" >&2 ;;
    302) echo "HTTP $1 — bounced to Cloudflare Access login; run: cloudflared access login $PROD_BASE" >&2 ;;
    *) echo "HTTP $1 — unexpected response:" >&2 ;;
  esac
}

# --- Ad-hoc API mode ---------------------------------------------------------
if [ "$MODE" = "api" ]; then
  BODY_FILE="$OUTDIR/api-response.json"
  CODE=$(api_get "$API_PATH" "$BODY_FILE")
  if [ "$CODE" != "200" ]; then
    explain_http "$CODE"
    head -c 400 "$BODY_FILE" >&2 || true
    exit 4
  fi
  python3 -m json.tool "$BODY_FILE" 2>/dev/null || cat "$BODY_FILE"
  exit 0
fi

# --- List mode ---------------------------------------------------------------
if [ "$MODE" = "list" ]; then
  LIST_FILE="$OUTDIR/issues-list-$ENV_NAME.json"
  CODE=$(api_get "/api/issues?limit=20&sort=-createdAt&depth=0" "$LIST_FILE")
  if [ "$CODE" != "200" ]; then
    explain_http "$CODE"
    head -c 400 "$LIST_FILE" >&2 || true
    exit 4
  fi
  python3 - "$LIST_FILE" <<'PY'
import json, sys
docs = json.load(open(sys.argv[1])).get("docs", [])
if not docs:
    print("No issue reports found.")
for d in docs:
    shot = "screenshot" if d.get("screenshotUri") else "no-screenshot"
    trigger = d.get("triggerReason") or "manual"
    print(f'{d["createdAt"]}  {d["status"]:<8}  {d["id"]}  [{trigger}, {shot}]  {d.get("title","")}')
PY
  echo ""
  echo "Full JSON: $LIST_FILE"
  exit 0
fi

# --- Fetch one issue ---------------------------------------------------------
JSON_FILE="$OUTDIR/issue-$ISSUE_ID.json"
# depth=0 on purpose: depth=1 resolves reportedBy/resolvedBy into full user
# docs, and Payload returns the user's live apiKey to admin readers. The
# reporter's identity is already in diagnostics.context.reporter.
CODE=$(api_get "/api/issues/$ISSUE_ID?depth=0" "$JSON_FILE")
if [ "$CODE" != "200" ]; then
  explain_http "$CODE"
  head -c 400 "$JSON_FILE" >&2 || true
  exit 4
fi

python3 -m json.tool "$JSON_FILE"

SCREENSHOT_URI=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("screenshotUri") or "")' "$JSON_FILE")
if [ -n "$SCREENSHOT_URI" ]; then
  case "$SCREENSHOT_URI" in
    *.jpg|*.jpeg) EXT="jpg" ;;
    *) EXT="png" ;;
  esac
  SHOT_FILE="$OUTDIR/issue-$ISSUE_ID-screenshot.$EXT"
  SHOT_CODE=$(api_get "/api/issues/$ISSUE_ID/screenshot" "$SHOT_FILE")
  if [ "$SHOT_CODE" = "200" ]; then
    echo ""
    echo "Screenshot saved: $SHOT_FILE"
  else
    echo ""
    echo "Screenshot listed on the issue ($SCREENSHOT_URI) but fetch returned HTTP $SHOT_CODE — object may be missing from S3." >&2
    rm -f "$SHOT_FILE"
  fi
else
  echo ""
  echo "No screenshot attached to this issue."
fi

echo "Issue JSON saved: $JSON_FILE"
