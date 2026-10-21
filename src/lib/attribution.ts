/**
 * Shape `conversations.attribution` (written by the event processor from
 * conversation_started, BTB-404) for the browser.
 *
 * Stored shape (jsonb, snake_case): gclid, gbraid, wbraid, utm_source,
 * utm_medium, utm_campaign, utm_content, utm_term, matchtype, captured_at,
 * received_at — every value a short string, any of them absent.
 *
 * An ad click carries a click id and campaign values. Since BTB-500 the
 * chat and website also attribute search, LLM, social and referral traffic
 * from the referrer host, as utm_source / utm_medium only (for example
 * "google" / "organic", "chatgpt" / "llm"). No attribution at all means a
 * direct or untracked visit.
 *
 * The values come from a URL anyone can craft. Render them as text only.
 */

import type { Attribution } from '@/lib/schemas/conversations'

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** The parameters proper — timestamps alone are not attribution. */
const PARAM_KEYS: Array<keyof Attribution> = [
  'gclid',
  'gbraid',
  'wbraid',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
  'matchtype',
]

export function shapeAttribution(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const shaped: Attribution = {
    gclid: str(o.gclid),
    gbraid: str(o.gbraid),
    wbraid: str(o.wbraid),
    utmSource: str(o.utm_source),
    utmMedium: str(o.utm_medium),
    utmCampaign: str(o.utm_campaign),
    utmContent: str(o.utm_content),
    utmTerm: str(o.utm_term),
    matchtype: str(o.matchtype),
    capturedAt: str(o.captured_at),
    receivedAt: str(o.received_at),
  }
  return PARAM_KEYS.some((k) => shaped[k] !== null) ? shaped : null
}

/**
 * One line for the Acquisition section header: the campaign for an ad click,
 * otherwise "source / medium" (e.g. "google / organic", "chatgpt / llm"),
 * otherwise whichever of the two is present, otherwise "Ad click" for a bare
 * click id. Null attribution reads "No data".
 */
export function attributionSummary(attribution: Attribution | null): string {
  if (!attribution) return 'No data'
  if (attribution.utmCampaign) return attribution.utmCampaign
  const { utmSource, utmMedium } = attribution
  if (utmSource && utmMedium) return `${utmSource} / ${utmMedium}`
  return utmSource ?? utmMedium ?? 'Ad click'
}
