# Google Ads offline click conversions (BTB-546)

Tells Google Ads which ad clicks became **approved** or **funded** borrowers,
so bidding can optimise for borrowers rather than submissions. Design:
Confluence "Google Ads Offline Conversions — Findings & Solution Hypothesis".

Conversions go through Google's **Data Manager API** (`events:ingest`). The
Google Ads API's `UploadClickConversions` is closed to new integrations since
15 June 2026 (`CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE`). The Data Manager
API needs no developer token, but it **cannot retract** a conversion.

## What is sent

Per application that came from an ad click (`conversations.attribution` has a
gclid, gbraid or wbraid, BTB-404):

| Conversion | When it is sent                                                         | Time sent                    |
| ---------- | ----------------------------------------------------------------------- | ---------------------------- |
| `approved` | 48 hours after its first `APPROVED` decision, if the approval still stands | that decision's `decided_at` |
| `funded`   | once its loan is disbursed (`loan_accounts.loan_terms_disbursed_date`)   | the first disbursed date     |

Each conversion carries only the click id, the conversion action, the time and
the application number as transaction id. No amounts, decline reasons or
personal details. Declines are never sent.

**The 48-hour hold.** Because a sent conversion cannot be retracted, an
approval waits 48 hours (`APPROVAL_HOLD_MS`). If in that time the decision is
revised, an operator stops the application (`kill_record`, any reason but
`customer_request`) or the loan is cancelled as a `fraud_hold`, it is cancelled
and never sent; approved again, it is restored. After it has been sent, a
later revision cannot be undone. A funded loan is final, so `funded` goes as
soon as the click has settled; it is the better candidate for the primary
bidding conversion.

## How it works

Each prod machine runs an **in-app hourly scheduler**
(`src/server/google-ads/scheduler.ts`, started by `src/instrumentation.ts`).
It calls `POST /api/reports/jobs/google-ads-conversions` on its own machine
(bearer `REPORTING_JOB_TOKEN`). The scheduler only starts in production with
the mode `validate_only` or `live`; the first run is about 5 minutes after
boot, then hourly with a few minutes' jitter. Each run
(`src/server/google-ads/conversions.ts`):

1. **Fill** the outbox (`google-ads-conversions`) from the projections. Unique
   on (application_number, conversion_name, action), so a repeat queues
   nothing. The event processor is not involved: projections are settled and
   idempotent, so replays and the two unordered prod consumers don't matter,
   and anything still inside the 90-day click window back-fills itself.
2. **Reconcile**: cancel an unsent approval that no longer stands, restore one
   that does again, expire rows past the click window, release claims older
   than 30 minutes, and in `live` cancel rows from mock decisions (the claim
   also skips them).
3. **Claim** due rows with `FOR UPDATE SKIP LOCKED`, so the two machines take
   different rows. A row is due 6 hours after the click (Google needs time to
   process it) and, for an approval, after the hold.
4. **Send** one conversion per request: the Data Manager API fails a whole
   request on one bad event.
5. **Record** each row, keeping Google's error code (never its message):
   - `sent`: accepted for processing. Re-sending the same transaction id is an
     adjustment, not a duplicate, so a re-send after a crash is harmless.
   - `failed`, final, when Google rejects the event's own fields (a malformed
     click id or time).
   - Anything about the request as a whole (auth, quota, configuration, an
     outage) puts the row and the rest of the batch back for the next hour,
     until the click window closes, so a weekend of revoked credentials loses
     nothing. The route answers 502 while that happens; the scheduler logs it
     (`[google-ads] scheduled run`).

Processing on Google's side is asynchronous: a click Google cannot match shows
in Google Ads' diagnostics, not here.

**Cost stays flat as history grows.** Google takes nothing more than 90 days
after the click (`CLICK_WINDOW_DAYS`, the one place the limit lives). The
fill reads only that window of decisions and loans (indexed on `decided_on`
and `disbursed_date`), and every reconcile step touches only rows whose
`expires_at` is still ahead (indexed on `status, expires_at`). Rows stay in
the table as a record (a few thousand a year); they cost lookups by unique key
only.

The conversation's Acquisition panel shows "Sent to Google Ads" for every ad
click: nothing sent, waiting (with when), sent (with time), not accepted
(code), or why it was not sent.

## Settings

`GOOGLE_ADS_CONVERSIONS_MODE`: `off` (default), `validate_only`, `live`.
In `validate_only` every row is checked once by Google with `validateOnly`
and stays pending; mock decisions are included so demo can be tested end to
end. `live` sends, and never sends a mock decision. Changing the mode (a Fly
secret) restarts the machines, which starts or stops the scheduler.

Fly secrets (`infra/fly/env`), required unless the mode is `off`:

| Variable                                 | Value                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `GOOGLE_ADS_CUSTOMER_ID`                 | the Ads account, dashes optional                                       |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID`           | the manager account, if the OAuth user reaches the Ads account through it (optional) |
| `GOOGLE_ADS_OAUTH_CLIENT_ID` / `_SECRET` | OAuth client in a Cloud project with the **Data Manager API** enabled   |
| `GOOGLE_ADS_OAUTH_REFRESH_TOKEN`         | refresh token with scope `https://www.googleapis.com/auth/datamanager` |
| `GOOGLE_ADS_CONVERSION_ACTION_APPROVED`  | "Conversion type ID" of the `approved` "Import from clicks" action     |
| `GOOGLE_ADS_CONVERSION_ACTION_FUNDED`    | same, for `funded`                                                     |

`GOOGLE_ADS_DEVELOPER_TOKEN` and `GOOGLE_ADS_API_VERSION` are no longer read.
The route answers 503 naming any missing variable (never values).

## Running it by hand

On a prod machine (the image has no `curl`):

```
fly ssh console -a billie-crm-prod -C "node -e \"fetch('http://127.0.0.1:3000/api/reports/jobs/google-ads-conversions',{method:'POST',headers:{'x-origin-secret':process.env.CF_SECRET,authorization:'Bearer '+process.env.REPORTING_JOB_TOKEN}}).then(async r=>console.log(r.status,await r.text()))\""
```

## Roll-out

1. Google Ads side: the two "Import from clicks" conversion actions, the Data
   Manager API enabled, and a refresh token with the `datamanager` scope.
   Compliance sign-off on the click-id signal and collection notice.
2. Deploy with the mode `validate_only`. Read the scheduler's log lines, or
   run it by hand, and check Admin → Marketing → Google Ads conversions:
   `validatedAt` set and no error code means Google accepted it.
3. Switch to `live`. Rows checked in validate-only are sent on the next run.

To stop sending, set the mode to `off`. Rows wait in the outbox and go out
when it is turned back on, unless their click window has closed.
