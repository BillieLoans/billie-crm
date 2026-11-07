# Google Ads offline click conversions (BTB-546)

Tells Google Ads which ad clicks became **approved** or **funded** borrowers,
so bidding can optimise for borrowers rather than submissions. Design:
Confluence "Google Ads Offline Conversions — Findings & Solution Hypothesis".

## What is sent

Per application that came from an ad click (`conversations.attribution` has a
gclid, gbraid or wbraid, BTB-404):

| Conversion | When                                                          | Time sent                       |
| ---------- | ------------------------------------------------------------- | ------------------------------- |
| `approved` | its first `APPROVED` decision (`reporting.decision_event`)    | that decision's `decided_at`    |
| `funded`   | its loan is disbursed (`loan_accounts.loan_terms_disbursed_date`) | the first disbursed date    |

Each upload carries only the click id, the conversion action, the time and
the application number as `order_id`. No amounts, decline reasons or personal
details. Declines are never sent.

An approval that is later revised, whose application an operator stops
(`kill_record`, any reason but `customer_request`), or whose loan is cancelled
as a `fraud_hold`, is not sent if it has not
gone yet, and is **retracted** (conversion adjustment, RETRACTION by order id)
if it has. Approved again before the retraction goes out: the retraction is
cancelled.

## How it works

`POST /api/reports/jobs/google-ads-conversions` runs hourly from
`.github/workflows/scheduled-reports.yml` (bearer `REPORTING_JOB_TOKEN`). Each
run (`src/server/google-ads/conversions.ts`):

1. **Fill** the outbox (`google-ads-conversions`) from the projections. Unique
   on (application_number, conversion_name, action), so a repeat queues
   nothing. The event processor is not involved: projections are settled and
   idempotent, so replays and the two unordered prod consumers don't matter,
   and anything still inside the 90-day click window back-fills itself.
2. **Reconcile**: per approval, compare whether Google should count it with
   what it was told. It should while the latest decision is APPROVED, no
   operator has stopped the conversation and the loan was not cancelled as a
   `fraud_hold`. An unsent upload is cancelled or restored; a sent one gets a
   retraction queued, re-armed or called off. Also expires rows past the
   click window, releases claims older than 30 minutes, and in `live` cancels
   rows from mock decisions (the claim also skips them).
3. **Claim** due rows with `FOR UPDATE SKIP LOCKED`, so concurrent runs take
   different rows. A row is due 6 hours after the click (Google rejects
   clicks it has not processed).
4. **Send** one `UploadClickConversions` and one `UploadConversionAdjustments`
   call, partial failure on.
5. **Record** each row, keeping Google's error code (never its message):
   - `sent`. Google's "already exists" answers count as sent, so a re-send
     after a crash is harmless.
   - `failed`, final, only for an error about the click itself
     (`GCLID_NOT_FOUND`, `UNPARSEABLE_GCLID`, conversion before the click).
   - `expired` when Google says the click or conversion is too old.
   - Everything else goes back to `pending`: "too recent" answers after 6
     hours, a whole-request failure (auth, quota, network, or an error naming
     no row) next hour, and an unknown code daily. These retry until the click
     window closes, so a weekend of revoked credentials loses nothing. A
     whole-request failure or an unknown code turns the workflow red.

**Cost stays flat as history grows.** Google takes nothing more than 90 days
after the click (`CLICK_WINDOW_DAYS`, the one place the limit lives). The
fill reads only that window of decisions and loans (indexed on `decided_on`
and `disbursed_date`), and every reconcile step touches only rows whose
`expires_at` is still ahead (indexed on `status, expires_at`). Once its window
closes a row is final: a revision after that is not retracted, and a pending
retraction expires. Rows stay in the table as a record (a few thousand a
year); they cost lookups by unique key only.

The conversation's Acquisition panel shows "Sent to Google Ads" for every ad
click: nothing sent, waiting, sent (with time), not accepted (code), or why
it was not sent.

## Settings

`GOOGLE_ADS_CONVERSIONS_MODE`: `off` (default), `validate_only`, `live`.
In `validate_only` every row is checked once by Google with `validateOnly`
and stays pending; mock decisions are included so demo can be tested end to
end. `live` sends, and never sends a mock decision.

Fly secrets (`infra/fly/env`), required unless the mode is `off`:

| Variable                                  | Value                                                          |
| ----------------------------------------- | -------------------------------------------------------------- |
| `GOOGLE_ADS_API_VERSION`                  | e.g. `v22`. Google retires versions about yearly; keep current |
| `GOOGLE_ADS_DEVELOPER_TOKEN`              | manager account → API Center (Basic access needs approval)     |
| `GOOGLE_ADS_CUSTOMER_ID`                  | the Ads account, dashes optional                               |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID`            | the manager account, if access is through it (optional)        |
| `GOOGLE_ADS_OAUTH_CLIENT_ID` / `_SECRET`  | OAuth client                                                   |
| `GOOGLE_ADS_OAUTH_REFRESH_TOKEN`          | refresh token for a user with access to the Ads account        |
| `GOOGLE_ADS_CONVERSION_ACTION_APPROVED`   | id (or resource name) of the "Import from clicks" action       |
| `GOOGLE_ADS_CONVERSION_ACTION_FUNDED`     | same, for funded                                               |

The route answers 503 naming any missing variable (never values).

## Roll-out

1. Google Ads side: create the two "Import from clicks" conversion actions,
   decide which is primary for bidding, get the developer token and OAuth
   credentials. Compliance sign-off on the click-id signal and collection
   notice.
2. Deploy with the mode `off` (nothing happens; the hourly job answers
   `skipped`).
3. Demo: set the secrets and `validate_only`. Approve a TEST application
   started from a link with a test click id, wait 6 hours, run the job by hand
   (workflow → `google-ads-conversions`), and read the row in
   Admin → Marketing → Google Ads conversions: `validatedAt` set and no error
   code means Google accepted it.
4. Prod: `validate_only` for a few days, then `live`. Rows checked in
   validate-only are sent on the first live run.

To stop sending, set the mode to `off`. Rows wait in the outbox and go out
when it is turned back on, unless their click window has closed.

## Fallback

If the API route stalls on the developer token: a supervisor-only weekly CSV
for manual upload (BTB-436 item 5) can export the outbox's `pending` rows and
mark them `sent`, keeping the same exactly-once tracking.
