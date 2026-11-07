/**
 * Google Ads offline conversion settings (BTB-546), from the environment.
 *
 * `GOOGLE_ADS_CONVERSIONS_MODE` is the switch:
 *   - `off` (the default, and anything unrecognised): nothing is queued or sent.
 *   - `validate_only`: the outbox fills and every row goes to Google with
 *     validateOnly set. Google checks it and records nothing; rows stay
 *     pending so they are sent once the mode is `live`.
 *   - `live`: rows are sent. Rows from mock credit decisions are cancelled.
 *
 * Conversions go through the Data Manager API, which needs no developer token.
 * Credentials are Fly secrets (infra/fly/env), never in the repo:
 *   GOOGLE_ADS_CUSTOMER_ID            the Ads account, digits (dashes are dropped)
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID      the manager account, when the OAuth user
 *                                     reaches the Ads account through it (optional)
 *   GOOGLE_ADS_OAUTH_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN
 *                                     refresh token with scope
 *                                     https://www.googleapis.com/auth/datamanager
 *   GOOGLE_ADS_CONVERSION_ACTION_APPROVED / _FUNDED   conversion action ids
 *     (the "Conversion type ID"; a resource name customers/x/conversionActions/<id>
 *     is accepted too)
 */

export type GoogleAdsMode = 'off' | 'validate_only' | 'live'

export interface GoogleAdsConfig {
  mode: Exclude<GoogleAdsMode, 'off'>
  customerId: string
  loginCustomerId: string | null
  oauthClientId: string
  oauthClientSecret: string
  oauthRefreshToken: string
  /** Numeric conversion action ids. */
  conversionActions: { approved: string; funded: string }
}

export function googleAdsMode(env: NodeJS.ProcessEnv = process.env): GoogleAdsMode {
  const mode = env.GOOGLE_ADS_CONVERSIONS_MODE?.trim().toLowerCase()
  return mode === 'validate_only' || mode === 'live' ? mode : 'off'
}

const digits = (value: string | undefined): string | null => {
  const d = (value ?? '').replace(/-/g, '').trim()
  return /^\d+$/.test(d) ? d : null
}

function conversionActionId(value: string | undefined): string | null {
  const v = (value ?? '').trim()
  if (/^\d+$/.test(v)) return v
  return /^customers\/\d+\/conversionActions\/(\d+)$/.exec(v)?.[1] ?? null
}

export type GoogleAdsConfigResult =
  | { ok: true; config: GoogleAdsConfig }
  | { ok: false; mode: 'off' }
  | { ok: false; mode: Exclude<GoogleAdsMode, 'off'>; missing: string[] }

/**
 * Read and check the settings. When sending is on but something is missing
 * or malformed, names the variables (never their values).
 */
export function readGoogleAdsConfig(env: NodeJS.ProcessEnv = process.env): GoogleAdsConfigResult {
  const mode = googleAdsMode(env)
  if (mode === 'off') return { ok: false, mode }

  const missing: string[] = []
  const need = (name: string): string => {
    const value = env[name]?.trim()
    if (!value) missing.push(name)
    return value ?? ''
  }
  const customerId = digits(env.GOOGLE_ADS_CUSTOMER_ID)
  if (!customerId) missing.push('GOOGLE_ADS_CUSTOMER_ID')
  const loginRaw = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim()
  const loginCustomerId = loginRaw ? digits(loginRaw) : null
  if (loginRaw && !loginCustomerId) missing.push('GOOGLE_ADS_LOGIN_CUSTOMER_ID')
  const oauthClientId = need('GOOGLE_ADS_OAUTH_CLIENT_ID')
  const oauthClientSecret = need('GOOGLE_ADS_OAUTH_CLIENT_SECRET')
  const oauthRefreshToken = need('GOOGLE_ADS_OAUTH_REFRESH_TOKEN')
  const approved = conversionActionId(env.GOOGLE_ADS_CONVERSION_ACTION_APPROVED)
  if (!approved) missing.push('GOOGLE_ADS_CONVERSION_ACTION_APPROVED')
  const funded = conversionActionId(env.GOOGLE_ADS_CONVERSION_ACTION_FUNDED)
  if (!funded) missing.push('GOOGLE_ADS_CONVERSION_ACTION_FUNDED')

  if (missing.length > 0 || !customerId || !approved || !funded) {
    return { ok: false, mode, missing: [...new Set(missing)] }
  }
  return {
    ok: true,
    config: {
      mode,
      customerId,
      loginCustomerId,
      oauthClientId,
      oauthClientSecret,
      oauthRefreshToken,
      conversionActions: { approved, funded },
    },
  }
}
